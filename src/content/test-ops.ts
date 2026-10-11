/**
 * Every change an admin can make to categories, books and tests (with their
 * parts, topics, questions and Part 2 card), as one Zod union. The admin forms
 * validate with it before sending; POST /api/admin/tests validates again.
 * Makkar cue cards have their own union (cue-card-ops.ts) and endpoint.
 */
import { z } from "zod";
import { P3_KINDS } from "./question-kinds";
import { cardFields, direction, idField, line, lines, number, optionalLine, statusField } from "./ops-common";

export const PART_KEYS = ["part1", "part2", "part3", "full"] as const;
export type PartKeyInput = (typeof PART_KEYS)[number];

const title = line("a title", 120);
const optionalText = (max: number) =>
  z.string().trim().max(max, `Use at most ${max} characters.`).nullable().optional();

export const p1QuestionFields = z
  .object({ part: z.literal(1), text: line("the question"), allowWhyProbe: z.boolean().optional() })
  .strict();
export const p3QuestionFields = z
  .object({
    part: z.literal(3),
    text: line("the question"),
    rephrase: optionalLine(),
    followUps: lines(4, "follow-up probes").optional(),
    kind: z.enum(P3_KINDS).optional(),
  })
  .strict();
export const questionFields = z.discriminatedUnion("part", [p1QuestionFields, p3QuestionFields]);
export type QuestionFieldsInput = z.infer<typeof questionFields>;

export const testCardFields = z
  .object({ ...cardFields, part3Intro: optionalLine(), part3OnlyIntro: optionalLine() })
  .strict();
export type TestCardInput = z.infer<typeof testCardFields>;

const parts = z
  .object({ part1: z.boolean(), part2: z.boolean(), part3: z.boolean(), full: z.boolean() })
  .strict()
  .refine((p) => p.part1 || p.part2 || p.part3, "Choose at least one part.")
  .refine((p) => !p.full || (p.part1 && p.part2 && p.part3), "The full test needs Part 1, Part 2 and Part 3.");

export const testOp = z.discriminatedUnion("op", [
  // Categories (the four are fixed: edit only)
  z
    .object({ op: z.literal("category.update"), id: idField, title: title.optional(), description: optionalText(400) })
    .strict(),
  z.object({ op: z.literal("category.move"), id: idField, direction }).strict(),
  // Books (Cambridge)
  z
    .object({
      op: z.literal("book.create"),
      categoryId: idField,
      number: number("book number"),
      title: z.string().trim().max(120).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("book.update"),
      id: idField,
      number: number("book number").optional(),
      title: title.optional(),
    })
    .strict(),
  z.object({ op: z.literal("book.delete"), id: idField }).strict(),
  // Tests
  z
    .object({
      op: z.literal("test.create"),
      categoryId: idField,
      bookId: idField.nullable().optional(),
      /** Create the book on the fly ("New book: Cambridge 22"). */
      newBookNumber: number("book number").optional(),
      number: number("test number"),
      title: z.string().trim().max(120).optional(),
      parts,
    })
    .strict(),
  z
    .object({
      op: z.literal("test.update"),
      id: idField,
      number: number("test number").optional(),
      title: optionalText(120),
      description: optionalText(1000),
      bookId: idField.nullable().optional(),
    })
    .strict(),
  z.object({ op: z.literal("test.status"), id: idField, status: statusField }).strict(),
  z
    .object({
      op: z.literal("test.duplicate"),
      id: idField,
      number: number("test number"),
      bookId: idField.nullable().optional(),
    })
    .strict(),
  z.object({ op: z.literal("test.delete"), id: idField }).strict(),
  // Parts
  z.object({ op: z.literal("part.add"), testId: idField, part: z.enum(PART_KEYS) }).strict(),
  z.object({ op: z.literal("part.remove"), testId: idField, part: z.enum(PART_KEYS) }).strict(),
  // Topics (Part 1 topics and Part 3 discussion topics)
  z
    .object({
      op: z.literal("topic.create"),
      testId: idField,
      part: z.union([z.literal(1), z.literal(3)]),
      title,
      intro: line("what the examiner says first (e.g. “Now, let's talk about walking.”)"),
      isCore: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("topic.update"),
      id: idField,
      title: title.optional(),
      intro: line("what the examiner says first").optional(),
      isCore: z.boolean().optional(),
    })
    .strict(),
  z.object({ op: z.literal("topic.move"), id: idField, direction }).strict(),
  z.object({ op: z.literal("topic.delete"), id: idField }).strict(),
  /** Copies a topic with its questions to the end of the same part in another (or the same) test. */
  z.object({ op: z.literal("topic.copy"), id: idField, testId: idField }).strict(),
  // Questions (inside a topic)
  z.object({ op: z.literal("question.create"), topicId: idField, fields: questionFields }).strict(),
  /** Several questions at once, one per line, added to the end of the topic. */
  z
    .object({
      op: z.literal("question.createMany"),
      topicId: idField,
      texts: z
        .array(line("the question"))
        .min(1, "Enter at least one question.")
        .max(50, "Add at most 50 questions at a time."),
      kind: z.enum(P3_KINDS).optional(),
    })
    .strict(),
  z.object({ op: z.literal("question.update"), id: idField, fields: questionFields }).strict(),
  /** Moves a question into another topic of the same part and test (added at the end). */
  z.object({ op: z.literal("question.regroup"), id: idField, topicId: idField }).strict(),
  z.object({ op: z.literal("question.move"), id: idField, direction }).strict(),
  z.object({ op: z.literal("question.status"), id: idField, status: z.enum(["published", "archived"]) }).strict(),
  z.object({ op: z.literal("question.delete"), id: idField }).strict(),
  // The test's Part 2 card (create or update)
  z.object({ op: z.literal("card.save"), testId: idField, fields: testCardFields }).strict(),
]);

export type TestOp = z.infer<typeof testOp>;
