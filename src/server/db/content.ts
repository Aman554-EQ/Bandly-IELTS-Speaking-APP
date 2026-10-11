/**
 * Maps the engine's ExamContent (src/engine/types.ts) to database rows and back.
 *
 *   exam ──< exam_sections (part_1, part_2, part_3, full_test)
 *        ──< exam_questions ──> questions (speaking_prompt | cue_card)
 *
 * The full_test section holds no questions of its own: its config says which
 * parts it includes, so question rows are never duplicated.
 * Each questions.content payload is validated with Zod before it is written.
 */
import { z } from "zod";
import type { CueCard, ExamContent, ExamMode, Part1Topic, Part3Subtopic } from "@/engine/types";

export type SectionKind = "part_1" | "part_2" | "part_3" | "full_test";

const part1Question = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  allowWhyProbe: z.boolean().optional(),
});
const part3Question = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  rephrase: z.string().optional(),
  followUps: z.array(z.string()).optional(),
});

export const part1Payload = z.object({
  part: z.literal(1),
  engineId: z.string().min(1),
  topic: z.object({ id: z.string().min(1), title: z.string(), intro: z.string(), isCore: z.boolean().optional() }),
  question: part1Question,
});

export const part3Payload = z.object({
  part: z.literal(3),
  engineId: z.string().min(1),
  subtopic: z.object({ id: z.string().min(1), title: z.string(), intro: z.string() }),
  question: part3Question,
});

export const cueCardPayload = z.object({
  part: z.literal(2),
  engineId: z.string().min(1),
  card: z.object({
    id: z.string().min(1),
    prompt: z.string().min(1),
    bullets: z.array(z.string()).min(1),
    explain: z.string(),
    spokenPrompt: z.string(),
    roundOff: z.array(z.object({ id: z.string(), text: z.string() })),
    part3Intro: z.string(),
    part3OnlyIntro: z.string(),
  }),
});

export const speakingPayload = z.discriminatedUnion("part", [part1Payload, cueCardPayload, part3Payload]);
export type SpeakingPayload = z.infer<typeof speakingPayload>;

export interface QuestionDraft {
  type: "speaking_prompt" | "cue_card";
  title: string;
  prompt: string;
  content: SpeakingPayload;
}

export interface SectionDraft {
  kind: SectionKind;
  title: string;
  displayOrder: number;
  config: Record<string, unknown>;
  questions: QuestionDraft[];
}

/** ExamContent → sections with their questions in order. */
export function contentToSections(content: ExamContent): SectionDraft[] {
  const part1: QuestionDraft[] = content.part1.flatMap((topic) => {
    const { questions, ...topicMeta } = topic;
    return questions.map((q) => ({
      type: "speaking_prompt" as const,
      title: topic.title,
      prompt: q.text,
      content: part1Payload.parse({ part: 1, engineId: q.id, topic: topicMeta, question: q }),
    }));
  });

  const { part3, ...card } = content.cueCard;
  const part2: QuestionDraft[] = [
    {
      type: "cue_card",
      title: card.prompt,
      prompt: card.prompt,
      content: cueCardPayload.parse({ part: 2, engineId: card.id, card }),
    },
  ];

  const part3Rows: QuestionDraft[] = part3.flatMap((sub) => {
    const { questions, ...subMeta } = sub;
    return questions.map((q) => ({
      type: "speaking_prompt" as const,
      title: sub.title,
      prompt: q.text,
      content: part3Payload.parse({ part: 3, engineId: q.id, subtopic: subMeta, question: q }),
    }));
  });

  return [
    { kind: "part_1", title: "Part 1: Introduction and interview", displayOrder: 1, config: {}, questions: part1 },
    { kind: "part_2", title: "Part 2: Long turn", displayOrder: 2, config: {}, questions: part2 },
    { kind: "part_3", title: "Part 3: Discussion", displayOrder: 3, config: {}, questions: part3Rows },
    {
      kind: "full_test",
      title: "Full test",
      displayOrder: 4,
      config: { includes: ["part_1", "part_2", "part_3"] },
      questions: [],
    },
  ];
}

export interface ContentRow {
  kind: SectionKind;
  position: number;
  content: unknown;
}

export type ContentStatus = "draft" | "published" | "archived";

export interface SectionState {
  kind: SectionKind;
  status: ContentStatus;
}

/** Minimum questions a part needs before students can take it. */
export const MIN_QUESTIONS = { part1: 2, part3: 2 } as const;

export class ContentIncompleteError extends Error {}

interface Assembled {
  part1: Part1Topic[];
  card: Omit<CueCard, "part3"> | null;
  part3: Part3Subtopic[];
  part1Count: number;
  part3Count: number;
  invalid: number;
}

