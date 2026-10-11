/**
 * Practice settings carried in the URL (step3.md §5: keep the configuration
 * through the whole flow): ?part=part1|part2|part3|full&voice=female|male&style=exam|guided.
 * The old `?mode=` parameter is still read.
 */
import type { ExaminerId } from "@/engine/examiners";
import type { ExamMode, Fidelity } from "@/engine/types";

const MODES: ExamMode[] = ["part1", "part2", "part3", "full"];

export interface PracticeSettings {
  mode: ExamMode;
  examinerId: ExaminerId;
  fidelity: Fidelity;
}

type Search = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export function readPracticeSettings(sp: Search, defaults: Partial<PracticeSettings> = {}): PracticeSettings {
  const part = one(sp.part) ?? one(sp.mode);
  const voice = one(sp.voice);
  const style = one(sp.style);
  return {
    mode: MODES.includes(part as ExamMode) ? (part as ExamMode) : (defaults.mode ?? "part1"),
    examinerId: voice === "male" ? "james" : voice === "female" ? "emma" : (defaults.examinerId ?? "emma"),
    fidelity: style === "guided" || style === "exam" ? style : (defaults.fidelity ?? "exam"),
  };
}

export function practiceSearch(s: PracticeSettings, extra: Record<string, string> = {}): string {
  return new URLSearchParams({
    ...extra,
    part: s.mode,
    voice: s.examinerId === "james" ? "male" : "female",
    style: s.fidelity,
  }).toString();
}
