/**
 * Engine Lab (CLI): simulates an exam with a scripted student on a virtual
 * clock and prints the examiner's timeline. No audio, no network.
 *
 *   pnpm engine:lab full            # cooperative student
 *   pnpm engine:lab part2 --student=short
 *   pnpm engine:lab part1 --guided
 */
import { SAMPLE_SET } from "../src/content/sample-set";
import { compileBlueprint } from "../src/engine/compiler";
import { ExamRuntime } from "../src/engine/runtime";
import { FakeMic, FakeSpeaker, silentCues, speech, type StudentScript } from "../src/engine/testing/fakes";
import { VirtualClock } from "../src/engine/testing/virtual-clock";
import type { ExamMode } from "../src/engine/types";

const students: Record<string, StudentScript> = {
  typical: (key) => {
    if (key === "open.name") return speech(2_000);
    if (key === "p2.prep.end")
      return [
        [1_500, 50_000],
        [51_000, 106_000],
      ];
    if (key.startsWith("c.p3."))
      return [
        [1_200, 20_000],
        [21_000, 40_000],
      ];
    if (key === "p1.why" || key === "p1.whynot") return speech(6_000);
    return [
      [900, 9_000],
      [10_000, 20_000],
    ];
  },
  short: (key) => {
    if (key === "open.name") return speech(1_500);
    if (key === "p2.prep.end") return speech(30_000, 2_000);
    if (key === "p2.more") return speech(20_000, 1_000);
    return speech(1_200, 1_000);
  },
  silent: (key) => (key === "open.name" ? speech(1_500) : []),
  long: (key) => (key === "open.name" ? speech(2_000) : speech(150_000, 700)),
};

const mode = (process.argv[2] ?? "full") as ExamMode;
const studentName = process.argv.find((a) => a.startsWith("--student="))?.split("=")[1] ?? "typical";
const fidelity = process.argv.includes("--guided") ? "guided" : "exam";

const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.${String(ms % 1000)
    .padStart(3, "0")
    .slice(0, 1)}`;
};

async function main() {
  const clock = new VirtualClock();
  const speaker = new FakeSpeaker(clock);
  const mic = new FakeMic(clock, speaker, students[studentName] ?? students.typical);
  const bp = compileBlueprint({ mode, fidelity, content: SAMPLE_SET, localHour: new Date().getHours() });
  const texts = new Map(bp.clips.map((c) => [c.key, c.text]));
  const rt = new ExamRuntime(bp, { clock, speaker, mic, cues: silentCues, onAnswer: async () => {} });
  await clock.run(rt.start());

  console.log(`\nMode: ${mode} · Fidelity: ${fidelity} · Student: ${studentName}\n`);
  for (const e of rt.events) {
    const t = fmt(e.t);
    if (e.type === "say") console.log(`${t}  EXAMINER  ${texts.get(e.data!.key as string) ?? e.data!.key}`);
    else if (e.type === "listen_open") console.log(`${t}  · mic open (${e.data!.policy})`);
    else if (e.type === "listen_close")
      console.log(
        `${t}  · mic closed → ${e.data!.outcome} (speech ${((e.data!.speechMs as number) / 1000).toFixed(1)}s)`,
      );
    else if (e.type === "skip") console.log(`${t}  ~ skipped: ${e.data!.reason}`);
    else if (["part_start", "part_end", "prep_start", "prep_end", "session_end"].includes(e.type))
      console.log(`${t}  [${e.type}] ${e.data ? JSON.stringify(e.data) : ""}`);
  }
  console.log(`\nAnswers recorded: ${rt.answers.length}\n`);
}

main();
