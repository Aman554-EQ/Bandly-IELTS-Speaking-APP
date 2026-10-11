import { describe, expect, it } from "vitest";
import { DEFAULT_POLICIES } from "./policies";
import { planNext, type PartProgress } from "./scheduler";

const B = DEFAULT_POLICIES.budgets.p1;
const base: PartProgress = { elapsedMs: 0, askedInPart: 0, askedInGroup: 0, availableInPart: 12, availableInGroup: 4 };

describe("planNext (Part 1 budget)", () => {
  it("asks while there is time", () => {
    expect(planNext(B, { ...base, elapsedMs: 60_000, askedInPart: 3, askedInGroup: 3 }, false)).toBe("ask");
  });

  it("ends the part once the hard budget is used", () => {
    expect(planNext(B, { ...base, elapsedMs: 300_000, askedInPart: 2, askedInGroup: 1 }, false)).toBe("end_part");
  });

  it("finishes the minimum questions of a started topic even after the soft budget", () => {
    expect(planNext(B, { ...base, elapsedMs: 280_000, askedInPart: 8, askedInGroup: 1 }, false)).toBe("ask");
  });

  it("wraps up after the soft budget when minimums are met", () => {
    expect(planNext(B, { ...base, elapsedMs: 272_000, askedInPart: 8, askedInGroup: 2 }, false)).toBe("end_part");
  });

  it("does not open a new topic with under a minute left", () => {
    expect(planNext(B, { ...base, elapsedMs: 245_000, askedInPart: 7 }, true)).toBe("end_part");
    expect(planNext(B, { ...base, elapsedMs: 200_000, askedInPart: 7 }, true)).toBe("ask");
  });

  it("keeps asking until the part minimum is met", () => {
    expect(planNext(B, { ...base, elapsedMs: 290_000, askedInPart: 3, askedInGroup: 3 }, false)).toBe("ask");
  });

  it("caps minimums at the number of available questions", () => {
    const small = { ...base, availableInPart: 4, availableInGroup: 4 };
    expect(planNext(B, { ...small, elapsedMs: 272_000, askedInPart: 4, askedInGroup: 4 }, false)).toBe("end_part");
  });

  it("never asks past the hard budget for any input (sweep)", () => {
    for (let elapsed = 0; elapsed <= 400_000; elapsed += 5_000) {
      for (let asked = 0; asked <= 12; asked++) {
        for (const groupStarting of [true, false]) {
          const d = planNext(
            B,
            { ...base, elapsedMs: elapsed, askedInPart: asked, askedInGroup: asked % 5 },
            groupStarting,
          );
          if (elapsed >= B.hardMs) expect(d).toBe("end_part");
        }
      }
    }
  });
});
