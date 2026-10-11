/**
 * Every change an admin can make to the Makkar cue card library (topics and
 * cards), as one Zod union. Separate from tests on purpose: a cue card can
 * never be sent to a test, or the other way round (step3.md §3, §4.6).
 */
import { z } from "zod";
import { cardFields, direction, idField, line, statusField } from "./ops-common";

const description = z.string().trim().max(400, "Use at most 400 characters.").nullable().optional();

export const cueCardFields = z.object(cardFields).strict();
export type CueCardFieldsInput = z.infer<typeof cueCardFields>;

export const cueOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("cueTopic.create"), title: line("a topic name", 80), description }).strict(),
  z
    .object({ op: z.literal("cueTopic.update"), id: idField, title: line("a topic name", 80).optional(), description })
    .strict(),
  z.object({ op: z.literal("cueTopic.move"), id: idField, direction }).strict(),
  z.object({ op: z.literal("cueTopic.delete"), id: idField }).strict(),
  z.object({ op: z.literal("cueCard.create"), topicId: idField, fields: cueCardFields }).strict(),
  z
    .object({ op: z.literal("cueCard.update"), id: idField, topicId: idField.optional(), fields: cueCardFields })
    .strict(),
  z.object({ op: z.literal("cueCard.status"), id: idField, status: statusField }).strict(),
  z.object({ op: z.literal("cueCard.move"), id: idField, direction }).strict(),
  z.object({ op: z.literal("cueCard.delete"), id: idField }).strict(),
]);

export type CueOp = z.infer<typeof cueOp>;
