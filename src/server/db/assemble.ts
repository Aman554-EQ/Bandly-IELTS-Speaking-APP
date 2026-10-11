/**
 * Content v2, pure rules (no database): turns a test's parts (topics, questions,
 * cue card) into engine content, decides which parts are available, lists what
 * blocks publishing, and builds the labels students see
 * ("Cambridge 21, Test 4, Part 1"). See step3-redesign-plan.md §3.3–3.4.
 */
import { z } from "zod";
import { P3_KINDS } from "@/content/question-kinds";
import type { CueCard, ExamContent, ExamMode, Part1Topic, Part3Subtopic } from "@/engine/types";

// ------------------------------------------------------------- payloads

/** Stored question payloads. Old rows also carry `topic`/`subtopic`; v2 reads topics from question_groups. */
export const p1QuestionPayload = z.object({
  part: z.literal(1),
  engineId: z.string().min(1),
  question: z.object({ id: z.string().min(1), text: z.string().min(1), allowWhyProbe: z.boolean().optional() }),
});
export const p3QuestionPayload = z.object({
  part: z.literal(3),
  engineId: z.string().min(1),
  question: z.object({
    id: z.string().min(1),
    text: z.string().min(1),
    rephrase: z.string().optional(),
    followUps: z.array(z.string()).optional(),
    kind: z.enum(P3_KINDS).optional(),
  }),
});
export const cardShape = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  bullets: z.array(z.string()).min(1),
  explain: z.string(),
  spokenPrompt: z.string(),
  roundOff: z.array(z.object({ id: z.string(), text: z.string() })),
  part3Intro: z.string(),
  part3OnlyIntro: z.string(),
});
export const p2CardPayload = z.object({ part: z.literal(2), engineId: z.string().min(1), card: cardShape });

export type P1Question = z.infer<typeof p1QuestionPayload>["question"];
export type P3Question = z.infer<typeof p3QuestionPayload>["question"];
export type CardData = z.infer<typeof cardShape>;

// ---------------------------------------------------------------- views

export type PartKey = "part1" | "part2" | "part3";
export type ContentStatus = "draft" | "published" | "archived";

export interface QuestionView<Q> {
  /** questions.id */
  id: string;
  examQuestionId: string;
  position: number;
  status: ContentStatus;
  question: Q;
  /** Takes recorded against it (blocks deleting). */
  usedBy: number;
}

export interface GroupView<Q> {
  id: string;
  title: string;
  intro: string;
  isCore: boolean;
  engineKey: string;
  position: number;
  questions: QuestionView<Q>[];
}

export interface TestParts {
  part1?: { sectionId: string; groups: GroupView<P1Question>[] };
  part2?: { sectionId: string; card: (QuestionView<CardData> & { card: CardData }) | null };
  part3?: { sectionId: string; groups: GroupView<P3Question>[] };
  /** Explicit full-test structure: the three part section ids, in order. */
  full?: { sectionId: string; sequence: string[] };
}

/** Minimum content before students can take a part. */
export const MIN = { part1: 2, part3: 2 } as const;

const live = <Q>(g: GroupView<Q>) => g.questions.filter((q) => q.status !== "archived");
const liveCount = <Q>(groups: GroupView<Q>[]) => groups.reduce((n, g) => n + live(g).length, 0);

/** What is missing in each part (empty list = ready). Parts that are not included report nothing. */
export function partGaps(p: TestParts): Record<PartKey | "full", string[]> {
  const card = p.part2?.card && p.part2.card.status !== "archived" ? p.part2.card : null;
  const gaps: Record<PartKey | "full", string[]> = { part1: [], part2: [], part3: [], full: [] };
  if (p.part1) {
    const n = liveCount(p.part1.groups);
    if (p.part1.groups.length === 0) gaps.part1.push("Part 1 has no topic yet.");
    if (n < MIN.part1) gaps.part1.push(`Part 1 needs at least ${MIN.part1} questions (it has ${n}).`);
  }
  if (p.part2 && !card) gaps.part2.push("Part 2 has no cue card yet.");
  if (p.part3) {
    const n = liveCount(p.part3.groups);
    if (p.part3.groups.length === 0) gaps.part3.push("Part 3 has no discussion topic yet.");
    if (n < MIN.part3) gaps.part3.push(`Part 3 needs at least ${MIN.part3} questions (it has ${n}).`);
    if (!card) gaps.part3.push("Part 3 needs the Part 2 cue card (the examiner uses it to introduce Part 3).");
  }
  if (p.full) {
    const ok =
      p.part1 &&
      p.part2 &&
      p.part3 &&
      p.full.sequence.join() === [p.part1.sectionId, p.part2.sectionId, p.part3.sectionId].join();
    if (!ok) gaps.full.push("The full test needs Part 1, Part 2 and Part 3 in this test.");
    else if (gaps.part1.length || gaps.part2.length || gaps.part3.length) {
      gaps.full.push("The full test needs Parts 1, 2 and 3 to be complete.");
    }
  }
  return gaps;
}

