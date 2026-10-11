import { describe, expect, it } from "vitest";
import { SAMPLE_SET } from "@/content/sample-set";
import { allContentClips, compileBlueprint } from "./compiler";
import type { Step } from "./types";

const compile = (mode: Parameters<typeof compileBlueprint>[0]["mode"], localHour = 10) =>
  compileBlueprint({ mode, fidelity: "exam", content: SAMPLE_SET, localHour });

/** Compact readable outline of a blueprint. */
function outline(steps: Step[]): string[] {
  return steps.map((s) => {
    switch (s.kind) {
      case "say":
      case "group_intro":
      case "close":
      case "ask_name":
        return `${s.kind}:${s.clip.key}`;
      case "ask":
        return `ask:${s.questionId}`;
      case "round_off":
        return `round_off:${s.questionId}`;
      case "part_start":
      case "part_end":
        return `${s.kind}:${s.part}`;
      default:
        return s.kind;
    }
  });
}

describe("compileBlueprint", () => {
  it("opens every test with greeting, purpose, name, format and 'Let's begin'", () => {
    for (const mode of ["part1", "part2", "part3", "full"] as const) {
      const o = outline(compile(mode).steps);
      expect(o.slice(0, 5)).toEqual([
        "say:open.greet.morning",
        "say:open.purpose",
        "ask_name:open.name",
        `say:open.format.${mode}`,
        "say:open.begin",
      ]);
    }
  });

  it("picks the greeting from the student's local time", () => {
    expect(outline(compile("part1", 14).steps)[0]).toBe("say:open.greet.afternoon");
    expect(outline(compile("part1", 19).steps)[0]).toBe("say:open.greet.evening");
  });

  it("builds Part 1 with the core frame first and closes with the single-part line", () => {
    const o = outline(compile("part1").steps);
    expect(o).toContain("group_intro:c.p1.work-study.intro");
    expect(o.indexOf("group_intro:c.p1.work-study.intro")).toBeLessThan(o.indexOf("group_intro:c.p1.walking.intro"));
    expect(o.filter((x) => x.startsWith("ask:"))).toHaveLength(7);
    expect(o.at(-1)).toBe("close:close.part");
    expect(o).not.toContain("say:p1.end");
  });

  it("builds Part 2: intro → card → prompt → prep → long turn → round-offs → notes away", () => {
    const o = outline(compile("part2").steps);
    const start = o.indexOf("part_start:2");
    expect(o.slice(start, start + 11)).toEqual([
      "part_start:2",
      "say:p2.intro",
      "cuecard_show",
      "say:c.p2.film-again.prompt",
      "prep",
      "long_turn",
      "round_off:film-again-r1",
      "round_off:film-again-r2",
      "say:p2.notes.away",
      "cuecard_hide",
      "part_end:2",
    ]);
  });

  it("uses the standalone Part 3 intro when Part 3 is practiced alone", () => {
    expect(outline(compile("part3").steps)).toContain("say:c.p3.film-again.only_intro");
    expect(outline(compile("full").steps)).toContain("say:c.p3.film-again.intro");
  });

  it("links the full test parts with formal transitions", () => {
    const o = outline(compile("full").steps);
    const order = [
      "part_end:1",
      "say:p1.end",
      "part_start:2",
      "part_end:2",
      "say:p2.end",
      "part_start:3",
      "part_end:3",
      "say:p3.end",
      "close:close.full",
    ];
    const idx = order.map((k) => o.indexOf(k));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it("lists every clip once for prefetching", () => {
    const bp = compile("full");
    const keys = bp.clips.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("c.p3.theatre-1.rephrase");
    expect(keys).toContain("c.p3.actor-3.fu1");
  });

  it("exposes all content clips for the voice renderer", () => {
    const keys = allContentClips(SAMPLE_SET).map((c) => c.key);
    expect(keys).toContain("c.p3.film-again.only_intro");
    expect(keys).toContain("c.p3.film-again.intro");
    expect(keys.every((k) => k.startsWith("c."))).toBe(true);
  });
});
