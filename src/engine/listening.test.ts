import { describe, expect, it } from "vitest";
import { SAMPLE_SET } from "@/content/sample-set";
import { compileBlueprint } from "./compiler";
import type { TurnAnalysis } from "./interaction";
import { ExamRuntime } from "./runtime";
import { FakeAnalyzer, FakeMic, FakeSpeaker, silentCues, speech, type StudentScript } from "./testing/fakes";
import { VirtualClock } from "./testing/virtual-clock";
import type { ExamMode, Fidelity, TakeMeta } from "./types";

/**
 * Live listening scenarios: the examiner reacts to WHAT the candidate says,
 * not just to silence and timing.
 */

type Says = (take: TakeMeta) => Partial<TurnAnalysis> | undefined;

function setup(
  mode: ExamMode,
  says: Says,
  opts: { fidelity?: Fidelity; student?: StudentScript; delayMs?: number } = {},
) {
  const clock = new VirtualClock();
  const speaker = new FakeSpeaker(clock);
  const student: StudentScript =
    opts.student ??
    ((key) => {
      if (key === "p2.prep.end" || key === "p2.cardinfo") {
        return [
          [1_500, 50_000],
          [51_000, 100_000],
        ];
      }
      return speech(9_000);
    });
  const mic = new FakeMic(clock, speaker, student);
  const analyzer = new FakeAnalyzer(clock, says, opts.delayMs);
  const bp = compileBlueprint({ mode, fidelity: opts.fidelity ?? "exam", content: SAMPLE_SET, localHour: 9 });
  const rt = new ExamRuntime(bp, { clock, speaker, mic, cues: silentCues, onAnswer: async () => {}, analyzer });
  return { clock, speaker, rt, analyzer, run: () => clock.run(rt.start()) };
}

/** Spoken keys right after the first time `key` is spoken. */
function after(spoken: string[], key: string, n: number) {
  const i = spoken.indexOf(key);
  expect(i, `${key} was never spoken`).toBeGreaterThan(-1);
  return spoken.slice(i + 1, i + 1 + n);
}

const onFirstTake =
  (qid: string, analysis: Partial<TurnAnalysis>): Says =>
  (t) =>
    t.questionId === qid && t.attempt === 0 ? analysis : undefined;

