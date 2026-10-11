import type { ProbeId } from "./script";
import type { Fidelity, Part } from "./types";

/**
 * Live listening: what did the candidate actually say, and what would a real
 * examiner do about it?
 *
 * 1. `classifyByRules` — fast, deterministic intent detection from the
 *    transcript (also the fallback when the LLM is slow or unavailable).
 * 2. The server adds an LLM opinion for anything ambiguous (see
 *    src/server/turn-analysis.ts) and returns a `TurnAnalysis`.
 * 3. `decideInteraction` — the examiner policy: maps intent + context +
 *    limits to an action (repeat, rephrase, clarify, keep listening, move on…).
 *
 * Everything here is pure and unit-tested.
 */

export type TurnIntent =
  /** A genuine attempt to answer the question. */
  | "answer"
  /** "Sorry, could you repeat the question?" */
  | "repeat_request"
  /** "What does 'walking holiday' mean?" */
  | "clarification_request"
  /** Stopped mid-thought: "Well, I think… um… let me think…" */
  | "incomplete"
  /** Talks about something unrelated to the question. */
  | "off_topic"
  /** "I don't know." / "I have no idea." / "Can we skip this?" */
  | "dont_know"
  /** "What about you?" / "Do you like walking?" */
  | "question_to_examiner"
  /** "How much time do I have?" / "Is that enough?" / "Should I continue?" */
  | "meta"
  /** "I want to stop the test." */
  | "stop_request"
  /** Noise, silence, non-English or unintelligible. */
  | "no_answer";

export const TURN_INTENTS: TurnIntent[] = [
  "answer",
  "repeat_request",
  "clarification_request",
  "incomplete",
  "off_topic",
  "dont_know",
  "question_to_examiner",
  "meta",
  "stop_request",
  "no_answer",
];

export interface TurnAnalysis {
  intent: TurnIntent;
  transcript: string;
  polarity: "positive" | "negative" | "neutral";
  quality: "developed" | "short" | "minimal";
  /** Part 3: which follow-up probe would suit this answer (if any). */
  probe: ProbeId | null;
  /** Who decided: the LLM, the rules, the on-screen button, or nobody (offline). */
  source: "llm" | "rules" | "button" | "none";
  reason?: string;
}

export const FALLBACK_ANALYSIS: TurnAnalysis = {
  intent: "answer",
  transcript: "",
  polarity: "neutral",
  quality: "developed",
  probe: null,
  source: "none",
};

// ---------------------------------------------------------------- rules

