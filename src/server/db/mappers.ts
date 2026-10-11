/** Pure mappings between the app's session shapes (types.ts) and database rows. Shared by repo.ts and scripts. */
import { DEFAULT_POLICIES } from "@/engine/policies";
import type { ExamMode, Fidelity } from "@/engine/types";
import type { SectionKind } from "./content";
import type { examAttempts } from "./schema";
import type { FinalReport, SessionStatus } from "./types";

export type AttemptStatus = (typeof examAttempts.$inferSelect)["status"];
export type EndReason = "completed" | "ended_early";

export const KIND_BY_MODE: Record<ExamMode, SectionKind> = {
  part1: "part_1",
  part2: "part_2",
  part3: "part_3",
  full: "full_test",
};

export const MODE_BY_KIND: Record<SectionKind, ExamMode> = {
  part_1: "part1",
  part_2: "part2",
  part_3: "part3",
  full_test: "full",
};

export function toSessionStatus(status: AttemptStatus, endReason: EndReason | null): SessionStatus {
  switch (status) {
    case "in_progress":
    case "scoring":
    case "scored":
    case "score_failed":
      return status;
    case "submitted":
      return endReason ?? "completed";
    default: // expired, abandoned
      return "ended_early";
  }
}

export function toAttemptStatus(status: SessionStatus): { status: AttemptStatus; endReason?: EndReason } {
  if (status === "completed" || status === "ended_early") return { status: "submitted", endReason: status };
  return { status };
}

/** Feedback rows written for a final report (overall summary + one per part). */
export function feedbackRowsFor(report: FinalReport): { body: string; metadata: Record<string, unknown> }[] {
  return [
    ...(report.summary ? [{ body: report.summary, metadata: { kind: "overall" } }] : []),
    ...report.parts
      .filter((p) => p.feedback)
      .map((p) => ({ body: p.feedback, metadata: { kind: "part", part: p.part, band: p.band } })),
  ];
}

/**
 * How long an attempt may stay open: the engine's session cap plus slack for
 * slow scoring uploads (exam style) or pauses (guided style).
 */
export function deadlineMs(mode: ExamMode, fidelity: Fidelity): number {
  return DEFAULT_POLICIES.sessionCapMs[mode] + (fidelity === "guided" ? 60 : 10) * 60_000;
}
