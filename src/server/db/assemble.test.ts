import { describe, expect, it } from "vitest";
import { cueOp } from "@/content/cue-card-ops";
import { slugify } from "@/content/ops-common";
import { SAMPLE_SET } from "@/content/sample-set";
import { testOp } from "@/content/test-ops";
import {
  availableParts,
  type CardData,
  contentForTest,
  cueCardContent,
  type GroupView,
  looseContent,
  type P1Question,
  type P3Question,
  PartNotAvailableError,
  publishProblems,
  type TestParts,
  testLabel,
} from "./assemble";

const q = <Q>(question: Q, i: number, status: "published" | "archived" = "published") => ({
  id: `q${i}`,
  examQuestionId: `eq${i}`,
  position: i,
  status,
  question,
  usedBy: 0,
});

/** The sample set as v2 parts. */
function sampleParts(): TestParts {
  const { part3, ...card } = SAMPLE_SET.cueCard;
  const p1: GroupView<P1Question>[] = SAMPLE_SET.part1.map((t, i) => ({
    id: `g1-${i}`,
    title: t.title,
    intro: t.intro,
    isCore: Boolean(t.isCore),
    engineKey: t.id,
    position: i + 1,
    questions: t.questions.map((x, j) => q(x, j)),
  }));
  const p3: GroupView<P3Question>[] = part3.map((t, i) => ({
    id: `g3-${i}`,
    title: t.title,
    intro: t.intro,
    isCore: false,
    engineKey: t.id,
    position: i + 1,
    questions: t.questions.map((x, j) => q(x as P3Question, j)),
  }));
  return {
    part1: { sectionId: "s1", groups: p1 },
    part2: { sectionId: "s2", card: { ...q(card as CardData, 0), card: card as CardData } },
    part3: { sectionId: "s3", groups: p3 },
    full: { sectionId: "sf", sequence: ["s1", "s2", "s3"] },
  };
}

describe("parts a test offers", () => {
  it("a complete test offers all four, and its content equals the original set", () => {
    const p = sampleParts();
    expect(availableParts(p)).toEqual(["part1", "part2", "part3", "full"]);
    expect(contentForTest(p, "full")).toEqual(SAMPLE_SET);
  });

  it("parts that are not included are not offered (and not reported)", () => {
    const { part1, part2 } = sampleParts();
    expect(availableParts({ part1, part2 })).toEqual(["part1", "part2"]);
    expect(publishProblems({ part1, part2 })).toEqual([]);
  });

  it("Part 3 needs the cue card; the full test needs its explicit sequence", () => {
    const p = sampleParts();
    expect(availableParts({ ...p, part2: { sectionId: "s2", card: null } })).toEqual(["part1"]);
    expect(availableParts({ ...p, full: { sectionId: "sf", sequence: ["s1", "s3", "s2"] } })).toEqual([
      "part1",
      "part2",
      "part3",
    ]);
  });

  it("archived questions don't count towards the minimum", () => {
    const p = sampleParts();
    const g = p.part3!.groups;
    const archivedAll = g.map((x) => ({
      ...x,
      questions: x.questions.map((y) => ({ ...y, status: "archived" as const })),
    }));
    expect(availableParts({ ...p, part3: { sectionId: "s3", groups: archivedAll } })).toEqual(["part1", "part2"]);
  });

  it("asking for a missing part explains why", () => {
    expect(() => contentForTest({ part1: { sectionId: "s1", groups: [] } }, "part1")).toThrow(PartNotAvailableError);
    expect(() => contentForTest({ part1: { sectionId: "s1", groups: [] } }, "part1")).toThrow(
      /Part 1 has no topic yet/,
    );
  });

  it("an empty test lists what to add", () => {
    expect(publishProblems({})).toEqual(["Add at least one part (Part 1, Part 2 or Part 3)."]);
  });

  it("a Makkar card is Part 2 content with no other parts", () => {
    const { part3: _p3, ...card } = SAMPLE_SET.cueCard;
    const c = cueCardContent(card);
    expect(c.part1).toEqual([]);
    expect(c.cueCard.part3).toEqual([]);
    expect(looseContent({}).cueCard.prompt).toBe("");
  });
});

describe("labels", () => {
  it("reads like the brief", () => {
    expect(testLabel({ categoryTitle: "Cambridge", bookTitle: "Cambridge 21", number: 4, title: null })).toBe(
      "Cambridge 21, Test 4",
    );
    expect(testLabel({ categoryTitle: "Practice Test Exam", bookTitle: null, number: 2, title: "Walking" })).toBe(
      "Practice Test Exam, Test 2",
    );
    expect(
      testLabel({ categoryTitle: "Recent Real Test Questions", bookTitle: null, number: null, title: "Old set" }),
    ).toBe("Old set");
    expect(slugify("Cambridge 22")).toBe("cambridge-22");
  });
});

describe("operation schemas", () => {
  const id = "0192f000-0000-7000-8000-000000000000";
  it("a full test can only be chosen with all three parts", () => {
    const base = { op: "test.create", categoryId: id, number: 1 };
    expect(testOp.safeParse({ ...base, parts: { part1: true, part2: true, part3: true, full: true } }).success).toBe(
      true,
    );
    expect(testOp.safeParse({ ...base, parts: { part1: true, part2: false, part3: true, full: true } }).success).toBe(
      false,
    );
    expect(
      testOp.safeParse({ ...base, parts: { part1: false, part2: false, part3: false, full: false } }).success,
    ).toBe(false);
  });

  it("test numbers are whole numbers from 1", () => {
    const base = { op: "test.update", id };
    expect(testOp.safeParse({ ...base, number: 4 }).success).toBe(true);
    expect(testOp.safeParse({ ...base, number: 0 }).success).toBe(false);
    expect(testOp.safeParse({ ...base, number: 1.5 }).success).toBe(false);
  });

  it("question fields depend on the part (no follow-ups in Part 1)", () => {
    expect(
      testOp.safeParse({ op: "question.create", topicId: id, fields: { part: 1, text: "Q?", followUps: ["Why?"] } })
        .success,
    ).toBe(false);
    expect(
      testOp.safeParse({ op: "question.create", topicId: id, fields: { part: 3, text: "Q?", followUps: ["Why?"] } })
        .success,
    ).toBe(true);
  });

  it("bulk add takes 1–50 questions; Part 3 types come from a fixed list", () => {
    const base = { op: "question.createMany", topicId: id };
    expect(testOp.safeParse({ ...base, texts: ["A?", "B?"], kind: "opinion" }).success).toBe(true);
    expect(testOp.safeParse({ ...base, texts: [] }).success).toBe(false);
    expect(testOp.safeParse({ ...base, texts: Array(51).fill("Q?") }).success).toBe(false);
    expect(testOp.safeParse({ ...base, texts: ["A?"], kind: "gossip" }).success).toBe(false);
    expect(
      testOp.safeParse({ op: "question.update", id, fields: { part: 1, text: "Q?", kind: "opinion" } }).success,
    ).toBe(false);
    expect(testOp.safeParse({ op: "topic.copy", id, testId: id }).success).toBe(true);
    expect(testOp.safeParse({ op: "question.regroup", id, topicId: "x" }).success).toBe(false);
  });

  it("cards need a bullet; unknown fields are refused", () => {
    expect(
      cueOp.safeParse({ op: "cueCard.create", topicId: id, fields: { prompt: "P", bullets: [], explain: "e" } })
        .success,
    ).toBe(false);
    expect(cueOp.safeParse({ op: "cueTopic.create", title: "People", status: "published" }).success).toBe(false);
  });
});