/** Groups rows (any order) into topics, the cue card and sub-topics. Never throws; bad payloads are counted. */
export function assembleContent(rows: ContentRow[]): Assembled {
  const order: Record<SectionKind, number> = { part_1: 1, part_2: 2, part_3: 3, full_test: 4 };
  const sorted = [...rows].sort((a, b) => order[a.kind] - order[b.kind] || a.position - b.position);
  const out: Assembled = { part1: [], card: null, part3: [], part1Count: 0, part3Count: 0, invalid: 0 };
  for (const row of sorted) {
    const parsed = speakingPayload.safeParse(row.content);
    if (!parsed.success) {
      out.invalid++;
      continue;
    }
    const p = parsed.data;
    if (p.part === 1) {
      let topic = out.part1.find((t) => t.id === p.topic.id);
      if (!topic) out.part1.push((topic = { ...p.topic, questions: [] }));
      topic.questions.push(p.question);
      out.part1Count++;
    } else if (p.part === 3) {
      let sub = out.part3.find((x) => x.id === p.subtopic.id);
      if (!sub) out.part3.push((sub = { ...p.subtopic, questions: [] }));
      sub.questions.push(p.question);
      out.part3Count++;
    } else {
      out.card ??= p.card;
    }
  }
  return out;
}

/** Placeholder card for Part 1-only content (the engine never reads it in Part 1). */
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

const PART_NAME = { part1: "Part 1", part2: "Part 2", part3: "Part 3" } as const;

/** What each part is missing (empty array = ready). */
function partGaps(a: Assembled): Record<"part1" | "part2" | "part3", string[]> {
  return {
    part1:
      a.part1Count < MIN_QUESTIONS.part1
        ? [`Part 1 needs at least ${MIN_QUESTIONS.part1} questions (it has ${a.part1Count}).`]
        : [],
    part2: a.card ? [] : ["Part 2 has no cue card."],
    part3: [
      ...(a.part3Count < MIN_QUESTIONS.part3
        ? [`Part 3 needs at least ${MIN_QUESTIONS.part3} questions (it has ${a.part3Count}).`]
        : []),
      ...(a.card ? [] : ["Part 3 needs the Part 2 cue card (it introduces the discussion)."]),
    ],
  };
}

/** Engine content for one mode. Only the parts that mode uses must be complete. */
export function contentForMode(rows: ContentRow[], mode: ExamMode): ExamContent {
  const a = assembleContent(rows);
  const gaps = partGaps(a);
  const needed = mode === "full" ? (["part1", "part2", "part3"] as const) : ([mode] as const);
  const missing = needed.flatMap((p) => gaps[p]);
  if (missing.length) throw new ContentIncompleteError(missing.join(" "));
  return { part1: a.part1, cueCard: { ...(a.card ?? NO_CARD), part3: a.part3 } };
}

/** Whatever content the rows hold, without completeness checks (the voice renderer uses it). */
export function looseContent(rows: ContentRow[]): ExamContent {
  const a = assembleContent(rows);
  return { part1: a.part1, cueCard: { ...(a.card ?? NO_CARD), part3: a.part3 } };
}

/** Rows → full ExamContent (all three parts). Throws if any part is incomplete. */
export function sectionsToContent(rows: ContentRow[]): ExamContent {
  return contentForMode(rows, "full");
}

/**
 * Modes a student can start: the section is published and the parts it uses are
 * complete. The full test needs its own published section plus all three parts.
 */
export function availableModes(rows: ContentRow[], sections: SectionState[]): ExamMode[] {
  const gaps = partGaps(assembleContent(rows));
  const published = (k: SectionKind) => sections.some((s) => s.kind === k && s.status === "published");
  const modes: ExamMode[] = [];
  if (published("part_1") && gaps.part1.length === 0) modes.push("part1");
  if (published("part_2") && gaps.part2.length === 0) modes.push("part2");
  if (published("part_3") && gaps.part3.length === 0) modes.push("part3");
  if (published("full_test") && !gaps.part1.length && !gaps.part2.length && !gaps.part3.length) modes.push("full");
  return modes;
}

/**
 * Why an exam cannot be published yet (empty = OK): every published section must
 * be complete, and at least one mode must be available (database-integration.md §13.3).
 */
export function publishProblems(rows: ContentRow[], sections: SectionState[]): string[] {
  const a = assembleContent(rows);
  const gaps = partGaps(a);
  const problems: string[] = [];
  if (a.invalid) problems.push(`${a.invalid} question(s) have invalid content. Edit or delete them.`);
  for (const s of sections.filter((x) => x.status === "published")) {
    if (s.kind === "full_test") {
      const all = [...gaps.part1, ...gaps.part2, ...gaps.part3];
      if (all.length) problems.push(`Full test: ${all.join(" ")}`);
    } else {
      const mode = (s.kind === "part_1" ? "part1" : s.kind === "part_2" ? "part2" : "part3") as keyof typeof gaps;
      if (gaps[mode].length)
        problems.push(...gaps[mode].map((g) => `${g} Add questions or unpublish ${PART_NAME[mode]}.`));
    }
  }
  if (problems.length === 0 && availableModes(rows, sections).length === 0) {
    problems.push("No part can be taken yet: add a section with questions and publish it.");
  }
  return [...new Set(problems)];
}

/** Engine question id → database ids, stored in the attempt's content snapshot. */
export type QuestionIdMap = Record<string, { questionId: string; examQuestionId: string }>;
