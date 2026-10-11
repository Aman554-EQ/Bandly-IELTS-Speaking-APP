/**
 * Core types for the Bandly exam engine.
 *
 * The engine is pure TypeScript: no React, no DOM, no network. Everything
 * that touches the outside world (audio playback, microphone, clock,
 * transcription) is injected through the "ports" defined at the bottom of
 * this file, which is what makes the examiner fully testable with a
 * simulated clock.
 */

export type Part = 1 | 2 | 3;

/** What the student chose to practice. */
export type ExamMode = "part1" | "part2" | "part3" | "full";

/**
 * - `exam`   follows the real test strictly (no captions, no pause, one repeat).
 * - `guided` adds spoken time cues, captions, a pause button and unlimited repeats.
 */
export type Fidelity = "exam" | "guided";

/** A single line the examiner can say. `key` is stable; `text` is what is spoken. */
export interface Clip {
  key: string;
  text: string;
}

// ---------------------------------------------------------------------------
// Content (what the database will hold later)
// ---------------------------------------------------------------------------

export interface Part1Question {
  id: string;
  text: string;
  /** If true, a short answer may be followed by "Why?" / "Why not?". */
  allowWhyProbe?: boolean;
}

export interface Part1Topic {
  id: string;
  title: string;
  /** e.g. "Now, let's talk about walking." */
  intro: string;
  /** The first Part 1 frame is always about the candidate (work/study, home). */
  isCore?: boolean;
  questions: Part1Question[];
}

export interface Part3Question {
  id: string;
  text: string;
  /** Simpler wording used if the student does not respond or asks to repeat. */
  rephrase?: string;
  /** Probes used when an answer is too short, e.g. "Why do you think that is?" */
  followUps?: string[];
  /** Admin label (opinion, reasons, …) for organising questions; the engine ignores it. */
  kind?: string;
}

export interface Part3Subtopic {
  id: string;
  title: string;
  /** e.g. "Let's consider first of all theatre culture." */
  intro: string;
  questions: Part3Question[];
}

export interface CueCard {
  id: string;
  /** Text printed on the card: "Describe a play or a film you have seen…" */
  prompt: string;
  bullets: string[];
  /** "and explain why you would like to see this play or film again with friends." */
  explain: string;
  /** What the examiner says aloud when handing over the card. */
  spokenPrompt: string;
  /** One or two short questions after the long turn. */
  roundOff: { id: string; text: string }[];
  /** Part 3 intro used in the full test (refers back to the Part 2 topic). */
  part3Intro: string;
  /** Part 3 intro used when Part 3 is practiced on its own. */
  part3OnlyIntro: string;
  part3: Part3Subtopic[];
}

export interface ExamContent {
  /** Part 1 frames in the order they are asked (core frame first). */
  part1: Part1Topic[];
  cueCard: CueCard;
}

// ---------------------------------------------------------------------------
// Timing policies
// ---------------------------------------------------------------------------

export type PolicyId = "name" | "p1" | "p1_probe" | "p2_long" | "p2_roundoff" | "p3" | "p3_followup";

export interface TurnPolicy {
  id: PolicyId;
  /** Mic open with no speech for this long → no response. `null` disables. */
  noResponseMs: number | null;
  /** Speech required before a normal end-of-turn silence can end the answer. */
  minSpeechMs: number;
  /** Elapsed time (since mic open) required before end-of-turn can trigger. */
  minElapsedMs: number;
  /** Silence after speech that ends the turn. */
  endSilenceMs: number;
  /** Silence that ends a turn whose speech is still under `minSpeechMs` (e.g. "Yes."). */
  extendedSilenceMs: number;
  /**
   * If the student falls silent this long before `minElapsedMs`, the turn
   * reports `early_stop` so the examiner can encourage them (Part 2 only).
   */
  earlyStopSilenceMs: number | null;
  /** Hard cut-off measured from mic open. */
  hardCapMs: number;
  /** Below this speech time an answer counts as "short" (probe may follow). */
  shortAnswerMs: number | null;
  /** Shown in the UI / report as the ideal answer length. */
  targetMs: [number, number] | null;
}

export interface PartBudget {
  /** Never exceed this part duration (except to finish one capped answer). */
  hardMs: number;
  /** After this, stop starting new questions once the minimums are met. */
  softMs: number;
  /** Estimated time an answer takes, used for "will another question fit?". */
  estAnswerMs: number;
  /** Do not start a new frame/sub-topic with less time than this left. */
  minGroupStartMs: number;
  minQuestionsPerGroup: number;
  minQuestionsPerPart: number;
}

