import { describe, expect, it } from "vitest";
import { SAMPLE_SET } from "@/content/sample-set";
import { compileBlueprint } from "./compiler";
import { DEFAULT_POLICIES } from "./policies";
import { ExamRuntime } from "./runtime";
import { FakeMic, FakeSpeaker, silentCues, speech, type Segments, type StudentScript } from "./testing/fakes";
import { VirtualClock } from "./testing/virtual-clock";
import type { AnswerRecord, ExamMode, Fidelity } from "./types";

interface Harness {
  clock: VirtualClock;
  speaker: FakeSpeaker;
  rt: ExamRuntime;
  answers: AnswerRecord[];
  run: (hook?: (now: number, rt: ExamRuntime) => void) => Promise<void>;
}

function setup(
  mode: ExamMode,
  student: StudentScript,
  opts: { fidelity?: Fidelity; transcript?: (a: AnswerRecord) => string | undefined } = {},
): Harness {
  const clock = new VirtualClock();
  const speaker = new FakeSpeaker(clock);
  const mic = new FakeMic(clock, speaker, student);
  const answers: AnswerRecord[] = [];
  const blueprint = compileBlueprint({ mode, fidelity: opts.fidelity ?? "exam", content: SAMPLE_SET, localHour: 9 });
  const rt = new ExamRuntime(blueprint, {
    clock,
    speaker,
    mic,
    cues: silentCues,
    onAnswer: async (a) => {
      answers.push(a);
      return { transcript: opts.transcript?.(a) };
    },
  });
  return {
    clock,
    speaker,
    rt,
    answers,
    run: (hook) => clock.run(rt.start(), { hook: hook ? (now) => hook(now, rt) : undefined }),
  };
}

/** A cooperative student: name 2 s, answers ~20 s, long turn 105 s, Part 3 ~40 s. */
const typical: StudentScript = (key) => {
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
};

const mainKeys = (h: Harness) => h.answers.filter((a) => a.kind === "main").map((a) => a.questionId);

describe("ExamRuntime — Part 1", () => {
  it("runs the full examiner script in order for a cooperative student", async () => {
    const h = setup("part1", typical);
    await h.run();
    expect(h.speaker.spoken.slice(0, 8)).toEqual([
      "open.greet.morning",
      "open.purpose",
      "open.name",
      "ack.thanks",
      "open.format.part1",
      "open.begin",
      "p1.intro",
      "c.p1.work-study.intro",
    ]);
    expect(h.speaker.spoken.at(-1)).toBe("close.part");
    expect(mainKeys(h)).toEqual([
      "work-study-1",
      "work-study-2",
      "work-study-3",
      "walking-1",
      "walking-2",
      "walking-3",
      "walking-4",
    ]);
    expect(h.answers[0]).toMatchObject({ kind: "name", scored: false });
    expect(h.rt.getSnapshot()).toMatchObject({ phase: "ended", endReason: "completed" });
  });

  it("repeats the question once on silence, then moves on", async () => {
    const h = setup("part1", (key) => (key === "c.p1.walking-1" ? [] : typical(key, 0)));
    await h.run();
    const s = h.speaker.spoken;
    const i = s.indexOf("c.p1.walking-1");
    expect(s.slice(i, i + 4)).toEqual(["c.p1.walking-1", "p1.repeat", "c.p1.walking-1", "p1.moveon"]);
    expect(h.answers.find((a) => a.questionId === "walking-1")).toMatchObject({ outcome: "no_response", repeats: 1 });
  });

  it("interrupts a long answer at the hard cap with 'Thank you.'", async () => {
    const h = setup("part1", (key) => (key === "c.p1.walking-3" ? speech(70_000) : typical(key, 0)));
    await h.run();
    const a = h.answers.find((x) => x.questionId === "walking-3")!;
    expect(a.outcome).toBe("interrupted");
    expect(a.durationMs).toBeGreaterThanOrEqual(DEFAULT_POLICIES.turns.p1.hardCapMs);
    expect(a.durationMs).toBeLessThanOrEqual(DEFAULT_POLICIES.turns.p1.hardCapMs + DEFAULT_POLICIES.graceMs + 100);
    const s = h.speaker.spoken;
    expect(s[s.indexOf("c.p1.walking-3") + 1]).toBe("ack.thanks");
  });

  it("asks 'Why?' after a short answer to a probe-able question", async () => {
    const h = setup("part1", (key) => (key === "c.p1.walking-2" ? speech(800) : typical(key, 0)));
    await h.run();
    const s = h.speaker.spoken;
    expect(s[s.indexOf("c.p1.walking-2") + 1]).toBe("p1.why");
    expect(h.answers.some((a) => a.kind === "probe" && a.questionId === "walking-2#probe")).toBe(true);
  });

  it("asks 'Why not?' when the quick transcript is negative", async () => {
    const h = setup("part1", (key) => (key === "c.p1.walking-4" ? speech(700) : typical(key, 0)), {
      transcript: (a) => (a.questionId === "walking-4" ? "No, not really." : undefined),
    });
    await h.run();
    const s = h.speaker.spoken;
    expect(s[s.indexOf("c.p1.walking-4") + 1]).toBe("p1.whynot");
  });

  it("does not probe questions that are not flagged", async () => {
    const h = setup("part1", (key) => (key === "c.p1.walking-1" ? speech(800) : typical(key, 0)));
    await h.run();
    const s = h.speaker.spoken;
    expect(s[s.indexOf("c.p1.walking-1") + 1]).toBe("c.p1.walking-2");
  });

  it("stays within the Part 1 time budget even with long answers", async () => {
    const h = setup("part1", (key) => (key.startsWith("c.p1.") ? speech(60_000) : typical(key, 0)));
    await h.run();
    const end = h.rt.events.find((e) => e.type === "part_end")!;
    const limit = DEFAULT_POLICIES.budgets.p1.hardMs + DEFAULT_POLICIES.turns.p1.hardCapMs + 10_000;
    expect(end.data!.durationMs as number).toBeLessThanOrEqual(limit);
    expect(h.rt.events.some((e) => e.type === "skip")).toBe(true);
    expect(mainKeys(h).length).toBeGreaterThanOrEqual(DEFAULT_POLICIES.budgets.p1.minQuestionsPerPart);
  });
});

