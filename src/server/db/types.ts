/**
 * Shapes stored in the local JSON data store (data/). These mirror the
 * future Postgres tables (plan-2 §5.3) so the move to a real database is a
 * storage swap, not a redesign.
 */
import type { ExaminerId } from "@/engine/examiners";
import type { TurnAnalysis } from "@/engine/interaction";
import type { AnswerRecord, EngineEvent, ExamContent, ExamMode, Fidelity, Part, TurnOutcome } from "@/engine/types";
import type { SpeechFeatures } from "../features";

export interface QuestionSet {
  id: string;
  title: string;
  description: string;
  source: string;
  content: ExamContent;
}

export interface QuestionBank {
  version: number;
  updatedAt: string;
  sets: QuestionSet[];
}

/** One recorded take (one mic opening) and what the examiner understood. */
export interface TurnRecord {
  takeId: string;
  seq: number;
  part: Part | 0;
  questionId: string;
  question: string;
  kind: AnswerRecord["kind"];
  attempt: number;
  outcome: TurnOutcome;
  speechMs: number;
  durationMs: number;
  firstSpeechLatencyMs: number | null;
  scored: boolean;
  transcript: string;
  features: SpeechFeatures | null;
  analysis: Omit<TurnAnalysis, "transcript">;
  sttModel: string | null;
  analysisModel: string | null;
  createdAt: string;
}

export type CriterionKey = "fluency" | "lexical" | "grammar" | "pronunciation";

export interface CriterionResult {
  /** Final band after conduct adjustments. */
  band: number;
  /** Band the assessor gave before adjustments. */
  assessedBand: number;
  summary: string;
  evidence: string[];
  improvements: string[];
}

/** Counts of interaction events in a part (from live listening). */
export interface Conduct {
  repeatRequests: number;
  clarifications: number;
  examinerQuestions: number;
  metaQuestions: number;
  stopRequests: number;
  dontKnow: number;
  noResponses: number;
  offTopic: number;
}

export interface Adjustment {
  criterion: CriterionKey;
  delta: number;
  reason: string;
}

export interface PartReport {
  part: Part;
  /** Band for this part (IELTS rounding of its four criteria), null if not enough speech. */
  band: number | null;
  criteria: Record<CriterionKey, CriterionResult> | null;
  feedback: string;
  improvedAnswers: { question: string; original: string; improved: string }[];
  vocabularyUpgrades: { instead: string; try: string }[];
  priorities: string[];
  conduct: Conduct;
  adjustments: Adjustment[];
  sampleNote: string | null;
  speechSeconds: number;
  questionsAnswered: number;
  model: string | null;
  promptVersion: string;
  scoredAt: string;
}

export interface FinalReport {
  mode: ExamMode;
  overall: number | null;
  criteria: Record<CriterionKey, number> | null;
  parts: PartReport[];
  summary: string;
  strengths: string[];
  priorities: string[];
  model: string | null;
  promptVersion: string;
  createdAt: string;
}

export type SessionStatus = "in_progress" | "completed" | "ended_early" | "scoring" | "scored" | "score_failed";

export interface ExamSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  mode: ExamMode;
  fidelity: Fidelity;
  examinerId: ExaminerId;
  setId: string;
  setTitle: string;
  status: SessionStatus;
  endReason: "completed" | "ended_early" | null;
  durationMs: number | null;
  turns: TurnRecord[];
  events: EngineEvent[];
  partReports: Partial<Record<"1" | "2" | "3", PartReport>>;
  report: FinalReport | null;
  error: string | null;
}

export interface SessionSummary {
  id: string;
  createdAt: string;
  mode: ExamMode;
  fidelity: Fidelity;
  examinerId: ExaminerId;
  setTitle: string;
  status: SessionStatus;
  overall: number | null;
  partBands: Partial<Record<"1" | "2" | "3", number | null>>;
  durationMs: number | null;
  turns: number;
}