describe("live listening: the examiner reacts to what is said", () => {
  it("repeats the question when the candidate asks (instead of moving on)", async () => {
    const h = setup(
      "part1",
      onFirstTake("walking-1", { intent: "repeat_request", transcript: "Sorry, can you repeat that?" }),
    );
    await h.run();
    expect(after(h.speaker.spoken, "c.p1.walking-1", 3)).toEqual(["ack.ofcourse", "c.p1.walking-1", "c.p1.walking-2"]);
    const takes = h.analyzer.takes.filter((t) => t.questionId === "walking-1");
    expect(takes.map((t) => t.attempt)).toEqual([0, 1]);
  });

  it("refuses a third repeat in exam style, then moves on if asked again", async () => {
    const h = setup("part1", (t) => (t.questionId === "walking-1" ? { intent: "repeat_request" } : undefined));
    await h.run();
    expect(after(h.speaker.spoken, "c.p1.walking-1", 7)).toEqual([
      "ack.ofcourse",
      "c.p1.walking-1",
      "ack.ofcourse",
      "c.p1.walking-1",
      "repeat.limit",
      "p1.moveon",
      "c.p1.walking-2",
    ]);
  });

  it("Part 1: cannot explain a word, then accepts the answer", async () => {
    const h = setup(
      "part1",
      onFirstTake("walking-4", { intent: "clarification_request", transcript: "What does walking holiday mean?" }),
    );
    await h.run();
    expect(after(h.speaker.spoken, "c.p1.walking-4", 1)).toEqual(["clarify.p1"]);
  });

  it("Part 3: rephrases when the candidate does not understand", async () => {
    const h = setup("part3", onFirstTake("theatre-2", { intent: "clarification_request" }));
    await h.run();
    expect(after(h.speaker.spoken, "c.p3.theatre-2", 2)).toEqual(["p3.rephrase", "c.p3.theatre-2.rephrase"]);
  });

  it("keeps listening when the candidate stops mid-thought and merges the answer", async () => {
    const h = setup(
      "part1",
      onFirstTake("walking-3", { intent: "incomplete", transcript: "Well, there is a park and" }),
    );
    await h.run();
    // No examiner line in exam style: the mic simply opens again.
    expect(after(h.speaker.spoken, "c.p1.walking-3", 1)).toEqual(["c.p1.walking-4"]);
    const a = h.rt.answers.find((x) => x.questionId === "walking-3")!;
    expect(a.speechMs).toBe(18_000); // two takes of 9 s
  });

  it("guided style reassures with 'Take your time.'", async () => {
    const h = setup("part1", onFirstTake("walking-3", { intent: "incomplete" }), { fidelity: "guided" });
    await h.run();
    expect(after(h.speaker.spoken, "c.p1.walking-3", 1)).toEqual(["guide.takeyourtime"]);
  });

  it("deflects 'What about you?' and re-asks the question", async () => {
    const h = setup("part1", onFirstTake("walking-1", { intent: "question_to_examiner" }));
    await h.run();
    expect(after(h.speaker.spoken, "c.p1.walking-1", 2)).toEqual(["deflect.opinion", "c.p1.walking-1"]);
  });

  it("'I don't know' in Part 1: 'That's all right.' and next question", async () => {
    const h = setup("part1", onFirstTake("walking-2", { intent: "dont_know", transcript: "I don't know." }));
    await h.run();
    expect(after(h.speaker.spoken, "c.p1.walking-2", 2)).toEqual(["skip.ok", "c.p1.walking-3"]);
  });

  it("off-topic answer: re-asks once", async () => {
    const h = setup("part1", onFirstTake("walking-1", { intent: "off_topic" }));
    await h.run();
    expect(after(h.speaker.spoken, "c.p1.walking-1", 2)).toEqual(["reask.lead", "c.p1.walking-1"]);
  });

  it("a stop request gets instructions, not an abrupt end", async () => {
    const h = setup("part1", onFirstTake("walking-1", { intent: "stop_request" }));
    await h.run();
    expect(after(h.speaker.spoken, "c.p1.walking-1", 1)).toEqual(["stop.info"]);
    expect(h.rt.getSnapshot().endReason).toBe("completed");
  });

  it("uses the LLM's polarity for 'Why not?'", async () => {
    const h = setup(
      "part1",
      onFirstTake("walking-4", { intent: "answer", quality: "minimal", polarity: "negative", transcript: "No." }),
      { student: (key) => (key === "c.p1.walking-4" ? speech(900) : speech(9_000)) },
    );
    await h.run();
    expect(after(h.speaker.spoken, "c.p1.walking-4", 1)).toEqual(["p1.whynot"]);
  });

  it("Part 3: uses the probe the LLM suggests for a short answer", async () => {
    const h = setup("part3", onFirstTake("actor-1", { intent: "answer", quality: "short", probe: "example" }), {
      student: (key) => (key === "c.p3.actor-1" ? speech(5_000) : speech(30_000)),
    });
    await h.run();
    expect(after(h.speaker.spoken, "c.p3.actor-1", 1)).toEqual(["probe.example"]);
  });

  it("Part 2: a question about the task points to the card and the talk continues", async () => {
    const h = setup(
      "part2",
      (t) =>
        t.kind === "long_turn" && t.attempt === 0
          ? { intent: "repeat_request", transcript: "Sorry, what is the topic?" }
          : undefined,
      {
        student: (key) =>
          key === "p2.prep.end" ? speech(3_000, 800) : key === "p2.cardinfo" ? speech(90_000, 1_000) : speech(9_000),
      },
    );
    await h.run();
    expect(after(h.speaker.spoken, "p2.prep.end", 2)).toEqual(["p2.cardinfo", "ack.thanks"]);
    const lt = h.rt.answers.find((a) => a.kind === "long_turn")!;
    expect(lt.speechMs).toBe(90_000); // the question itself is not counted as the talk
  });

  it("falls back gracefully when analysis is too slow", async () => {
    const h = setup("part1", () => ({ intent: "repeat_request" }), { delayMs: 60_000 });
    await h.run();
    // Every take timed out → treated as answers; the exam still completes.
    expect(h.speaker.spoken).not.toContain("ack.ofcourse");
    expect(h.rt.getSnapshot().endReason).toBe("completed");
  });

  it("logs every interaction decision for the timeline and conduct report", async () => {
    const h = setup("part1", onFirstTake("walking-1", { intent: "repeat_request" }));
    await h.run();
    const ev = h.rt.events.filter((e) => e.type === "interaction" && e.data?.questionId === "walking-1");
    expect(ev.map((e) => [e.data!.intent, e.data!.action])).toEqual([
      ["repeat_request", "repeat"],
      ["answer", "accept"],
    ]);
  });

  it("a full test with an analyzer still finishes within the session cap", async () => {
    const h = setup("full", (t) => (t.attempt === 0 && t.kind === "main" ? { intent: "repeat_request" } : undefined));
    await h.run();
    const end = h.rt.events.at(-1)!;
    expect(end.type).toBe("session_end");
    expect(end.t).toBeLessThanOrEqual(20 * 60_000 + 3 * 60_000);
  });
});
