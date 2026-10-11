/**
 * LIVE integration test of the core feature: the examiner listens, analyses
 * and responds, using the REAL server pipeline (Whisper + LLM via Groq).
 *
 * The exam engine runs on a virtual clock (fast and deterministic). For each
 * take, a real spoken recording (Kokoro-generated WAV) is sent to the running
 * dev server's /api/sessions/:id/turns endpoint, so transcription, intent
 * detection, storage and scoring are all real.
 *
 * Run:  pnpm dev   (another terminal)
 *       GROQ_LIVE=1 LIVE_BASE_URL=http://localhost:3000 pnpm test:live
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SAMPLE_SET } from "@/content/sample-set";
import { compileBlueprint } from "@/engine/compiler";
import type { TurnAnalysis } from "@/engine/interaction";
import { ExamRuntime } from "@/engine/runtime";
import { FakeMic, FakeSpeaker, silentCues, speech, type StudentScript } from "@/engine/testing/fakes";
import { VirtualClock } from "@/engine/testing/virtual-clock";
import type { TakeMeta, TurnAnalyzer } from "@/engine/types";
import { loadEnv } from "../../scripts/lib/load-env";
import { testStudentToken } from "../../scripts/lib/clerk-test-token.mjs";

const BASE = process.env.LIVE_BASE_URL ?? "http://localhost:3000";
const LIVE = Boolean(process.env.GROQ_LIVE);

// The API needs a signed-in user: a short-lived session token for the Clerk test student.
loadEnv();
const token: string | null = LIVE ? await testStudentToken(900) : null;
const authFetch = (url: string, init: RequestInit = {}) =>
  fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } });
const fixture = (n: string) => readFileSync(path.resolve(__dirname, "../e2e/fixtures", `say-${n}.wav`));

/** What the student says, by question and attempt (fixture name). */
const SCRIPT: Record<string, string[]> = {
  name: ["repeat", "answer"],
  "work-study-1": ["repeat", "answer"],
  "work-study-2": ["clarify", "answer"],
  "work-study-3": ["dontknow"],
  "walking-1": ["opinion", "answer"],
  "walking-2": ["answer"],
  "walking-3": ["longanswer"], // off-topic (about a film) → re-ask, then accept
  "walking-4": ["answer"],
};

const SPEECH_MS: Record<string, number> = {
  repeat: 2_500,
  clarify: 2_400,
  dontknow: 1_400,
  opinion: 3_100,
  incomplete: 3_300,
  answer: 10_500,
  longanswer: 28_000,
};

function fixtureFor(take: TakeMeta): string {
  const list = SCRIPT[take.questionId] ?? ["answer"];
  return list[Math.min(take.attempt, list.length - 1)];
}

class LiveAnalyzer implements TurnAnalyzer {
  readonly log: { questionId: string; attempt: number; said: string; heard: TurnAnalysis }[] = [];
  constructor(
    private readonly clock: VirtualClock,
    private readonly sessionId: string,
  ) {}

  analyze(take: TakeMeta): Promise<TurnAnalysis> {
    const said = fixtureFor(take);
    const form = new FormData();
    form.append("meta", JSON.stringify(take));
    form.append("audio", new Blob([fixture(said)], { type: "audio/wav" }), `${take.takeId}.wav`);
    const p = authFetch(`${BASE}/api/sessions/${this.sessionId}/turns`, { method: "POST", body: form })
      .then((r) => r.json())
      .then((j: { analysis: TurnAnalysis }) => {
        this.log.push({ questionId: take.questionId, attempt: take.attempt, said, heard: j.analysis });
        return j.analysis;
      });
    return this.clock.hold(p);
  }
}

describe.skipIf(!LIVE)("LIVE: examiner listens and responds (real Whisper + LLM)", () => {
  it("handles repeat, clarification, 'I don't know', 'what about you?', off-topic, then scores Part 1", async () => {
    const created = await authFetch(`${BASE}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "part1", fidelity: "exam", examinerId: "emma" }),
    }).then((r) => r.json());
    const sessionId: string = created.id;

    const clock = new VirtualClock();
    const speaker = new FakeSpeaker(clock);
    // Mic timing per take (VAD): matches the length of the recording that will be "said".
    const student: StudentScript = (key, attempt) => {
      const qid = key === "open.name" ? "name" : key.replace(/^c\.p1\./, "");
      const list = SCRIPT[qid];
      const said = list ? list[Math.min(attempt, list.length - 1)] : "answer";
      return speech(SPEECH_MS[said] ?? 8_000);
    };
    // FakeMic keys attempts by the examiner's LAST line; map follow-up lines back to the question.
    const analyzer = new LiveAnalyzer(clock, sessionId);
    const mic = new FakeMic(clock, speaker, (key, attempt) => student(key, attempt));
    const bp = compileBlueprint({
      mode: "part1",
      fidelity: "exam",
      content: SAMPLE_SET,
      localHour: 9,
      examiner: "emma",
    });
    const rt = new ExamRuntime(bp, { clock, speaker, mic, cues: silentCues, onAnswer: async () => {}, analyzer });
    await clock.run(rt.start());

    // What the examiner understood, per take.
    for (const l of analyzer.log) {
      console.log(
        `${l.questionId}#${l.attempt} said=${l.said.padEnd(10)} heard=${l.heard.intent} [${l.heard.source}] "${l.heard.transcript.slice(0, 50)}"`,
      );
    }
    const heard = (q: string, a: number) =>
      analyzer.log.find((l) => l.questionId === q && l.attempt === a)?.heard.intent;
    expect(heard("name", 0)).toBe("repeat_request");
    expect(heard("work-study-1", 0)).toBe("repeat_request");
    expect(heard("work-study-2", 0)).toBe("clarification_request");
    expect(heard("work-study-3", 0)).toBe("dont_know");
    expect(heard("walking-1", 0)).toBe("question_to_examiner");
    expect(heard("walking-3", 0)).toBe("off_topic");

    // How the examiner responded.
    const s = speaker.spoken;
    const after = (key: string, n: number) => s.slice(s.indexOf(key) + 1, s.indexOf(key) + 1 + n);
    expect(after("open.name", 2)).toEqual(["ack.ofcourse", "open.name"]);
    expect(after("c.p1.work-study-1", 2)).toEqual(["ack.ofcourse", "c.p1.work-study-1"]);
    expect(after("c.p1.work-study-2", 1)).toEqual(["clarify.p1"]);
    expect(after("c.p1.work-study-3", 1)).toEqual(["skip.ok"]);
    expect(after("c.p1.walking-1", 2)).toEqual(["deflect.opinion", "c.p1.walking-1"]);
    expect(after("c.p1.walking-3", 2)).toEqual(["reask.lead", "c.p1.walking-3"]);

    // Store the timeline, then score with the real LLM.
    await authFetch(`${BASE}/api/sessions/${sessionId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endReason: "completed", durationMs: clock.now(), events: rt.events }),
    });
    const report = await authFetch(`${BASE}/api/sessions/${sessionId}/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }).then((r) => r.json());
    console.log(
      "report:",
      report.model,
      "overall",
      report.overall,
      JSON.stringify(report.criteria),
      JSON.stringify(report.parts?.[0]?.conduct),
    );
    expect(report.parts).toHaveLength(1);
    expect(report.overall).toBeGreaterThan(0);
    expect(report.parts[0].conduct.repeatRequests).toBeGreaterThanOrEqual(1);
    expect(report.parts[0].conduct.dontKnow).toBe(1);
    console.log(`Open: ${BASE}/results/${sessionId}`);
  }, 240_000);
});
