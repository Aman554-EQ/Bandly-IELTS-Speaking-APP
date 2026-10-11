import { describe, expect, it } from "vitest";
import { DEFAULT_POLICIES } from "./policies";
import { TurnController } from "./turn";
import type { TurnPolicy } from "./types";

const P = DEFAULT_POLICIES.turns;
const GRACE = DEFAULT_POLICIES.graceMs;

/** Ticks every 100 ms from `from` to `to`, returning the first decision. */
function runUntil(tc: TurnController, from: number, to: number) {
  for (let t = from; t <= to; t += 100) {
    const d = tc.tick(t);
    if (d) return d;
  }
  return null;
}

function make(policy: TurnPolicy) {
  return new TurnController(policy, 0, GRACE);
}

describe("TurnController — Part 1 policy", () => {
  it("reports no_response after 6 s of silence", () => {
    const tc = make(P.p1);
    expect(runUntil(tc, 0, 5_900)).toBeNull();
    expect(tc.tick(6_000)).toEqual({ outcome: "no_response", at: 6_000 });
  });

  it("ends the turn after 2 s of silence once 2 s of speech is reached", () => {
    const tc = make(P.p1);
    tc.onVoice({ type: "speech_start", at: 500 });
    tc.onVoice({ type: "speech_end", at: 10_500 });
    expect(runUntil(tc, 10_600, 12_400)).toBeNull();
    expect(tc.tick(12_500)).toEqual({ outcome: "end_of_turn", at: 12_500 });
    expect(tc.speechMs(12_500)).toBe(10_000);
  });

  it("does not end a turn during a short pause between sentences", () => {
    const tc = make(P.p1);
    tc.onVoice({ type: "speech_start", at: 500 });
    tc.onVoice({ type: "speech_end", at: 5_000 });
    expect(runUntil(tc, 5_100, 6_900)).toBeNull(); // 1.9 s pause
    tc.onVoice({ type: "speech_start", at: 6_900 });
    expect(runUntil(tc, 7_000, 15_000)).toBeNull();
  });

  it("uses the extended silence for very short answers like 'Yes.'", () => {
    const tc = make(P.p1);
    tc.onVoice({ type: "speech_start", at: 1_000 });
    tc.onVoice({ type: "speech_end", at: 1_600 });
    expect(runUntil(tc, 1_700, 5_500)).toBeNull(); // < 4 s extended silence
    expect(tc.tick(5_600)).toEqual({ outcome: "end_of_turn", at: 5_600 });
  });

  it("waits for a natural pause after the hard cap (graceful interruption)", () => {
    const tc = make(P.p1);
    tc.onVoice({ type: "speech_start", at: 500 });
    expect(runUntil(tc, 600, 40_000)).toBeNull(); // cap reached at 40 s while speaking
    expect(tc.onVoice({ type: "speech_end", at: 40_700 })).toEqual({ outcome: "interrupted", at: 40_700 });
  });

  it("interrupts anyway when no pause comes within the grace window", () => {
    const tc = make(P.p1);
    tc.onVoice({ type: "speech_start", at: 500 });
    const d = runUntil(tc, 600, 45_000);
    expect(d).toEqual({ outcome: "interrupted", at: 40_000 + GRACE });
  });

  it("allows a repeat only before the student has really started answering", () => {
    const tc = make(P.p1);
    expect(tc.canRepeat(100)).toBe(true);
    tc.onVoice({ type: "speech_start", at: 200 });
    expect(tc.canRepeat(900)).toBe(true);
    expect(tc.canRepeat(1_300)).toBe(false);
  });
});

describe("TurnController — Part 2 long turn", () => {
  it("never ends naturally before the 1-minute mark", () => {
    const tc = make(P.p2_long);
    tc.onVoice({ type: "speech_start", at: 1_000 });
    tc.onVoice({ type: "speech_end", at: 30_000 });
    // early_stop after 5 s of silence, but not end_of_turn
    expect(runUntil(tc, 30_100, 34_900)).toBeNull();
    expect(tc.tick(35_000)).toEqual({ outcome: "early_stop", at: 35_000 });
    // early_stop fires only once
    expect(runUntil(tc, 35_100, 59_900)).toBeNull();
    // after 60 s the long silence ends the turn
    expect(tc.tick(60_000)).toEqual({ outcome: "end_of_turn", at: 60_000 });
  });

  it("stops the student at exactly 2 minutes (+ grace)", () => {
    const tc = make(P.p2_long);
    tc.onVoice({ type: "speech_start", at: 2_000 });
    expect(runUntil(tc, 2_100, 120_000)).toBeNull();
    expect(tc.onVoice({ type: "speech_end", at: 120_400 })).toEqual({ outcome: "interrupted", at: 120_400 });
  });

  it("resume() restarts silence and no-response windows but keeps the turn clock", () => {
    const tc = make(P.p2_long);
    expect(tc.tick(8_000)).toEqual({ outcome: "no_response", at: 8_000 });
    tc.resume(12_000); // examiner said "Can you start speaking now, please?"
    expect(runUntil(tc, 12_100, 19_900)).toBeNull();
    expect(tc.tick(20_000)).toEqual({ outcome: "no_response", at: 20_000 });
    expect(tc.startedAt).toBe(0);
  });
});
