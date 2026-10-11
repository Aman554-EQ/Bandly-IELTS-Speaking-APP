import { describe, expect, it } from "vitest";
import { cleanTranscript, countFillers, countRepetitions, extractFeatures, mattr, tokenize } from "./features";
import type { WhisperVerbose } from "./groq";

const seg = (text: string, extra: Partial<WhisperVerbose["segments"] & object> = {}) => ({
  start: 0,
  end: 3,
  text,
  avg_logprob: -0.2,
  no_speech_prob: 0.01,
  compression_ratio: 1.3,
  ...extra,
});

describe("cleanTranscript", () => {
  it("removes known silence hallucinations", () => {
    const r: WhisperVerbose = {
      text: " I walk to work. Thank you for watching.",
      duration: 6,
      segments: [seg(" I walk to work."), seg(" Thank you for watching.")],
    };
    expect(cleanTranscript(r)).toEqual({ text: "I walk to work.", removed: 1 });
  });

  it("drops segments that are probably silence", () => {
    const r: WhisperVerbose = {
      text: " Yes. you",
      duration: 6,
      segments: [seg(" Yes."), { ...seg(" you"), no_speech_prob: 0.9, avg_logprob: -1.2 }],
    };
    expect(cleanTranscript(r).text).toBe("Yes.");
  });
});

describe("feature helpers", () => {
  it("counts fillers including phrases", () => {
    expect(countFillers("Um, I think, uh, you know, it's sort of nice")).toBe(4);
  });

  it("counts immediate repetitions but not filler repeats", () => {
    expect(countRepetitions(tokenize("I I think the the park um um is nice"))).toBe(2);
  });

  it("MATTR is 1 for all-different words and lower for repetitive speech", () => {
    expect(mattr(tokenize("one two three four"))).toBe(1);
    expect(mattr(tokenize("good good good good"))).toBe(0.25);
  });
});

describe("extractFeatures", () => {
  it("computes rate, pauses and runs from word timestamps", () => {
    const words = [
      { word: "I", start: 0.0, end: 0.2 },
      { word: "usually", start: 0.3, end: 0.8 },
      { word: "walk", start: 0.9, end: 1.2 },
      { word: "um", start: 2.6, end: 2.9 }, // 1.4 s pause before
      { word: "to", start: 3.0, end: 3.1 },
      { word: "work", start: 3.2, end: 3.6 },
    ];
    const r: WhisperVerbose = {
      text: "I usually walk um to work",
      duration: 4,
      words,
      segments: [seg("I usually walk um to work")],
    };
    const f = extractFeatures(r, r.text);
    expect(f.wordCount).toBe(6);
    expect(f.pausesOver1s).toBe(1);
    expect(f.longestPauseSec).toBe(1.4);
    expect(f.fillerCount).toBe(1);
    expect(f.meanLengthOfRun).toBe(3);
    expect(f.speechRateWpm).toBe(90);
    expect(f.articulationWpm).toBeGreaterThan(f.speechRateWpm);
  });
});
