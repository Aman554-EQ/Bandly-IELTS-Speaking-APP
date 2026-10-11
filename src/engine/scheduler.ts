import type { PartBudget } from "./types";

/**
 * Dynamic question trimming (plan-2 §4.7).
 *
 * The blueprint over-provisions questions; the scheduler decides, just before
 * each topic intro or question, whether it still fits in the part's time
 * budget. This is what a real examiner does: ask as many questions as fit,
 * finish started topics sensibly, and never overrun the part.
 */

export interface PartProgress {
  /** Milliseconds since the part started. */
  elapsedMs: number;
  /** Main questions asked so far in this part. */
  askedInPart: number;
  /** Main questions asked so far in the current group (topic / sub-topic). */
  askedInGroup: number;
  /** Total main questions available in this part (caps the minimums). */
  availableInPart: number;
  /** Main questions available in the current group. */
  availableInGroup: number;
}

export type ScheduleDecision = "ask" | "end_part";

export function planNext(
  budget: PartBudget,
  progress: PartProgress,
  /** True when deciding whether to start a new group (its intro line). */
  groupStarting: boolean,
): ScheduleDecision {
  const minPart = Math.min(budget.minQuestionsPerPart, progress.availableInPart);
  const minGroup = Math.min(budget.minQuestionsPerGroup, progress.availableInGroup);
  const remaining = budget.hardMs - progress.elapsedMs;
  const partMinimumMet = progress.askedInPart >= minPart;

  // 1. The hard budget is final.
  if (remaining <= 0) return "end_part";

  // 2. Don't open a new topic without enough time to do it justice.
  if (groupStarting) {
    if (partMinimumMet && remaining < budget.minGroupStartMs) return "end_part";
    if (partMinimumMet && progress.elapsedMs >= budget.softMs) return "end_part";
    return "ask";
  }

  // 3. A started topic always gets its minimum number of questions.
  if (progress.askedInGroup < minGroup) return "ask";

  // 4. Past the soft budget: wrap up once the part minimum is met.
  if (partMinimumMet && progress.elapsedMs >= budget.softMs) return "end_part";

  // 5. Another answer would not fit.
  if (partMinimumMet && remaining < budget.estAnswerMs) return "end_part";

  return "ask";
}