describe("ExamRuntime — Part 2", () => {
  const prepTimes = (h: Harness) => {
    const ev = h.rt.events;
    const start = ev.find((e) => e.type === "say" && e.data?.key === "p2.prep.start")!;
    const end = ev.find((e) => e.type === "prep_end")!;
    return { start, end };
  };

  it("gives exactly one minute of preparation after 'Your time starts now'", async () => {
    const h = setup("part2", typical);
    await h.run();
    const { start, end } = prepTimes(h);
    const lineMs = Math.max(600, "You have one minute to prepare. Your time starts now.".split(/\s+/).length * 400);
    expect(end.t - (start.t + lineMs)).toBe(DEFAULT_POLICIES.prepMs);
  });

  it("stops the long turn at two minutes with the time-up line", async () => {
    const h = setup("part2", (key) => (key === "p2.prep.end" ? speech(150_000, 1_000) : typical(key, 0)));
    await h.run();
    const lt = h.answers.find((a) => a.kind === "long_turn")!;
    expect(lt.outcome).toBe("interrupted");
    expect(lt.durationMs).toBeGreaterThanOrEqual(120_000);
    expect(lt.durationMs).toBeLessThanOrEqual(121_600);
    const s = h.speaker.spoken;
    expect(s[s.indexOf("p2.prep.end") + 1]).toBe("p2.timeup");
  });

  it("encourages a student who stops before one minute, once", async () => {
    const h = setup("part2", (key) => {
      if (key === "p2.prep.end") return speech(25_000, 1_000);
      if (key === "p2.more") return speech(40_000, 1_000);
      return typical(key, 0);
    });
    await h.run();
    const s = h.speaker.spoken;
    const i = s.indexOf("p2.prep.end");
    expect(s.slice(i + 1, i + 3)).toEqual(["p2.more", "ack.thanks"]);
    expect(s.filter((k) => k === "p2.more")).toHaveLength(1);
    const lt = h.answers.find((a) => a.kind === "long_turn")!;
    expect(lt.speechMs).toBe(65_000);
  });

  it("asks one or two round-off questions, then collects the notes", async () => {
    const h = setup("part2", typical);
    await h.run();
    const roundOffs = h.answers.filter((a) => a.kind === "round_off");
    expect(roundOffs.length).toBeGreaterThanOrEqual(1);
    const s = h.speaker.spoken;
    expect(s.indexOf("p2.notes.away")).toBeGreaterThan(s.indexOf("c.p2.film-again-r1"));
    expect(h.rt.getSnapshot().cueCardVisible).toBe(false);
  });

  it("guided mode speaks the ten-seconds warning and allows starting early", async () => {
    const h = setup("part2", typical, { fidelity: "guided" });
    let skipped = false;
    await h.run((now, rt) => {
      if (!skipped && rt.getSnapshot().canSkipPrep && h.speaker.spoken.includes("p2.prep.10s")) {
        skipped = true;
        rt.skipPrep();
      }
    });
    expect(h.speaker.spoken).toContain("p2.prep.10s");
    expect(h.rt.events.find((e) => e.type === "prep_end")!.data).toEqual({ skipped: true });
  });
});

