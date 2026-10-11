import { partsForMode } from "./compiler";
import {
  applyAction,
  decideInteraction,
  FALLBACK_ANALYSIS,
  isAnswerContent,
  LIMITS,
  newQuestionState,
  type InteractionAction,
  type QuestionState,
  type TurnAnalysis,
} from "./interaction";
import { DEFAULT_POLICIES } from "./policies";
import { planNext } from "./scheduler";
import { line, probeClip } from "./script";
import { TurnController, type TurnDecision } from "./turn";
import type {
  AnswerRecord,
  Blueprint,
  Clip,
  EngineEvent,
  EnginePolicies,
  EnginePorts,
  Part,
  Phase,
  PolicyId,
  Recording,
  Snapshot,
  Step,
  TakeMeta,
  TurnOutcome,
  TurnPolicy,
  TurnResult,
} from "./types";

/**
 * ExamRuntime: executes a blueprint like a real IELTS examiner.
 *
 * For every question it runs the same loop:
 *
 *   ask → listen → (transcribe + analyse) → decide → act
 *
 * - Listening: TurnController decides when a take is over (silence, caps).
 * - Analysing: the TurnAnalyzer port transcribes the take and classifies the
 *   candidate's intent (answer, repeat request, word question, thinking
 *   aloud, off-topic, "I don't know", question to the examiner, …).
 * - Deciding: `decideInteraction` applies the examiner policy with
 *   per-question limits (e.g. at most two repeats in exam style).
 * - Acting: repeat / rephrase / clarify / keep listening / re-ask / move on,
 *   then probes ("Why?", Part 3 follow-ups) when an answer is short.
 *
 * The scheduler trims questions so parts and the whole session stay within
 * their time budgets. All I/O goes through injected ports, so the same code
 * runs in the browser and in tests on a virtual clock.
 */

class AbortErr extends Error {
  constructor() {
    super("Aborted");
    this.name = "AbortError";
  }
}

export function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

type Listener = (s: Snapshot) => void;

interface ListenOptions {
  allowRepeat: boolean;
  /** Called on early_stop / no_response; return "continue" to keep the same turn. */
  interim?: (d: NonNullable<TurnDecision>, tc: TurnController) => Promise<"continue" | "end">;
  timerKind?: "answer" | "long_turn";
}

interface ListenResult {
  result: TurnResult;
  recording: Recording | null;
}

interface QuestionSpec {
  index: number;
  part: Part | 0;
  questionId: string;
  clip: Clip;
  rephrase?: Clip;
  policy: PolicyId;
  kind: "name" | "main" | "probe" | "round_off";
  scored: boolean;
  group?: string;
  allowWhyProbe?: boolean;
  followUps?: Clip[];
  resumed: boolean;
  /** Counts towards the part's question budget (main questions only). */
  countsAsMain: boolean;
}

interface ContentTake {
  result: TurnResult;
  recording: Recording | null;
  analysis: TurnAnalysis;
}

export class ExamRuntime {
  private readonly policies: EnginePolicies;
  private readonly listeners = new Set<Listener>();
  private snap: Snapshot;
  private readonly log: EngineEvent[] = [];
  private readonly answerList: AnswerRecord[] = [];
  private readonly pendingTranscripts = new Map<string, Promise<{ transcript?: string } | void>>();

  // Control
  private stepAbort = new AbortController();
  private pauseRequested = false;
  private endRequested = false;
  private aborted = false;
  private resumeWaiter: (() => void) | null = null;
  private resumedFromPause = false;
  private started = false;
  private sessionStartedAt = 0;

  // Commands from the UI (consumed by the listen loop)
  private finishFlag = false;
  private repeatFlag = false;
  private skipPrepFlag = false;

  // Part / scheduling state
  private part: Part | 0 = 0;
  private partStartedAt = 0;
  private askedInPart = 0;
  private askedInGroup = 0;
  private currentGroup: string | null = null;
  private probedGroups = new Set<string>();
  private p3Probes = 0;
  private completedSteps = new Set<number>();
  private prepElapsedBeforePause: number | null = null;
  private prepDone = false;
  private answerSeq = 0;
  private takeSeq = 0;

  constructor(
    private readonly blueprint: Blueprint,
    private readonly ports: EnginePorts,
    policies: EnginePolicies = DEFAULT_POLICIES,
  ) {
    this.policies = policies;
    this.snap = {
      phase: "idle",
      mode: blueprint.mode,
      fidelity: blueprint.fidelity,
      part: 0,
      caption: null,
      question: null,
      cueCardVisible: false,
      timer: null,
      speechDetected: false,
      canRepeat: false,
      canFinish: false,
      canPause: false,
      canSkipPrep: false,
      partsInMode: partsForMode(blueprint.mode),
      loadProgress: null,
      error: null,
      endReason: null,
      answered: 0,
    };
  }