export interface EnginePolicies {
  turns: Record<PolicyId, TurnPolicy>;
  /** Max wait for live analysis of a take before falling back to rules (ms). */
  analysisTimeoutMs: number;
  /** Long-turn analysis gets longer (larger audio). */
  longTurnAnalysisTimeoutMs: number;
  /** Hard cap on the whole session; parts end early once it is reached. */
  sessionCapMs: Record<ExamMode, number>;
  budgets: { p1: PartBudget; p3: PartBudget };
  /** Part 2 preparation time. */
  prepMs: number;
  /** Guided mode: spoken "ten seconds left" during preparation. */
  prepWarningMs: number;
  /** Wait for a natural pause this long after the hard cap before interrupting. */
  graceMs: number;
  /** Silence after the examiner finishes before the mic opens. */
  tailMs: number;
  /** Neutral pause after an answer before the examiner continues. */
  gapMs: number;
  /** Max time to wait for a quick transcript to choose "Why?" vs "Why not?". */
  polarityWaitMs: number;
  /** Max P3 follow-up probes per part. */
  maxP3Probes: number;
  /** Ask the second Part 2 round-off question only if Part 2 is under this. */
  secondRoundOffBeforeMs: number;
  /** Engine tick resolution. */
  tickMs: number;
}

// ---------------------------------------------------------------------------
// Blueprint (compiled, ordered exam plan)
// ---------------------------------------------------------------------------

export type Step =
  | { kind: "say"; clip: Clip; part?: Part }
  | { kind: "part_start"; part: Part }
  | { kind: "part_end"; part: Part }
  | {
      kind: "group_intro";
      part: 1 | 3;
      group: string;
      clip: Clip;
    }
  | {
      kind: "ask";
      part: 1 | 3;
      group: string;
      questionId: string;
      clip: Clip;
      policy: PolicyId;
      /** P1: "Why?" probe allowed. */
      allowWhyProbe?: boolean;
      /** P3: rephrased question. */
      rephrase?: Clip;
      /** P3: follow-up probes. */
      followUps?: Clip[];
    }
  | { kind: "ask_name"; clip: Clip }
  | { kind: "cuecard_show" }
  | { kind: "cuecard_hide" }
  | { kind: "prep" }
  | { kind: "long_turn" }
  | { kind: "round_off"; index: number; questionId: string; clip: Clip }
  | { kind: "close"; clip: Clip };

export interface Blueprint {
  version: 1;
  mode: ExamMode;
  fidelity: Fidelity;
  /** Examiner persona id (voice folder) and display name. */
  examiner: { id: string; name: string };
  steps: Step[];
  /** Every clip the session may play (for prefetching). */
  clips: Clip[];
  cueCard: CueCard | null;
}

// ---------------------------------------------------------------------------
// Turn outcomes and answers
// ---------------------------------------------------------------------------

export type TurnOutcome =
  /** Natural end: student stopped and stayed silent. */
  | "end_of_turn"
  /** Student never started speaking. */
  | "no_response"
  /** Hard cap reached; examiner interrupted. */
  | "interrupted"
  /** Student pressed "Finish answer". */
  | "manual_finish"
  /** Part 2: student went silent before the minimum time. */
  | "early_stop"
  /** Student asked for the question again (before speaking). */
  | "repeat_requested";

export interface TurnResult {
  outcome: TurnOutcome;
  openedAt: number;
  closedAt: number;
  /** Time from mic open to close. */
  durationMs: number;
  /** Total detected speech time. */
  speechMs: number;
  /** Time from mic open to first speech (latency before answering). */
  firstSpeechLatencyMs: number | null;
}

export interface AnswerRecord {
  id: string;
  part: Part | 0; // 0 = opening (name), not scored
  questionId: string;
  question: string;
  kind: "name" | "main" | "probe" | "long_turn" | "round_off";
  outcome: Exclude<TurnOutcome, "repeat_requested" | "early_stop">;
  durationMs: number;
  speechMs: number;
  firstSpeechLatencyMs: number | null;
  repeats: number;
  scored: boolean;
}

// ---------------------------------------------------------------------------
// Events and snapshots (for UI, logging and replay)
// ---------------------------------------------------------------------------

