import { describe, expect, it } from "vitest";
import { overallBand, roundIeltsBand } from "./bands";

describe("IELTS band rounding", () => {
  it.each([
    [6.0, 6.0],
    [6.125, 6.0],
    [6.25, 6.5],
    [6.375, 6.5],
    [6.5, 6.5],
    [6.625, 6.5],
    [6.75, 7.0],
    [6.875, 7.0],
    [9.4, 9.0],
    [-1, 0],
  ])("%d → %d", (mean, band) => {
    expect(roundIeltsBand(mean)).toBe(band);
  });

  it("averages four criteria", () => {
    expect(overallBand([6, 6, 7, 6])).toBe(6.5); // 6.25
    expect(overallBand([7, 7, 7, 6])).toBe(7.0); // 6.75
    expect(overallBand([5, 6, 6, 6])).toBe(6.0); // 5.75 → next whole band
    expect(overallBand([5, 5, 6, 6])).toBe(5.5); // 5.5
  });
});