  // ------------------------------------------------------------------ public

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): Snapshot => this.snap;

  get events(): readonly EngineEvent[] {
    return this.log;
  }

  get answers(): readonly AnswerRecord[] {
    return this.answerList;
  }

  /** Runs the whole exam. Resolves when it has ended (completed or early). */
  async start(): Promise<void> {
    if (this.started) throw new Error("ExamRuntime already started");
    this.started = true;
    this.emit("session_start", {
      mode: this.blueprint.mode,
      fidelity: this.blueprint.fidelity,
      examiner: this.blueprint.examiner.id,
    });

    this.update({ phase: "loading", loadProgress: { done: 0, total: this.blueprint.clips.length } });
    await this.ports.speaker.prepare(this.blueprint.clips, (done, total) =>
      this.update({ loadProgress: { done, total } }),
    );
    this.update({ loadProgress: null, canPause: this.blueprint.fidelity === "guided" });
    this.sessionStartedAt = this.now();

    const steps = this.blueprint.steps;
    let i = 0;
    while (i < steps.length && !this.endRequested) {
      try {
        i = await this.exec(steps[i], i);
      } catch (e) {
        if (!isAbortError(e)) {
          this.emit("error", { message: e instanceof Error ? e.message : String(e), step: i });
          this.update({ error: e instanceof Error ? e.message : "Something went wrong." });
          this.pauseRequested = true;
        }
        if (this.endRequested) break;
        if (this.pauseRequested) {
          await this.waitForResume();
          this.resumedFromPause = true;
        }
        // Re-run the same step after a pause.
      }
    }

    if (this.aborted) {
      this.finish("ended_early");
    } else if (this.endRequested) {
      this.stepAbort = new AbortController();
      this.update({ cueCardVisible: false, timer: null });
      try {
        await this.speak(line("close.early"));
      } catch {
        /* ignore */
      }
      this.finish("ended_early");
    } else {
      this.finish("completed");
    }
  }

  /** Guided mode (or a system pause such as a lost microphone). */
  pause(reason: "user" | "system" = "user", message?: string): void {
    if (this.snap.phase === "ended" || this.pauseRequested) return;
    if (reason === "user" && this.blueprint.fidelity !== "guided") return;
    this.pauseRequested = true;
    this.emit("paused", { reason, message });
    this.update({ error: reason === "system" ? (message ?? "Paused") : null });
    this.stepAbort.abort();
  }

  resume(): void {
    if (!this.pauseRequested) return;
    this.pauseRequested = false;
    this.emit("resumed");
    this.update({ error: null });
    const w = this.resumeWaiter;
    this.resumeWaiter = null;
    w?.();
  }

  endTest(): void {
    if (this.snap.phase === "ended" || this.endRequested) return;
    this.endRequested = true;
    this.emit("end_requested");
    this.stepAbort.abort();
    const w = this.resumeWaiter;
    this.resumeWaiter = null;
    w?.();
  }

  /**
   * Stops at once without the examiner's closing line (the candidate left the
   * page). Safe to call at any time, including before or after the exam.
   */
  abort(): void {
    if (this.aborted || this.snap.phase === "ended") return;
    this.aborted = true;
    this.endTest();
  }

  get wasAborted(): boolean {
    return this.aborted;
  }

  finishAnswer(): void {
    if (this.snap.canFinish) this.finishFlag = true;
  }

  requestRepeat(): void {
    if (this.snap.canRepeat) this.repeatFlag = true;
  }

  skipPrep(): void {
    if (this.snap.canSkipPrep) this.skipPrepFlag = true;
  }

  // ----------------------------------------------------------------- steps

  /** Executes one step; returns the index of the next step. */
  private async exec(step: Step, index: number): Promise<number> {
    this.stepAbort = new AbortController();
    const resumed = this.resumedFromPause;
    this.resumedFromPause = false;

    switch (step.kind) {
      case "say":
        await this.speak(step.clip);
        return index + 1;

      case "part_start":
        this.part = step.part;
        this.partStartedAt = this.now();
        this.askedInPart = 0;
        this.askedInGroup = 0;
        this.currentGroup = null;
        this.p3Probes = 0;
        this.emit("part_start", { part: step.part });
        this.update({ part: step.part });
        return index + 1;

      case "part_end":
        this.emit("part_end", {
          part: step.part,
          durationMs: this.now() - this.partStartedAt,
          asked: this.askedInPart,
        });
        return index + 1;

      case "group_intro": {
        if (this.currentGroup !== step.group) {
          const decision = this.schedule(step.part, step.group, true);
          if (decision === "end_part") return this.skipToPartEnd(index, step.part, "time budget (topic)");
          this.currentGroup = step.group;
          this.askedInGroup = 0;
        }
        await this.speak(step.clip);
        return index + 1;
      }

      case "ask": {
        if (this.completedSteps.has(index)) return index + 1;
        const decision = this.schedule(step.part, step.group, false);
        if (decision === "end_part") return this.skipToPartEnd(index, step.part, "time budget (question)");
        await this.conductQuestion({
          index,
          part: step.part,
          questionId: step.questionId,
          clip: step.clip,
          rephrase: step.rephrase,
          policy: step.policy,
          kind: "main",
          scored: true,
          group: step.group,
          allowWhyProbe: step.allowWhyProbe,
          followUps: step.followUps,
          resumed,
          countsAsMain: true,
        });
        return index + 1;
      }

      case "ask_name":
        if (this.completedSteps.has(index)) return index + 1;
        await this.conductQuestion({
          index,
          part: 0,
          questionId: "name",
          clip: step.clip,
          policy: "name",
          kind: "name",
          scored: false,
          resumed,
          countsAsMain: false,
        });
        return index + 1;

      case "cuecard_show":
        this.update({ cueCardVisible: true });
        return index + 1;

      case "cuecard_hide":
        this.update({ cueCardVisible: false });
        return index + 1;

      case "prep":
        await this.runPrep(resumed);
        return index + 1;

      case "long_turn":
        if (this.completedSteps.has(index)) return index + 1;
        await this.runLongTurn(index, resumed);
        return index + 1;

      case "round_off": {
        if (this.completedSteps.has(index)) return index + 1;
        if (step.index > 0 && this.now() - this.partStartedAt > this.policies.secondRoundOffBeforeMs) {
          this.emit("skip", { questionId: step.questionId, reason: "part 2 time" });
          return index + 1;
        }
        if (this.sessionTimeUp()) {
          this.emit("skip", { questionId: step.questionId, reason: "session time" });
          return index + 1;
        }
        await this.conductQuestion({
          index,
          part: 2,
          questionId: step.questionId,
          clip: step.clip,
          policy: "p2_roundoff",
          kind: "round_off",
          scored: true,
          resumed,
          countsAsMain: false,
        });
        return index + 1;
      }

      case "close":
        this.update({ question: null, cueCardVisible: false });
        await this.speak(step.clip);
        return index + 1;
    }
  }

  private skipToPartEnd(index: number, part: Part, reason: string): number {
    const steps = this.blueprint.steps;
    for (let j = index; j < steps.length; j++) {
      const s = steps[j];
      if (s.kind === "part_end" && s.part === part) {
        this.emit("skip", { from: index, to: j, part, reason });
        return j;
      }
    }
    return index + 1;
  }

  private sessionTimeUp(): boolean {
    return this.now() - this.sessionStartedAt >= this.policies.sessionCapMs[this.blueprint.mode];
  }

  private schedule(part: 1 | 3, group: string, groupStarting: boolean) {
    if (this.sessionTimeUp() && this.askedInPart > 0) return "end_part" as const;
    const budget = part === 1 ? this.policies.budgets.p1 : this.policies.budgets.p3;
    const asks = this.blueprint.steps.filter((s) => s.kind === "ask" && s.part === part);
    return planNext(
      budget,
      {
        elapsedMs: this.now() - this.partStartedAt,
        askedInPart: this.askedInPart,
        askedInGroup: groupStarting ? 0 : this.askedInGroup,
        availableInPart: asks.length,
        availableInGroup: asks.filter((s) => s.kind === "ask" && s.group === group).length,
      },
      groupStarting,
    );
  }

  // ------------------------------------------------------------- questions

  /**
   * Ask a question and handle everything the candidate might say until an
   * answer is accepted or the examiner moves on.
   */
  private async conductQuestion(q: QuestionSpec): Promise<void> {
    if (q.resumed && q.kind !== "name") await this.speak(line("resume.continue"));
    const limits = LIMITS[this.blueprint.fidelity];
    this.update({ question: q.clip.text });
    await this.speak(q.clip);

    let state: QuestionState = newQuestionState();
    let autoRepeated = false;
    let attempt = 0;
    const content: ContentTake[] = [];
    let currentClip = q.clip;

    for (;;) {
      const { result, recording } = await this.listen(this.policies.turns[q.policy], {
        allowRepeat: state.repeats < limits.maxRepeats || !state.refusedRepeat,
      });
      const take = this.takeMeta(q, attempt++, result);

      // 1. Work out what the candidate meant.
      let analysis: TurnAnalysis;
      if (result.outcome === "repeat_requested") {
        analysis = { ...FALLBACK_ANALYSIS, intent: "repeat_request", source: "button" };
        this.store(take, null);
      } else if (result.outcome === "no_response") {
        analysis = { ...FALLBACK_ANALYSIS, intent: "no_answer" };
        this.store(take, null);
      } else if (result.outcome === "interrupted" && q.kind !== "name") {
        // Spoke until the time limit: clearly an answer. Store it without waiting.
        analysis = { ...FALLBACK_ANALYSIS, intent: "answer" };
        this.store(take, recording);
      } else {
        // The name answer is transcribed too (not scored), so "Sorry, could you repeat?" is understood.
        analysis = await this.analyzeTake(take, recording, this.policies.analysisTimeoutMs);
      }

      // 2. Decide what a real examiner would do.
      const action: InteractionAction = decideInteraction(analysis, {
        part: q.part,
        kind: q.kind,
        fidelity: this.blueprint.fidelity,
        hasRephrase: Boolean(q.rephrase),
        state,
      });
      this.emit("interaction", {
        questionId: q.questionId,
        intent: analysis.intent,
        source: analysis.source,
        action: action.type,
        transcript: analysis.transcript.slice(0, 160),
      });

      if (isAnswerContent(analysis.intent) && result.outcome !== "no_response") {
        content.push({ result, recording, analysis });
      }

      // 3. Act.
      if (action.type === "no_response") {
        // Short probes like "Why?" are not repeated: the examiner simply moves on.
        if (!autoRepeated && q.kind !== "probe") {
          autoRepeated = true;
          if (q.part === 3 && q.rephrase && !state.rephrased) {
            state = { ...state, rephrased: true };
            currentClip = q.rephrase;
            await this.speak(line("p3.rephrase"));
            this.update({ question: currentClip.text });
          } else {
            await this.speak(line("p1.repeat"));
          }
          await this.speak(currentClip);
          continue;
        }
        if (q.kind === "name") {
          this.finishQuestion(q, content, result, 1);
          await this.speak(line("ack.thanks"));
          return;
        }
        await this.speak(line("p1.moveon"));
        this.finishQuestion(q, content, result, state.repeats + 1);
        await this.gap();
        return;
      }

      state = applyAction(state, action);

      switch (action.type) {
        case "accept": {
          const answer = this.finishQuestion(q, content, result, state.repeats);
          if (q.kind === "name") {
            await this.speak(line("ack.thanks"));
            return;
          }
          if (result.outcome === "interrupted") {
            await this.speak(line("ack.thanks"));
            await this.gap();
            return;
          }
          await this.maybeProbe(q, answer, analysis);
          return;
        }

        case "repeat":
          if (action.rephrase && q.rephrase) {
            currentClip = q.rephrase;
            await this.speak(line("p3.rephrase"));
            this.update({ question: currentClip.text });
          } else {
            await this.speak(line("ack.ofcourse"));
          }
          await this.speak(currentClip);
          continue;

        case "refuse_repeat":
          await this.speak(line("repeat.limit"));
          continue;

        case "clarify":
          if (action.rephrase && q.rephrase) {
            currentClip = q.rephrase;
            await this.speak(line("p3.rephrase"));
            this.update({ question: currentClip.text });
            await this.speak(currentClip);
          } else {
            await this.speak(line("clarify.p1"));
          }
          continue;

        case "continue":
          // Keep listening to the same answer; guided mode reassures the candidate.
          if (this.blueprint.fidelity === "guided") await this.speak(line("guide.takeyourtime"));
          continue;

        case "reask":
          await this.speak(line("reask.lead"));
          await this.speak(currentClip);
          continue;

        case "say_and_relisten":
          await this.speak(line(action.line));
          if (action.line === "deflect.opinion") await this.speak(currentClip);
          continue;

        case "move_on":
          await this.speak(line(action.line));
          this.finishQuestion(q, content, result, state.repeats);
          await this.gap();
          return;
      }
    }
  }

  /** Records the final answer for a question (merging continuation takes). */
  private finishQuestion(q: QuestionSpec, content: ContentTake[], last: TurnResult, repeats: number): AnswerRecord {
    const speechMs = content.reduce((a, t) => a + t.result.speechMs, 0);
    const durationMs = content.reduce((a, t) => a + t.result.durationMs, 0) || last.durationMs;
    const lastContent = content.at(-1);
    let outcome: AnswerRecord["outcome"] = "no_response";
    if (lastContent) {
      const o = lastContent.result.outcome;
      outcome = o === "interrupted" || o === "manual_finish" ? o : "end_of_turn";
    }
    const answer: AnswerRecord = {
      id: `a${++this.answerSeq}`,
      part: q.part,
      questionId: q.questionId,
      question: q.clip.text,
      kind: q.kind,
      outcome,
      durationMs,
      speechMs,
      firstSpeechLatencyMs: content[0]?.result.firstSpeechLatencyMs ?? null,
      repeats,
      scored: q.scored,
    };
    this.answerList.push(answer);
    if (q.countsAsMain) {
      this.completedSteps.add(q.index);
      this.askedInPart++;
      this.askedInGroup++;
    } else if (q.kind !== "probe") {
      this.completedSteps.add(q.index);
    }
    this.emit("answer", {
      id: answer.id,
      questionId: answer.questionId,
      kind: answer.kind,
      outcome,
      speechMs: answer.speechMs,
    });
    this.update({ answered: this.answerList.length });
    try {
      const p = Promise.resolve(this.ports.onAnswer(answer, lastContent?.recording ?? null));
      p.catch(() => undefined);
      this.pendingTranscripts.set(answer.id, p);
    } catch {
      /* the sink must never break the exam */
    }
    return answer;
  }

  /** "Why?" / "Why not?" in Part 1, follow-up probes in Part 3. */
  private async maybeProbe(q: QuestionSpec, answer: AnswerRecord, analysis: TurnAnalysis): Promise<void> {
    if (q.kind !== "main") {
      await this.gap();
      return;
    }
    const turnPolicy = this.policies.turns[q.policy];
    const knowsQuality = analysis.source === "llm" || analysis.source === "rules";
    const shortBySpeech = turnPolicy.shortAnswerMs !== null && answer.speechMs < turnPolicy.shortAnswerMs;
    const short = knowsQuality
      ? analysis.quality !== "developed" && (shortBySpeech || analysis.quality === "minimal")
      : shortBySpeech;

    if (q.part === 1 && short && q.allowWhyProbe && q.group && !this.probedGroups.has(q.group)) {
      this.probedGroups.add(q.group);
      const probe = knowsQuality
        ? analysis.polarity === "negative"
          ? line("p1.whynot")
          : line("p1.why")
        : await this.choosePolarityProbe(answer.id);
      await this.gap();
      await this.conductQuestion({
        index: q.index,
        part: 1,
        questionId: `${q.questionId}#probe`,
        clip: probe,
        policy: "p1_probe",
        kind: "probe",
        scored: true,
        resumed: false,
        countsAsMain: false,
      });
      return;
    }

    if (q.part === 3 && this.p3Probes < this.policies.maxP3Probes) {
      const suggested = analysis.source === "llm" && analysis.probe !== null && analysis.quality !== "developed";
      if (short || suggested) {
        this.p3Probes++;
        const clip =
          analysis.probe && analysis.source === "llm"
            ? probeClip(analysis.probe)
            : (q.followUps?.[0] ?? probeClip("why"));
        await this.gap();
        await this.conductQuestion({
          index: q.index,
          part: 3,
          questionId: `${q.questionId}#probe`,
          clip,
          policy: "p3_followup",
          kind: "probe",
          scored: true,
          resumed: false,
          countsAsMain: false,
        });
        return;
      }
    }
    await this.gap();
  }

  private async choosePolarityProbe(answerId: string): Promise<Clip> {
    const pending = this.pendingTranscripts.get(answerId);
    let transcript: string | undefined;
    if (pending) {
      const res = await this.raceTimeout(
        pending.then((r) => (r ? r.transcript : undefined)).catch(() => undefined),
        this.policies.polarityWaitMs,
      );
      transcript = typeof res === "string" ? res : undefined;
    }
    return transcript &&
      /^\s*(no|nope|not|never|nah|i don'?t|i do not|i didn'?t|i wouldn'?t|i haven'?t|i'?m not)\b/i.test(transcript)
      ? line("p1.whynot")
      : line("p1.why");
  }

  // -------------------------------------------------------------- analysis

  private takeMeta(q: QuestionSpec, attempt: number, r: TurnResult): TakeMeta {
    return {
      takeId: `t${++this.takeSeq}`,
      part: q.part,
      questionId: q.questionId,
      question: q.clip.text,
      kind: q.kind,
      attempt,
      outcome: r.outcome,
      speechMs: Math.round(r.speechMs),
      durationMs: Math.round(r.durationMs),
      firstSpeechLatencyMs: r.firstSpeechLatencyMs === null ? null : Math.round(r.firstSpeechLatencyMs),
      scored: q.scored,
    };
  }

  /**
   * Send a take for transcription/storage without waiting (button repeat
   * requests, silence, answers cut off at the time limit). The examiner's
   * decision was already made locally.
   */
  private store(take: TakeMeta, recording: Recording | null) {
    const a = this.ports.analyzer;
    if (!a) return;
    void a.analyze(take, recording).catch(() => undefined);
  }

  /** Transcribe + classify a take, falling back to rules/defaults on timeout. */
  private async analyzeTake(take: TakeMeta, recording: Recording | null, timeoutMs: number): Promise<TurnAnalysis> {
    const a = this.ports.analyzer;
    if (!a) return { ...FALLBACK_ANALYSIS };
    this.update({ phase: "considering", caption: null });
    const res = await this.raceTimeout(
      a.analyze(take, recording).catch(() => null),
      timeoutMs,
    );
    return res ?? { ...FALLBACK_ANALYSIS };
  }

  /** Resolves with the promise's value, or null after `ms` (abortable). */
  private async raceTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
    const ctrl = new AbortController();
    const outer = this.stepAbort.signal;
    const onAbort = () => ctrl.abort();
    outer.addEventListener("abort", onAbort, { once: true });
    try {
      const timeout = this.ports.clock.sleep(ms, ctrl.signal).then(
        () => null,
        () => null,
      );
      const r = await Promise.race([p, timeout]);
      if (outer.aborted) throw new AbortErr();
      return r;
    } finally {
      outer.removeEventListener("abort", onAbort);
      ctrl.abort();
    }
  }

  // -------------------------------------------------------------- Part 2

  private async runPrep(resumed: boolean) {
    const p = this.policies;
    const signal = this.stepAbort.signal;
    if (resumed && this.prepDone) {
      await this.speak(line("p2.prep.end"));
      return;
    }
    let elapsedBefore = 0;
    if (resumed && this.prepElapsedBeforePause !== null) {
      elapsedBefore = this.prepElapsedBeforePause;
    } else {
      this.emit("prep_start");
      await this.speak(line("p2.prep.start"));
    }
    this.prepElapsedBeforePause = null;

    const startedAt = this.now() - elapsedBefore;
    let warned = elapsedBefore >= p.prepMs - p.prepWarningMs;
    this.skipPrepFlag = false;
    this.update({
      phase: "preparing",
      caption: null,
      timer: { kind: "prep", startedAt, limitMs: p.prepMs },
      canSkipPrep: this.blueprint.fidelity === "guided",
    });

    try {
      for (;;) {
        const elapsed = this.now() - startedAt;
        if (elapsed >= p.prepMs || this.skipPrepFlag) break;
        if (!warned && this.blueprint.fidelity === "guided" && p.prepMs - elapsed <= p.prepWarningMs) {
          warned = true;
          // Spoken cue; preparation time keeps running while it plays.
          await this.speak(line("p2.prep.10s"), "preparing");
          continue;
        }
        await this.ports.clock.sleep(Math.min(p.tickMs, p.prepMs - elapsed), signal);
      }
    } catch (e) {
      if (isAbortError(e)) this.prepElapsedBeforePause = this.now() - startedAt;
      throw e;
    }

    this.update({ canSkipPrep: false, timer: null });
    this.emit("prep_end", { skipped: this.skipPrepFlag });
    this.skipPrepFlag = false;
    this.prepDone = true;
    await this.speak(line("p2.prep.end"));
  }

  private async runLongTurn(index: number, resumed: boolean) {
    this.prepDone = false;
    if (resumed) await this.speak(line("p2.nudge"));
    const base = this.policies.turns.p2_long;
    const questionId = this.blueprint.cueCard?.id ?? "cue-card";
    const question = this.blueprint.cueCard?.prompt ?? "Part 2 long turn";
    let moreUsed = false;
    let nudged = false;
    let cardInfoUsed = false;
    let firstOpenedAt: number | null = null;
    const content: ContentTake[] = [];
    let attempt = 0;
    let last: TurnResult | null = null;

    for (;;) {
      // A continuation keeps the original 2-minute clock.
      const elapsedSoFar = firstOpenedAt === null ? 0 : this.now() - firstOpenedAt;
      const policy: TurnPolicy = {
        ...base,
        hardCapMs: Math.max(5_000, base.hardCapMs - elapsedSoFar),
        minElapsedMs: Math.max(0, base.minElapsedMs - elapsedSoFar),
      };
      const { result, recording } = await this.listen(policy, {
        allowRepeat: false,
        timerKind: "long_turn",
        // Only "no speech yet" is handled inside the take (the mic pauses for the nudge).
        // Stopping early ends the take so that what was said can be analysed first.
        interim: async (d, tc) => {
          if (d.outcome !== "no_response" || nudged) return "end";
          nudged = true;
          this.ports.mic.pause();
          await this.speak(line("p2.nudge"), "listening");
          this.ports.mic.resume();
          tc.resume(this.now());
          return "continue";
        },
      });
      if (firstOpenedAt === null) firstOpenedAt = result.openedAt;
      last = result;
      const take: TakeMeta = {
        takeId: `t${++this.takeSeq}`,
        part: 2,
        questionId,
        question,
        kind: "long_turn",
        attempt: attempt++,
        outcome: result.outcome,
        speechMs: Math.round(result.speechMs),
        durationMs: Math.round(result.durationMs),
        firstSpeechLatencyMs: result.firstSpeechLatencyMs === null ? null : Math.round(result.firstSpeechLatencyMs),
        scored: true,
      };

      if (result.outcome === "no_response") {
        this.store(take, null);
        break;
      }

      // A short take that is really a question about the task ("Sorry, what is the topic?").
      const analysis =
        result.outcome === "interrupted" || result.speechMs > 15_000
          ? (this.store(take, recording), { ...FALLBACK_ANALYSIS })
          : await this.analyzeTake(take, recording, this.policies.longTurnAnalysisTimeoutMs);
      this.emit("interaction", {
        questionId,
        intent: analysis.intent,
        source: analysis.source,
        action: "long_turn",
        transcript: analysis.transcript.slice(0, 160),
      });

      const asksAboutTask = ["repeat_request", "clarification_request", "meta", "question_to_examiner"].includes(
        analysis.intent,
      );
      const elapsed = this.now() - firstOpenedAt;
      const timeLeft = base.hardCapMs - elapsed > 20_000;
      if (asksAboutTask && !cardInfoUsed && timeLeft) {
        cardInfoUsed = true;
        await this.speak(line("p2.cardinfo"));
        continue;
      }
      if (isAnswerContent(analysis.intent) || analysis.source === "none") content.push({ result, recording, analysis });

      // Stopped before the 1-minute mark: encourage once, then keep the same 2-minute clock.
      const stoppedEarly =
        result.outcome !== "interrupted" && elapsed < base.minElapsedMs && analysis.intent !== "stop_request";
      if (stoppedEarly && !moreUsed && timeLeft && content.length > 0) {
        moreUsed = true;
        await this.speak(line("p2.more"));
        continue;
      }
      break;
    }

    const speechMs = content.reduce((a, t) => a + t.result.speechMs, 0);
    const lastResult = last!;
    const answer: AnswerRecord = {
      id: `a${++this.answerSeq}`,
      part: 2,
      questionId,
      question,
      kind: "long_turn",
      outcome:
        content.length === 0
          ? "no_response"
          : lastResult.outcome === "repeat_requested" || lastResult.outcome === "early_stop"
            ? "end_of_turn"
            : (lastResult.outcome as AnswerRecord["outcome"]),
      durationMs: firstOpenedAt === null ? lastResult.durationMs : lastResult.closedAt - firstOpenedAt,
      speechMs,
      firstSpeechLatencyMs: content[0]?.result.firstSpeechLatencyMs ?? null,
      repeats: 0,
      scored: true,
    };
    this.answerList.push(answer);
    this.completedSteps.add(index);
    this.emit("answer", { id: answer.id, questionId, kind: "long_turn", outcome: answer.outcome, speechMs });
    this.update({ answered: this.answerList.length });
    try {
      const p = Promise.resolve(this.ports.onAnswer(answer, content.at(-1)?.recording ?? null));
      p.catch(() => undefined);
    } catch {
      /* ignore */
    }

    if (answer.outcome === "interrupted") {
      await this.ports.cues.timeUp();
      await this.speak(line("p2.timeup"));
    } else {
      await this.speak(line("ack.thanks"));
    }
    await this.gap();
  }

  // ------------------------------------------------------------ listening

  private async listen(policy: TurnPolicy, opts: ListenOptions): Promise<ListenResult> {
    const { clock, mic, cues } = this.ports;
    const signal = this.stepAbort.signal;

    this.update({ phase: "gap", caption: null });
    await clock.sleep(this.policies.tailMs, signal);
    await cues.listen();
    if (signal.aborted) throw new AbortErr();
    await mic.open();

    const tc = new TurnController(policy, this.now(), this.policies.graceMs);
    this.finishFlag = false;
    this.repeatFlag = false;
    let decision: TurnDecision = null;
    let muted = false;
    const unsub = mic.onVoice((e) => {
      if (muted) return;
      const d = tc.onVoice(e);
      if (d && !decision) decision = d;
      this.update({ speechDetected: tc.isSpeaking });
    });

    this.emit("listen_open", { policy: policy.id });
    this.update({
      phase: "listening",
      speechDetected: false,
      timer: {
        kind: opts.timerKind ?? "answer",
        startedAt: tc.startedAt,
        limitMs: policy.hardCapMs,
        minMs: policy.minElapsedMs || undefined,
        targetMs: policy.targetMs,
      },
    });

    let outcome: TurnOutcome;
    try {
      for (;;) {
        await clock.sleep(this.policies.tickMs, signal);
        const now = this.now();

        if (this.finishFlag) {
          this.finishFlag = false;
          // Part 2: finishing before the 1-minute mark is treated like stopping early.
          if (opts.interim && tc.hasSpoken && now - tc.startedAt < policy.minElapsedMs) {
            decision = { outcome: "early_stop", at: now };
          } else {
            outcome = tc.hasSpoken ? "manual_finish" : "no_response";
            break;
          }
        }
        if (this.repeatFlag && opts.allowRepeat && tc.canRepeat(now)) {
          outcome = "repeat_requested";
          break;
        }
        this.repeatFlag = false;

        if (!decision) decision = tc.tick(now);
        if (decision) {
          const d: NonNullable<TurnDecision> = decision;
          decision = null;
          if ((d.outcome === "early_stop" || d.outcome === "no_response") && opts.interim) {
            muted = true;
            const next = await opts.interim(d, tc);
            muted = false;
            if (next === "continue") {
              this.update({ phase: "listening", caption: null });
              continue;
            }
          }
          outcome = d.outcome === "early_stop" ? "end_of_turn" : d.outcome;
          break;
        }

        this.update({
          canFinish: tc.hasSpoken,
          canRepeat: opts.allowRepeat && tc.canRepeat(now),
        });
      }
    } catch (e) {
      unsub();
      this.update({ canFinish: false, canRepeat: false, speechDetected: false, timer: null });
      await mic.close(false);
      throw e;
    }

    unsub();
    const closedAt = this.now();
    const keep = outcome !== "repeat_requested" && outcome !== "no_response";
    const recording = await mic.close(keep);
    const result: TurnResult = {
      outcome,
      openedAt: tc.startedAt,
      closedAt,
      durationMs: closedAt - tc.startedAt,
      speechMs: tc.speechMs(closedAt),
      firstSpeechLatencyMs: tc.firstSpeechLatencyMs(),
    };
    this.emit("listen_close", { outcome, durationMs: result.durationMs, speechMs: result.speechMs });
    this.update({ phase: "gap", canFinish: false, canRepeat: false, speechDetected: false, timer: null });
    return { result, recording: keep ? recording : null };
  }

  // ---------------------------------------------------------------- helpers

  private async speak(clip: Clip, phaseAfter: Phase = "gap"): Promise<void> {
    this.update({ phase: "speaking", caption: clip.text });
    this.emit("say", { key: clip.key });
    await this.ports.speaker.say(clip, this.stepAbort.signal);
    this.update({ phase: phaseAfter, caption: null });
  }

  private async gap(): Promise<void> {
    this.update({ phase: "gap" });
    await this.ports.clock.sleep(this.policies.gapMs, this.stepAbort.signal);
  }

  private waitForResume(): Promise<void> {
    this.update({
      phase: "paused",
      caption: null,
      timer: null,
      canFinish: false,
      canRepeat: false,
      canSkipPrep: false,
    });
    if (!this.pauseRequested) return Promise.resolve();
    return new Promise((resolve) => {
      this.resumeWaiter = resolve;
    });
  }

  private finish(reason: "completed" | "ended_early") {
    this.emit("session_end", { reason, answers: this.answerList.length });
    this.update({
      phase: "ended",
      endReason: reason,
      caption: null,
      timer: null,
      canFinish: false,
      canRepeat: false,
      canPause: false,
      canSkipPrep: false,
      cueCardVisible: false,
    });
  }

  private now(): number {
    return this.ports.clock.now();
  }

  private emit(type: EngineEvent["type"], data?: Record<string, unknown>) {
    const e: EngineEvent = { seq: this.log.length + 1, t: Math.round(this.now()), type, data };
    this.log.push(e);
    try {
      this.ports.onEvent?.(e);
    } catch {
      /* hooks must never break the exam */
    }
  }

  private update(patch: Partial<Snapshot>) {
    let changed = false;
    for (const k of Object.keys(patch) as (keyof Snapshot)[]) {
      if (this.snap[k] !== patch[k]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l(this.snap);
  }
}