describe("ExamRuntime — Part 3", () => {
  it("rephrases (not repeats) on silence", async () => {
    const h = setup("part3", (key) => (key === "c.p3.theatre-1" ? [] : typical(key, 0)));
    await h.run();
    const s = h.speaker.spoken;
    const i = s.indexOf("c.p3.theatre-1");
    expect(s.slice(i, i + 3)).toEqual(["c.p3.theatre-1", "p3.rephrase", "c.p3.theatre-1.rephrase"]);
  });

  it("asks a follow-up after a short answer, at most twice per part", async () => {
    const h = setup("part3", (key) =>
      key.startsWith("c.p3.") && !key.includes(".fu") && !key.includes("intro") ? speech(5_000) : typical(key, 0),
    );
    await h.run();
    const followUps = h.speaker.spoken.filter((k) => /\.fu\d$/.test(k));
    expect(followUps).toHaveLength(DEFAULT_POLICIES.maxP3Probes);
  });

  it("uses the standalone intro when practiced alone", async () => {
    const h = setup("part3", typical);
    await h.run();
    expect(h.speaker.spoken).toContain("c.p3.film-again.only_intro");
  });
});

describe("ExamRuntime — full test", () => {
  it("completes in 11–15 minutes with formal part transitions", async () => {
    const h = setup("full", typical);
    await h.run();
    const end = h.rt.events.at(-1)!;
    expect(end.type).toBe("session_end");
    const minutes = end.t / 60_000;
    expect(minutes).toBeGreaterThanOrEqual(11);
    expect(minutes).toBeLessThanOrEqual(15);
    const s = h.speaker.spoken;
    for (const k of ["p1.end", "p2.intro", "p2.end", "c.p3.film-again.intro", "p3.end", "close.full"]) {
      expect(s).toContain(k);
    }
  });

  it("is deterministic: same inputs produce the same event log", async () => {
    const a = setup("full", typical);
    const b = setup("full", typical);
    await a.run();
    await b.run();
    expect(a.rt.events).toEqual(b.rt.events);
  });
});

describe("ExamRuntime — controls", () => {
  it("ends early with the formal closing line", async () => {
    const h = setup("part1", typical);
    await h.run((now, rt) => {
      if (rt.getSnapshot().phase === "listening" && h.answers.length >= 2) rt.endTest();
    });
    expect(h.speaker.spoken.at(-1)).toBe("close.early");
    expect(h.rt.getSnapshot().endReason).toBe("ended_early");
  });

  it("abort stops at once without the closing line (page left mid-exam)", async () => {
    const h = setup("part1", typical);
    let spokenAtAbort = -1;
    await h.run((now, rt) => {
      if (spokenAtAbort < 0 && rt.getSnapshot().phase === "listening" && h.answers.length >= 1) {
        spokenAtAbort = h.speaker.spoken.length;
        rt.abort();
      }
    });
    expect(h.speaker.spoken).not.toContain("close.early");
    expect(h.speaker.spoken.length).toBe(spokenAtAbort);
    expect(h.rt.wasAborted).toBe(true);
    expect(h.rt.getSnapshot().phase).toBe("ended");
    expect(h.rt.getSnapshot().endReason).toBe("ended_early");
  });

  it("abort during a guided pause still ends the exam", async () => {
    const h = setup("part1", typical, { fidelity: "guided" });
    let paused = false;
    await h.run((now, rt) => {
      const phase = rt.getSnapshot().phase;
      if (!paused && phase === "listening") {
        paused = true;
        rt.pause();
      } else if (phase === "paused") rt.abort();
    });
    expect(h.rt.getSnapshot().phase).toBe("ended");
  });

  it("ignores user pause in Exam mode", async () => {
    const h = setup("part1", typical);
    let tried = false;
    await h.run((now, rt) => {
      if (!tried && rt.getSnapshot().phase === "listening") {
        tried = true;
        rt.pause();
      }
    });
    expect(h.rt.events.some((e) => e.type === "paused")).toBe(false);
  });

  it("guided pause re-asks the current question after resuming", async () => {
    const h = setup("part1", typical, { fidelity: "guided" });
    let paused = false;
    let resumeAt = 0;
    await h.run((now, rt) => {
      const snap = rt.getSnapshot();
      if (!paused && snap.phase === "listening" && h.speaker.lastKey === "c.p1.walking-1") {
        paused = true;
        rt.pause();
        resumeAt = now + 5_000;
        h.clock.at(resumeAt, () => rt.resume());
      }
    });
    const s = h.speaker.spoken;
    const i = s.indexOf("resume.continue");
    expect(i).toBeGreaterThan(-1);
    expect(s[i + 1]).toBe("c.p1.walking-1");
    expect(h.answers.filter((a) => a.questionId === "walking-1")).toHaveLength(1);
  });

  it("finish-answer ends the turn immediately", async () => {
    const segs: Segments = [[500, 30_000]];
    const h = setup("part1", (key) => (key === "c.p1.work-study-2" ? segs : typical(key, 0)));
    let done = false;
    await h.run((now, rt) => {
      const snap = rt.getSnapshot();
      if (
        !done &&
        snap.canFinish &&
        h.speaker.lastKey === "c.p1.work-study-2" &&
        snap.timer &&
        now - snap.timer.startedAt > 5_000
      ) {
        done = true;
        rt.finishAnswer();
      }
    });
    const a = h.answers.find((x) => x.questionId === "work-study-2")!;
    expect(a.outcome).toBe("manual_finish");
    expect(a.durationMs).toBeLessThan(6_000);
  });
});
