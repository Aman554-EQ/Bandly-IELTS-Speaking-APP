import type { EnginePolicies, TurnPolicy } from "./types";

/**
 * Timing policies (plan-2 §4.5). Later these move to `app_settings` so a
 * superadmin can tune them without a deploy; the engine only ever receives a
 * snapshot, so a running exam is never affected by a change.
 */
export const DEFAULT_POLICIES: EnginePolicies = {
  analysisTimeoutMs: 6_000,
  longTurnAnalysisTimeoutMs: 10_000,
  // Real test: 11–14 min. Repeats and clarifications may stretch it; never beyond these.
  sessionCapMs: { part1: 9 * 60_000, part2: 8 * 60_000, part3: 9 * 60_000, full: 20 * 60_000 },
  turns: {
    name: {
      id: "name",
      noResponseMs: 8_000,
      minSpeechMs: 500,
      minElapsedMs: 0,
      endSilenceMs: 1_500,
      extendedSilenceMs: 1_500,
      earlyStopSilenceMs: null,
      hardCapMs: 10_000,
      shortAnswerMs: null,
      targetMs: null,
    },
    p1: {
      id: "p1",
      noResponseMs: 6_000,
      minSpeechMs: 2_000,
      minElapsedMs: 0,
      endSilenceMs: 2_000,
      extendedSilenceMs: 4_000,
      earlyStopSilenceMs: null,
      hardCapMs: 40_000,
      shortAnswerMs: 4_000,
      targetMs: [15_000, 30_000],
    },
    p1_probe: {
      id: "p1_probe",
      noResponseMs: 6_000,
      minSpeechMs: 1_000,
      minElapsedMs: 0,
      endSilenceMs: 2_000,
      extendedSilenceMs: 3_000,
      earlyStopSilenceMs: null,
      hardCapMs: 30_000,
      shortAnswerMs: null,
      targetMs: [5_000, 20_000],
    },
    p2_long: {
      id: "p2_long",
      noResponseMs: 8_000,
      minSpeechMs: 0,
      minElapsedMs: 60_000,
      endSilenceMs: 4_000,
      extendedSilenceMs: 4_000,
      earlyStopSilenceMs: 5_000,
      hardCapMs: 120_000,
      shortAnswerMs: null,
      targetMs: [90_000, 120_000],
    },
    p2_roundoff: {
      id: "p2_roundoff",
      noResponseMs: 6_000,
      minSpeechMs: 1_500,
      minElapsedMs: 0,
      endSilenceMs: 1_800,
      extendedSilenceMs: 3_000,
      earlyStopSilenceMs: null,
      hardCapMs: 25_000,
      shortAnswerMs: null,
      targetMs: [5_000, 15_000],
    },
    p3: {
      id: "p3",
      noResponseMs: 8_000,
      minSpeechMs: 4_000,
      minElapsedMs: 0,
      endSilenceMs: 2_500,
      extendedSilenceMs: 4_000,
      earlyStopSilenceMs: null,
      hardCapMs: 75_000,
      shortAnswerMs: 8_000,
      targetMs: [30_000, 60_000],
    },
    p3_followup: {
      id: "p3_followup",
      noResponseMs: 8_000,
      minSpeechMs: 2_000,
      minElapsedMs: 0,
      endSilenceMs: 2_500,
      extendedSilenceMs: 4_000,
      earlyStopSilenceMs: null,
      hardCapMs: 60_000,
      shortAnswerMs: null,
      targetMs: [15_000, 45_000],
    },
  },
  budgets: {
    p1: {
      hardMs: 300_000,
      softMs: 270_000,
      estAnswerMs: 20_000,
      minGroupStartMs: 60_000,
      minQuestionsPerGroup: 2,
      minQuestionsPerPart: 6,
    },
    p3: {
      hardMs: 300_000,
      softMs: 270_000,
      estAnswerMs: 45_000,
      minGroupStartMs: 75_000,
      minQuestionsPerGroup: 2,
      minQuestionsPerPart: 4,
    },
  },
  prepMs: 60_000,
  prepWarningMs: 10_000,
  graceMs: 1_500,
  tailMs: 300,
  gapMs: 600,
  polarityWaitMs: 2_500,
  maxP3Probes: 2,
  secondRoundOffBeforeMs: 210_000,
  tickMs: 100,
};

/**
 * Returns a copy of the policies with every duration divided by `factor`.
 * Used by tests and the demo "fast" mode; the relative timing is unchanged.
 */
export function scalePolicies(p: EnginePolicies, factor: number): EnginePolicies {
  const s = (ms: number) => Math.max(1, Math.round(ms / factor));
  const sn = (ms: number | null) => (ms === null ? null : s(ms));
  const turns = Object.fromEntries(
    Object.entries(p.turns).map(([k, t]): [string, TurnPolicy] => [
      k,
      {
        ...t,
        noResponseMs: sn(t.noResponseMs),
        minSpeechMs: s(t.minSpeechMs),
        minElapsedMs: t.minElapsedMs === 0 ? 0 : s(t.minElapsedMs),
        endSilenceMs: s(t.endSilenceMs),
        extendedSilenceMs: s(t.extendedSilenceMs),
        earlyStopSilenceMs: sn(t.earlyStopSilenceMs),
        hardCapMs: s(t.hardCapMs),
        shortAnswerMs: sn(t.shortAnswerMs),
        targetMs: t.targetMs ? [s(t.targetMs[0]), s(t.targetMs[1])] : null,
      },
    ]),
  ) as EnginePolicies["turns"];
  const b = (x: EnginePolicies["budgets"]["p1"]) => ({
    ...x,
    hardMs: s(x.hardMs),
    softMs: s(x.softMs),
    estAnswerMs: s(x.estAnswerMs),
    minGroupStartMs: s(x.minGroupStartMs),
  });
  return {
    ...p,
    turns,
    budgets: { p1: b(p.budgets.p1), p3: b(p.budgets.p3) },
    prepMs: s(p.prepMs),
    prepWarningMs: s(p.prepWarningMs),
    graceMs: s(p.graceMs),
    tailMs: s(p.tailMs),
    gapMs: s(p.gapMs),
    polarityWaitMs: s(p.polarityWaitMs),
    analysisTimeoutMs: s(p.analysisTimeoutMs),
    longTurnAnalysisTimeoutMs: s(p.longTurnAnalysisTimeoutMs),
    sessionCapMs: Object.fromEntries(
      Object.entries(p.sessionCapMs).map(([k, v]) => [k, s(v)]),
    ) as EnginePolicies["sessionCapMs"],
    secondRoundOffBeforeMs: s(p.secondRoundOffBeforeMs),
    tickMs: Math.max(1, Math.min(p.tickMs, s(p.tickMs))),
  };
}
