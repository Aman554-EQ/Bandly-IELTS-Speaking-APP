import { describe, expect, it } from "vitest";
import {
  ACADEMIC_READING_TABLE,
  bandLabel,
  bandRanges,
  GENERAL_READING_TABLE,
  LISTENING_TABLE,
  overallBand,
  rawNeededFor,
  rawToBand,
} from "./band-score";

describe("overall band (official rounding)", () => {
  it("rounds .25 up to .5 and .75 up to the next band", () => {
    expect(overallBand([6.5, 6.5, 5, 7])).toBe(6.5); // 6.25
    expect(overallBand([6.5, 6.5, 7, 7])).toBe(7); // 6.75
    expect(overallBand([6, 6, 6, 6.5])).toBe(6); // 6.125
    expect(overallBand([6, 6.5, 6.5, 6.5])).toBe(6.5); // 6.375
    expect(overallBand([7, 7, 7, 7.5])).toBe(7); // 7.125
    expect(overallBand([8.5, 8, 7, 7.5])).toBe(8); // 7.75, the screenshot
    expect(overallBand([9, 9, 9, 9])).toBe(9);
    expect(overallBand([])).toBe(0);
  });
});

describe("raw score → band", () => {
  it("listening", () => {
    expect(rawToBand(40, LISTENING_TABLE)).toBe(9);
    expect(rawToBand(35, LISTENING_TABLE)).toBe(8);
    expect(rawToBand(30, LISTENING_TABLE)).toBe(7);
    expect(rawToBand(23, LISTENING_TABLE)).toBe(6);
    expect(rawToBand(0, LISTENING_TABLE)).toBe(0);
  });

  it("General Training reading needs more correct answers than Academic", () => {
    expect(rawToBand(30, ACADEMIC_READING_TABLE)).toBe(7);
    expect(rawToBand(30, GENERAL_READING_TABLE)).toBe(6);
    expect(rawNeededFor(7, ACADEMIC_READING_TABLE)).toBe(30);
    expect(rawNeededFor(7, GENERAL_READING_TABLE)).toBe(34);
  });

  it("clamps odd input", () => {
    expect(rawToBand(55, LISTENING_TABLE)).toBe(9);
    expect(rawToBand(-3, LISTENING_TABLE)).toBe(0);
    expect(rawToBand(Number.NaN, LISTENING_TABLE)).toBe(0);
    expect(rawToBand(29.9, LISTENING_TABLE)).toBe(6.5);
  });

  it("every table covers 0–40 with no gaps and bands only go down", () => {
    for (const t of [LISTENING_TABLE, ACADEMIC_READING_TABLE, GENERAL_READING_TABLE]) {
      const r = bandRanges(t);
      expect(r[0].to).toBe(40);
      expect(r[r.length - 1].from).toBe(0);
      for (let i = 1; i < r.length; i++) {
        expect(r[i].to).toBe(r[i - 1].from - 1);
        expect(r[i].band).toBeLessThan(r[i - 1].band);
      }
    }
    expect(bandLabel(7.5)).toBe("Good user");
  });
});