export interface EngineEvent {
  seq: number;
  t: number;
  type:
    | "session_start"
    | "say"
    | "listen_open"
    | "listen_close"
    | "answer"
    | "skip"
    | "part_start"
    | "part_end"
    | "prep_start"
    | "prep_end"
    | "paused"
    | "resumed"
    | "end_requested"
    | "session_end"
    | "interaction"
    | "error";
  data?: Record<string, unknown>;
}

export type Phase =
  | "idle"
  | "loading"
  | "speaking"
  | "listening"
  /** The examiner is analysing what the candidate just said. */
  | "considering"
  | "preparing"
  | "gap"
  | "paused"
  | "ended";

export interface TimerInfo {
  kind: "answer" | "prep" | "long_turn";
  startedAt: number;
  limitMs: number;
  /** Long turn: the 1-minute mark. */
  minMs?: number;
  targetMs?: [number, number] | null;
}

export interface Snapshot {
  phase: Phase;
  mode: ExamMode;
  fidelity: Fidelity;
  part: Part | 0;
  /** Text currently being spoken (for captions). */
  caption: string | null;
  /** Current question text (shown in Guided mode or with captions on). */
  question: string | null;
  cueCardVisible: boolean;
  timer: TimerInfo | null;
  speechDetected: boolean;
  canRepeat: boolean;
  canFinish: boolean;
  canPause: boolean;
  canSkipPrep: boolean;
  /** Part progress for the progress bar. */
  partsInMode: Part[];
  loadProgress: { done: number; total: number } | null;
  /** Set when the engine paused itself because of a problem (e.g. mic lost). */
  error: string | null;
  endReason: "completed" | "ended_early" | null;
  /** Number of answers recorded so far. */
  answered: number;
}

// ---------------------------------------------------------------------------
// Ports (implemented by the browser in production and by fakes in tests)
// ---------------------------------------------------------------------------

export interface Clock {
  now(): number;
  /** Resolves after `ms`; rejects with an AbortError if `signal` aborts. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export interface Speaker {
  /** Prefetch / decode every clip before the exam starts. */
  prepare(clips: Clip[], onProgress?: (done: number, total: number) => void): Promise<void>;
  /** Speak a clip; resolves when finished; rejects with AbortError on abort. */
  say(clip: Clip, signal: AbortSignal): Promise<void>;
}

export type VoiceEvent = { type: "speech_start" | "speech_end"; at: number };

export interface Recording {
  blob: Blob | null;
  mimeType: string;
  durationMs: number;
}

export interface Microphone {
  /** Start a new recording take (mic is closed while the examiner speaks). */
  open(): Promise<void>;
  /** Pause the take while the examiner speaks briefly mid-turn (Part 2 nudges). */
  pause(): void;
  resume(): void;
  /** Stop the take. `keep=false` discards the audio. */
  close(keep: boolean): Promise<Recording | null>;
  /** Subscribe to voice-activity events. Returns an unsubscribe function. */
  onVoice(cb: (e: VoiceEvent) => void): () => void;
}

export interface Cues {
  /** Short tone when the mic opens. */
  listen(): Promise<void>;
  /** Chime when time is up (Part 2). */
  timeUp(): Promise<void>;
}

/**
 * Receives each finished answer. Must not block the exam: the engine does not
 * await it, except for a short race to read the transcript when it needs to
 * choose between "Why?" and "Why not?".
 */
export type AnswerSink = (answer: AnswerRecord, recording: Recording | null) => Promise<{ transcript?: string } | void>;

/** Metadata for one recorded take (one mic opening), sent for live analysis. */
export interface TakeMeta {
  takeId: string;
  part: Part | 0;
  questionId: string;
  question: string;
  kind: AnswerRecord["kind"];
  /** 0 for the first take of a question, 1+ for takes after a repeat/clarify/continue. */
  attempt: number;
  outcome: TurnOutcome;
  speechMs: number;
  durationMs: number;
  firstSpeechLatencyMs: number | null;
  scored: boolean;
}

/**
 * Live listening port: transcribes a take, works out what the candidate
 * meant (answer, repeat request, …) and stores it. Implemented by the browser
 * (calls /api/turn); omitted in plain engine tests.
 */
export interface TurnAnalyzer {
  analyze(take: TakeMeta, recording: Recording | null): Promise<import("./interaction").TurnAnalysis>;
}

export interface EnginePorts {
  clock: Clock;
  speaker: Speaker;
  mic: Microphone;
  cues: Cues;
  onAnswer: AnswerSink;
  analyzer?: TurnAnalyzer;
  /** Optional hook for every engine event (e.g. score a part as soon as it ends). */
  onEvent?: (e: EngineEvent) => void;
}