const RE = {
  repeat:
    /\b(repeat|say (that|it|the question) again|pardon|come again|one more time|didn'?t (catch|hear|get|understand)|can'?t hear|what was the question|what('?s| is) the question|ask (it|that|the question) again|sorry,? what\??$|again,? please)\b/i,
  clarify:
    /\b(what (does|do|is) .{1,40} mean|meaning of|what do you mean|don'?t (know|understand) (the word|what .{1,30} means)|explain (the|that|this) (word|question))\b/i,
  examiner: /\b(what about you|and you\??$|how about you|do you (like|have|think|enjoy)\b.*\?$|what do you think\?$)/i,
  meta: /\b(how (much|long) time|how many (minutes|seconds)|is (that|this) (enough|ok|okay|fine)|should i (continue|go on|keep going|stop)|can i start again|start (over|again)|is my time up|am i doing)\b/i,
  stop: /\b(stop|end|finish|quit|exit)\b.{0,15}\b(test|exam|this)\b|\bi (want|would like) to (stop|leave|quit)\b/i,
  dontKnow:
    /^(um+,? |uh+,? |well,? |sorry,? |hmm+,? )*(i (really )?(don'?t|do not) know|no idea|i have no idea|i'?m not sure|not sure|i can'?t (think|answer)|(can we |let'?s )?skip( (this|it|this one|the question))?|pass|next question)[.!?\s]*$/i,
  trailing:
    /\b(and|but|because|so|um+|uh+|er+|erm|like|well|the|a|to|of|that|which|let me think|how (do i|can i) say)[\s,.…-]*$/i,
  thinking: /\b(let me think|give me a (second|moment|minute)|how (do i|can i|to) say|wait a (second|moment))\b/i,
  negative:
    /^\s*(no|nope|not|never|nah|i don'?t|i do not|i didn'?t|i did not|i wouldn'?t|i would not|i haven'?t|i'?m not|not really|definitely not|i won'?t)\b/i,
  positive:
    /^\s*(yes|yeah|yep|sure|of course|definitely|absolutely|i do|i did|i would|i have|i like|i love|i enjoy|certainly)\b/i,
};

function wordCount(t: string): number {
  return t.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length;
}

export function polarityOf(transcript: string): TurnAnalysis["polarity"] {
  if (RE.negative.test(transcript)) return "negative";
  if (RE.positive.test(transcript)) return "positive";
  return "neutral";
}

export function qualityOf(words: number, speechMs: number): TurnAnalysis["quality"] {
  if (words <= 4 || speechMs < 2_500) return "minimal";
  if (words < 20 || speechMs < 8_000) return "short";
  return "developed";
}

/**
 * Deterministic intent detection. `confident` is true when the transcript is
 * an unambiguous request (e.g. a short "Could you repeat that, please?"), in
 * which case the LLM call can be skipped to keep the examiner responsive.
 */
export function classifyByRules(transcript: string, speechMs: number): { analysis: TurnAnalysis; confident: boolean } {
  const t = transcript.trim();
  const words = wordCount(t);
  const base = {
    transcript: t,
    polarity: polarityOf(t),
    quality: qualityOf(words, speechMs),
    probe: null,
    source: "rules" as const,
  };
  const make = (intent: TurnIntent, confident: boolean, reason: string) => ({
    analysis: { ...base, intent, reason },
    confident,
  });

  if (words === 0) return make("no_answer", true, "empty transcript");
  const short = words <= 14;

  if (short && RE.stop.test(t)) return make("stop_request", true, "asked to stop");
  if (short && RE.repeat.test(t)) return make("repeat_request", true, "asked for a repeat");
  if (words <= 18 && RE.clarify.test(t)) return make("clarification_request", true, "asked what a word means");
  if (short && RE.dontKnow.test(t)) return make("dont_know", true, "does not know");
  if (short && RE.meta.test(t)) return make("meta", true, "asked about the test");
  if (short && RE.examiner.test(t)) return make("question_to_examiner", false, "asked the examiner");
  if (words <= 12 && (RE.thinking.test(t) || RE.trailing.test(t)))
    return make("incomplete", false, "stopped mid-thought");
  return make("answer", false, "default");
}

// --------------------------------------------------------------- policy

export interface InteractionLimits {
  /** Repeats granted on request, per question. */
  maxRepeats: number;
  /** "I can't explain that" / rephrase on a word question, per question. */
  maxClarifications: number;
  /** Times the examiner keeps listening after the candidate stops mid-thought. */
  maxContinuations: number;
  /** Deflections (opinion / meta / stop questions), per question. */
  maxDeflections: number;
  /** Re-asking after an off-topic answer, per question. */
  maxReasks: number;
}

export const LIMITS: Record<Fidelity, InteractionLimits> = {
  // Real test: the examiner repeats a question once; Bandly allows one extra (recorded).
  exam: { maxRepeats: 2, maxClarifications: 1, maxContinuations: 2, maxDeflections: 2, maxReasks: 1 },
  guided: { maxRepeats: 4, maxClarifications: 2, maxContinuations: 3, maxDeflections: 3, maxReasks: 1 },
};

/** Per-question counters kept by the runtime. */
export interface QuestionState {
  repeats: number;
  clarifications: number;
  continuations: number;
  deflections: number;
  reasks: number;
  rephrased: boolean;
  refusedRepeat: boolean;
}

export function newQuestionState(): QuestionState {
  return {
    repeats: 0,
    clarifications: 0,
    continuations: 0,
    deflections: 0,
    reasks: 0,
    rephrased: false,
    refusedRepeat: false,
  };
}

export type InteractionAction =
  /** Accept the answer and continue (probes are decided afterwards). */
  | { type: "accept" }
  /** Say "Of course." and repeat the question (or rephrase in Part 3). */
  | { type: "repeat"; rephrase: boolean }
  /** "I'm afraid I can't repeat the question again…" then listen again. */
  | { type: "refuse_repeat" }
  /** Part 1: "I'm afraid I can't explain that…"; Part 3: rephrase. Then listen again. */
  | { type: "clarify"; rephrase: boolean }
  /** Keep listening to the same answer (candidate paused mid-thought). */
  | { type: "continue" }
  /** "Let me ask you the question again." + question. */
  | { type: "reask" }
  /** Say a fixed line, then listen again for the same question. */
  | { type: "say_and_relisten"; line: "deflect.opinion" | "meta.continue" | "stop.info" }
  /** Give up on this question politely and move on. */
  | { type: "move_on"; line: "p1.moveon" | "skip.ok" }
  /** Treat like silence (repeat once, then move on). */
  | { type: "no_response" };

export interface InteractionContext {
  part: Part | 0;
  kind: "name" | "main" | "probe" | "round_off";
  fidelity: Fidelity;
  hasRephrase: boolean;
  state: QuestionState;
}

/**
 * The examiner policy (plan-2 §4.6, extended for live listening).
 * Returns what to do next and never mutates the state; the runtime updates
 * counters after acting.
 */
export function decideInteraction(a: TurnAnalysis, ctx: InteractionContext): InteractionAction {
  const lim = LIMITS[ctx.fidelity];
  const s = ctx.state;
  const p3 = ctx.part === 3;
  const canRephrase = p3 && ctx.hasRephrase && !s.rephrased;

  // The name question is not assessed: only repeats matter.
  if (ctx.kind === "name") {
    if (a.intent === "repeat_request" && s.repeats < 1) return { type: "repeat", rephrase: false };
    return { type: "accept" };
  }

  switch (a.intent) {
    case "answer":
      return { type: "accept" };

    case "no_answer":
      return { type: "no_response" };

    case "repeat_request":
      if (s.repeats < lim.maxRepeats) return { type: "repeat", rephrase: canRephrase };
      if (!s.refusedRepeat) return { type: "refuse_repeat" };
      return { type: "move_on", line: "p1.moveon" };

    case "clarification_request":
      if (s.clarifications < lim.maxClarifications) return { type: "clarify", rephrase: canRephrase };
      return { type: "move_on", line: "p1.moveon" };

    case "incomplete":
      if (s.continuations < lim.maxContinuations) return { type: "continue" };
      return { type: "accept" };

    case "off_topic":
      if (ctx.kind === "main" && s.reasks < lim.maxReasks) return { type: "reask" };
      return { type: "accept" };

    case "dont_know":
      // Part 3: try a simpler wording once before moving on.
      if (canRephrase) return { type: "repeat", rephrase: true };
      return { type: "move_on", line: "skip.ok" };

    case "question_to_examiner":
      if (s.deflections < lim.maxDeflections) return { type: "say_and_relisten", line: "deflect.opinion" };
      return { type: "move_on", line: "p1.moveon" };

    case "meta":
      if (s.deflections < lim.maxDeflections) return { type: "say_and_relisten", line: "meta.continue" };
      return { type: "accept" };

    case "stop_request":
      if (s.deflections < lim.maxDeflections) return { type: "say_and_relisten", line: "stop.info" };
      return { type: "move_on", line: "p1.moveon" };
  }
}

/** Counter updates after an action is carried out. */
export function applyAction(state: QuestionState, action: InteractionAction): QuestionState {
  const s = { ...state };
  switch (action.type) {
    case "repeat":
      s.repeats++;
      if (action.rephrase) s.rephrased = true;
      break;
    case "refuse_repeat":
      s.refusedRepeat = true;
      break;
    case "clarify":
      s.clarifications++;
      if (action.rephrase) s.rephrased = true;
      break;
    case "continue":
      s.continuations++;
      break;
    case "reask":
      s.reasks++;
      break;
    case "say_and_relisten":
      s.deflections++;
      break;
  }
  return s;
}

/** Intents whose transcript counts as (part of) the candidate's answer. */
export function isAnswerContent(intent: TurnIntent): boolean {
  return intent === "answer" || intent === "incomplete" || intent === "off_topic" || intent === "dont_know";
}