/** Parts students can start (in exam order). */
export function availableParts(p: TestParts): ExamMode[] {
  const g = partGaps(p);
  const out: ExamMode[] = [];
  if (p.part1 && !g.part1.length) out.push("part1");
  if (p.part2 && !g.part2.length) out.push("part2");
  if (p.part3 && !g.part3.length) out.push("part3");
  if (p.full && !g.full.length) out.push("full");
  return out;
}

/** Why a test cannot be published (empty = OK): every included part must be complete. */
export function publishProblems(p: TestParts): string[] {
  if (!p.part1 && !p.part2 && !p.part3) return ["Add at least one part (Part 1, Part 2 or Part 3)."];
  const g = partGaps(p);
  return [...g.part1, ...g.part2, ...g.part3, ...g.full];
}

const NO_CARD: Omit<CueCard, "part3"> = {
  id: "none",
  prompt: "",
  bullets: [],
  explain: "",
  spokenPrompt: "",
  roundOff: [],
  part3Intro: "",
  part3OnlyIntro: "",
};

function p1Topics(p: TestParts): Part1Topic[] {
  return (p.part1?.groups ?? [])
    .map((g) => ({
      id: g.engineKey,
      title: g.title,
      intro: g.intro,
      ...(g.isCore ? { isCore: true } : {}),
      questions: live(g).map((q) => q.question),
    }))
    .filter((t) => t.questions.length > 0);
}

function p3Subtopics(p: TestParts): Part3Subtopic[] {
  return (p.part3?.groups ?? [])
    .map((g) => ({ id: g.engineKey, title: g.title, intro: g.intro, questions: live(g).map((q) => q.question) }))
    .filter((t) => t.questions.length > 0);
}

/** Everything the parts hold, without checks (voice renderer, previews). */
export function looseContent(p: TestParts): ExamContent {
  const card = p.part2?.card?.card;
  return { part1: p1Topics(p), cueCard: { ...(card ?? NO_CARD), part3: p3Subtopics(p) } };
}

export class PartNotAvailableError extends Error {}

/** Engine content for one mode; throws if that part is not available. */
export function contentForTest(p: TestParts, mode: ExamMode): ExamContent {
  if (!availableParts(p).includes(mode)) {
    const g = partGaps(p);
    const why = mode === "full" ? g.full : g[mode];
    throw new PartNotAvailableError(why.join(" ") || "This part is not part of the test.");
  }
  return looseContent(p);
}

/** A standalone Makkar cue card as Part 2 engine content. */
export function cueCardContent(card: CardData): ExamContent {
  return { part1: [], cueCard: { ...card, part3: [] } };
}

// --------------------------------------------------------------- labels

export const PART_LABEL: Record<ExamMode, string> = {
  part1: "Part 1",
  part2: "Part 2",
  part3: "Part 3",
  full: "Full Test",
};

/** URL segment ⇄ mode. */
export const PART_SLUG: Record<ExamMode, string> = {
  part1: "part-1",
  part2: "part-2",
  part3: "part-3",
  full: "full-test",
};
export const MODE_BY_SLUG: Record<string, ExamMode> = Object.fromEntries(
  Object.entries(PART_SLUG).map(([m, s]) => [s, m as ExamMode]),
);

/** "Cambridge 21, Test 4" · "Practice Test Exam, Test 2". The optional title is shown separately as a subtitle. */
export function testLabel(t: {
  categoryTitle: string;
  bookTitle: string | null;
  number: number | null;
  title: string | null;
}): string {
  if (t.number === null) return t.title ?? t.bookTitle ?? t.categoryTitle;
  return `${t.bookTitle ?? t.categoryTitle}, Test ${t.number}`;
}
