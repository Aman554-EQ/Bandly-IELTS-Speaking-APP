/**
 * Admin changes to categories, books and tests (parts, topics, questions,
 * Part 2 card). Entry point: `applyTestOp` (POST /api/admin/tests).
 *
 * Rules (step3-redesign-plan.md §4):
 * - The four categories are fixed: only title, description and order change.
 * - Books exist only in Cambridge; other tests are plain "Test N".
 * - A question can only be added to a topic of its own part (Part 1 ↔ Part 1).
 * - The full test is an explicit sequence of the test's three parts.
 * - Publishing is refused while an included part is incomplete (reasons listed).
 * - Anything a recorded test used cannot be deleted (archive instead).
 * - Changed spoken wording gets a new engine key (old audio never mismatches).
 */
import { and, asc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import { type CategoryKind, usesBooks } from "@/content/categories";
import type { PartKeyInput, QuestionFieldsInput, TestOp } from "@/content/test-ops";
import type { AppUser } from "@/server/auth/policy";
import type { RequestMeta } from "@/server/auth/users";
import {
  ContentError,
  defaultSpokenPrompt,
  newKey,
  type OpResult,
  roundOffWithIds,
  runAdminOp,
  type Tx,
} from "./admin-common";
import { cardShape, p1QuestionPayload, p2CardPayload, p3QuestionPayload } from "./assemble";
import type { Db } from "./client";
import type { SectionKind } from "./content";
import { getTest } from "./library";
import { collections, examQuestions, exams, examSections, modules, questionGroups, questions } from "./schema";

const MESSAGES = {
  exams_test_number_uq: "That test number is already used here. Choose another number.",
  collections_module_sort_number_uq: "That book number already exists.",
  collections_module_slug_uq: "That book already exists.",
  exam_sections_exam_kind_uq: "This test already has that part.",
};

const KIND: Record<PartKeyInput, SectionKind> = {
  part1: "part_1",
  part2: "part_2",
  part3: "part_3",
  full: "full_test",
};
const PART_NAME: Record<PartKeyInput, string> = {
  part1: "Part 1",
  part2: "Part 2",
  part3: "Part 3",
  full: "the full test",
};
const SECTION_TITLE: Record<SectionKind, string> = {
  part_1: "Part 1: Introduction and interview",
  part_2: "Part 2: Long turn",
  part_3: "Part 3: Discussion",
  full_test: "Full test",
};
const DEFAULT_P3_INTRO =
  "We've been talking about this topic, and I'd like to discuss with you one or two more general questions related to it.";
const DEFAULT_P3_ONLY_INTRO = "I'd like to discuss with you some general questions related to this topic.";

export function applyTestOp(db: Db, actor: AppUser, op: TestOp, meta?: RequestMeta): Promise<OpResult> {
  return runAdminOp(db, actor, op, (tx) => run(tx, actor, op), { meta, messages: MESSAGES });
}

// ---------------------------------------------------------------- lookups

async function mustCategory(tx: Tx, id: string) {
  const [c] = await tx
    .select()
    .from(modules)
    .where(and(eq(modules.id, id), isNull(modules.deletedAt)));
  if (!c?.kind) throw new ContentError(404, "Category not found.");
  return { ...c, kind: c.kind as CategoryKind };
}

async function mustTest(tx: Tx, id: string) {
  const [t] = await tx
    .select()
    .from(exams)
    .where(and(eq(exams.id, id), isNull(exams.deletedAt)));
  if (!t) throw new ContentError(404, "Test not found.");
  return t;
}

async function mustBook(tx: Tx, id: string) {
  const [b] = await tx
    .select()
    .from(collections)
    .where(and(eq(collections.id, id), isNull(collections.deletedAt)));
  if (!b) throw new ContentError(404, "Book not found.");
  return b;
}

async function sectionsOf(tx: Tx, testId: string) {
  return tx
    .select()
    .from(examSections)
    .where(and(eq(examSections.examId, testId), isNull(examSections.deletedAt)));
}

async function mustGroup(tx: Tx, id: string) {
  const [g] = await tx
    .select({ g: questionGroups, examId: examSections.examId })
    .from(questionGroups)
    .innerJoin(examSections, eq(examSections.id, questionGroups.sectionId))
    .where(eq(questionGroups.id, id));
  if (!g) throw new ContentError(404, "Topic not found.");
  return { ...g.g, examId: g.examId };
}

async function mustQuestion(tx: Tx, id: string) {
  const [q] = await tx
    .select({ q: questions, link: examQuestions })
    .from(questions)
    .innerJoin(examQuestions, eq(examQuestions.questionId, questions.id))
    .where(and(eq(questions.id, id), isNull(questions.deletedAt)));
  if (!q) throw new ContentError(404, "Question not found.");
  return q;
}

const count = async (tx: Tx, query: ReturnType<typeof sql>) =>
  Number(((await tx.execute<{ n: number }>(query)).rows[0]?.n as number | undefined) ?? 0);

/** Recorded answers on the given exam_questions rows (they block deleting). */
async function answersOn(tx: Tx, examQuestionIds: string[]): Promise<number> {
  if (examQuestionIds.length === 0) return 0;
  return count(
    tx,
    sql`SELECT count(*)::int AS n FROM attempt_answers WHERE exam_question_id IN (${sql.join(
      examQuestionIds.map((x) => sql`${x}::uuid`),
      sql`, `,
    )})`,
  );
}

/** Refuses a test number already used in the same category and book, naming the next free one. */
async function assertFreeNumber(
  tx: Tx,
  t: { moduleId: string; bookId: string | null; number: number; exceptId?: string },
) {
  const rows = await tx
    .select({ id: exams.id, n: exams.examNumber })
    .from(exams)
    .where(
      and(
        eq(exams.moduleId, t.moduleId),
        t.bookId ? eq(exams.collectionId, t.bookId) : isNull(exams.collectionId),
        isNull(exams.deletedAt),
      ),
    );
  const used = new Set(rows.filter((r) => r.id !== t.exceptId && r.n !== null).map((r) => r.n as number));
  if (!used.has(t.number)) return;
  let free = 1;
  while (used.has(free)) free++;
  const [where] = t.bookId
    ? await tx.select({ title: collections.title }).from(collections).where(eq(collections.id, t.bookId))
    : await tx.select({ title: modules.title }).from(modules).where(eq(modules.id, t.moduleId));
  throw new ContentError(
    409,
    `Test ${t.number} already exists in ${where?.title ?? "this place"} (it may be archived). Use another number; the next free one is ${free}.`,
  );
}

const inUse = (n: number, what: string) =>
  new ContentError(
    409,
    `This ${what} can't be deleted: ${n} recorded answer${n === 1 ? "" : "s"} or test${n === 1 ? "" : "s"} used it. Archive the test instead: students stop seeing it, and past results stay intact.`,
  );

/** Deletes exam_questions rows and their questions (if nothing else uses them). */
async function deleteLinks(tx: Tx, examQuestionIds: string[]) {
  if (examQuestionIds.length === 0) return;
  const links = await tx
    .delete(examQuestions)
    .where(inArray(examQuestions.id, examQuestionIds))
    .returning({ questionId: examQuestions.questionId });
  const ids = links.map((l) => l.questionId);
  const still = await tx
    .select({ id: examQuestions.questionId })
    .from(examQuestions)
    .where(inArray(examQuestions.questionId, ids));
  const free = ids.filter((x) => !still.some((s) => s.id === x));
  if (free.length) await tx.delete(questions).where(inArray(questions.id, free));
}

async function nextPosition(tx: Tx, sectionId: string): Promise<number> {
  const [r] = await tx
    .select({ m: max(examQuestions.position) })
    .from(examQuestions)
    .where(eq(examQuestions.sectionId, sectionId));
  return (r?.m ?? 0) + 1;
}

/** Swaps an item's position with its neighbour among `siblings` (already in order). */
async function swap<T extends { id: string; position: number }>(
  siblings: T[],
  id: string,
  dir: "up" | "down",
  write: (id: string, position: number) => Promise<unknown>,
) {
  const i = siblings.findIndex((s) => s.id === id);
  const j = i + (dir === "up" ? -1 : 1);
  if (i < 0 || j < 0 || j >= siblings.length) return false;
  await write(siblings[i].id, siblings[j].position);
  await write(siblings[j].id, siblings[i].position);
  return true;
}

// -------------------------------------------------------------- dispatcher

async function run(tx: Tx, actor: AppUser, op: TestOp): Promise<OpResult> {
  switch (op.op) {
    // ---- categories
    case "category.update": {
      await mustCategory(tx, op.id);
      await tx
        .update(modules)
        .set({
          ...(op.title !== undefined && { title: op.title }),
          ...(op.description !== undefined && { description: op.description }),
        })
        .where(eq(modules.id, op.id));
      return { id: op.id, message: "Category saved." };
    }
    case "category.move": {
      await mustCategory(tx, op.id);
      const all = await tx
        .select({ id: modules.id, position: modules.displayOrder })
        .from(modules)
        .where(sql`${modules.kind} IS NOT NULL`)
        .orderBy(asc(modules.displayOrder), asc(modules.id));
      const renumbered = all.map((c, i) => ({ ...c, position: i + 1 }));
      for (const c of renumbered)
        await tx.update(modules).set({ displayOrder: c.position }).where(eq(modules.id, c.id));
      await swap(renumbered, op.id, op.direction, (id, p) =>
        tx.update(modules).set({ displayOrder: p }).where(eq(modules.id, id)),
      );
      return { id: op.id, message: "Moved." };
    }

    // ---- books
    case "book.create": {
      const c = await mustCategory(tx, op.categoryId);
      if (!usesBooks(c.kind)) throw new ContentError(400, `${c.title} has numbered tests, not books.`);
      const id = await createBook(tx, c.id, op.number, op.title);
      return { id, message: `Book “${op.title || `Cambridge ${op.number}`}” added.` };
    }
    case "book.update": {
      const b = await mustBook(tx, op.id);
      await tx
        .update(collections)
        .set({
          ...(op.title !== undefined && { title: op.title }),
          ...(op.number !== undefined && { sortNumber: op.number }),
        })
        .where(eq(collections.id, b.id));
      return { id: b.id, message: "Book saved." };
    }
    case "book.delete": {
      const b = await mustBook(tx, op.id);
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(exams)
        .where(and(eq(exams.collectionId, b.id), isNull(exams.deletedAt)));
      if (n > 0)
        throw new ContentError(
          409,
          `“${b.title}” still has ${n} test${n === 1 ? "" : "s"}. Move or delete them first.`,
        );
      await tx.delete(collections).where(eq(collections.id, b.id));
      return { id: b.id, message: `Book “${b.title}” deleted.` };
    }

    // ---- tests
    case "test.create": {
      const c = await mustCategory(tx, op.categoryId);
      if (c.kind === "cue_cards") throw new ContentError(400, "Cue cards are managed under Cue cards, not as tests.");
      const bookId = await resolveBook(tx, c, op.bookId, op.newBookNumber);
      await assertFreeNumber(tx, { moduleId: c.id, bookId, number: op.number });
      const [t] = await tx
        .insert(exams)
        .values({
          moduleId: c.id,
          collectionId: bookId,
          examNumber: op.number,
          slug: `test-${op.number}-${newKey("x").slice(2)}`,
          title: op.title ?? "",
          status: "draft",
        })
        .returning({ id: exams.id });
      const wanted = (["part1", "part2", "part3"] as const).filter((p) => op.parts[p]);
      for (const p of wanted) await addPart(tx, t.id, p);
      if (op.parts.full) await addPart(tx, t.id, "full");
      return { id: t.id, message: "Test created as a draft. Add its questions next." };
    }
    case "test.update": {
      const t = await mustTest(tx, op.id);
      const c = await mustCategory(tx, t.moduleId);
      if (op.bookId !== undefined) {
        if (usesBooks(c.kind) && !op.bookId) throw new ContentError(400, "Cambridge tests belong to a book.");
        if (!usesBooks(c.kind) && op.bookId) throw new ContentError(400, `${c.title} tests have no book.`);
        if (op.bookId) {
          const b = await mustBook(tx, op.bookId);
          if (b.moduleId !== c.id) throw new ContentError(400, "That book belongs to another category.");
        }
      }
      const nextBook = op.bookId !== undefined ? op.bookId : t.collectionId;
      const nextNumber = op.number !== undefined ? op.number : t.examNumber;
      if (nextNumber !== null && (nextNumber !== t.examNumber || nextBook !== t.collectionId)) {
        await assertFreeNumber(tx, { moduleId: t.moduleId, bookId: nextBook, number: nextNumber, exceptId: t.id });
      }
      await tx
        .update(exams)
        .set({
          ...(op.number !== undefined && { examNumber: op.number }),
          ...(op.title !== undefined && { title: op.title ?? "" }),
          ...(op.description !== undefined && { description: op.description }),
          ...(op.bookId !== undefined && { collectionId: op.bookId }),
        })
        .where(eq(exams.id, t.id));
      return { id: t.id, message: "Test saved." };
    }
    case "test.status": {
      const t = await mustTest(tx, op.id);
      if (op.status === "published") {
        const view = await getTest(tx as unknown as Db, t.id, { preview: true });
        const problems = view?.problems ?? ["Test not found."];
        if (problems.length) throw new ContentError(400, "This test can't be published yet:", problems);
      }
      await tx
        .update(exams)
        .set({ status: op.status, ...(op.status === "published" && !t.publishedAt ? { publishedAt: new Date() } : {}) })
        .where(eq(exams.id, t.id));
      const verb = op.status === "published" ? "published" : op.status === "archived" ? "archived" : "back to draft";
      return { id: t.id, message: `The test is ${verb}.` };
    }
    case "test.duplicate":
      return duplicateTest(tx, actor, op);
    case "test.delete": {
      const t = await mustTest(tx, op.id);
      const n = await count(tx, sql`SELECT count(*)::int AS n FROM exam_attempts WHERE exam_id = ${t.id}::uuid`);
      if (n > 0) {
        throw new ContentError(
          409,
          `This test can't be deleted: ${n} recorded test${n === 1 ? "" : "s"} used it. Archive it instead: students stop seeing it, and past results stay intact.`,
        );
      }
      const links = await tx.select({ id: examQuestions.id }).from(examQuestions).where(eq(examQuestions.examId, t.id));
      await deleteLinks(
        tx,
        links.map((l) => l.id),
      );
      await tx.delete(examSections).where(eq(examSections.examId, t.id)); // topics cascade
      await tx.delete(exams).where(eq(exams.id, t.id));
      return { id: t.id, message: "Test deleted." };
    }

    // ---- parts
    case "part.add": {
      await mustTest(tx, op.testId);
      const id = await addPart(tx, op.testId, op.part);
      return { id, message: `${PART_NAME[op.part][0].toUpperCase()}${PART_NAME[op.part].slice(1)} added.` };
    }
    case "part.remove": {
      await mustTest(tx, op.testId);
      const all = await sectionsOf(tx, op.testId);
      const s = all.find((x) => x.kind === KIND[op.part]);
      if (!s) throw new ContentError(404, `This test has no ${PART_NAME[op.part]}.`);
      if (op.part !== "full" && all.some((x) => x.kind === "full_test")) {
        throw new ContentError(409, "The full test uses this part. Remove the full test first.");
      }
      const attempts = await count(
        tx,
        sql`SELECT count(*)::int AS n FROM exam_attempts WHERE section_id = ${s.id}::uuid`,
      );
      const links = await tx
        .select({ id: examQuestions.id })
        .from(examQuestions)
        .where(eq(examQuestions.sectionId, s.id));
      const used =
        attempts +
        (await answersOn(
          tx,
          links.map((l) => l.id),
        ));
      if (used > 0) throw inUse(used, "part");
      await deleteLinks(
        tx,
        links.map((l) => l.id),
      );
      await tx.delete(examSections).where(eq(examSections.id, s.id));
      return { id: s.id, message: `${PART_NAME[op.part]} removed.` };
    }

    // ---- topics
    case "topic.create": {
      await mustTest(tx, op.testId);
      const s = (await sectionsOf(tx, op.testId)).find((x) => x.kind === (op.part === 1 ? "part_1" : "part_3"));
      if (!s) throw new ContentError(400, `This test has no Part ${op.part}. Add the part first.`);
      const [{ m }] = await tx
        .select({ m: max(questionGroups.position) })
        .from(questionGroups)
        .where(eq(questionGroups.sectionId, s.id));
      const [g] = await tx
        .insert(questionGroups)
        .values({
          sectionId: s.id,
          kind: op.part === 1 ? "part1_topic" : "part3_topic",
          title: op.title,
          intro: op.intro,
          isCore: op.part === 1 && Boolean(op.isCore),
          engineKey: newKey(op.part === 1 ? "t" : "s"),
          position: (m ?? 0) + 1,
        })
        .returning({ id: questionGroups.id });
      return { id: g.id, message: `Topic “${op.title}” added.` };
    }
    case "topic.update": {
      const g = await mustGroup(tx, op.id);
      const introChanged = op.intro !== undefined && op.intro !== g.intro;
      await tx
        .update(questionGroups)
        .set({
          ...(op.title !== undefined && { title: op.title }),
          ...(op.intro !== undefined && { intro: op.intro }),
          ...(op.isCore !== undefined && g.kind === "part1_topic" && { isCore: op.isCore }),
          ...(introChanged && { engineKey: newKey(g.kind === "part1_topic" ? "t" : "s") }),
        })
        .where(eq(questionGroups.id, g.id));
      return { id: g.id, message: "Topic saved." };
    }
    case "topic.move": {
      const g = await mustGroup(tx, op.id);
      const sibs = await tx
        .select({ id: questionGroups.id, position: questionGroups.position })
        .from(questionGroups)
        .where(eq(questionGroups.sectionId, g.sectionId))
        .orderBy(asc(questionGroups.position), asc(questionGroups.id));
      const renumbered = sibs.map((s, i) => ({ ...s, position: i + 1 }));
      for (const s of renumbered)
        await tx.update(questionGroups).set({ position: s.position }).where(eq(questionGroups.id, s.id));
      await swap(renumbered, g.id, op.direction, (id, p) =>
        tx.update(questionGroups).set({ position: p }).where(eq(questionGroups.id, id)),
      );
      return { id: g.id, message: "Moved." };
    }
    case "topic.delete": {
      const g = await mustGroup(tx, op.id);
      const links = await tx
        .select({ id: examQuestions.id })
        .from(examQuestions)
        .where(eq(examQuestions.groupId, g.id));
      const used = await answersOn(
        tx,
        links.map((l) => l.id),
      );
      if (used > 0) throw inUse(used, "topic");
      await deleteLinks(
        tx,
        links.map((l) => l.id),
      );
      await tx.delete(questionGroups).where(eq(questionGroups.id, g.id));
      return { id: g.id, message: `Topic “${g.title}” deleted.` };
    }

    case "topic.copy": {
      const g = await mustGroup(tx, op.id);
      await mustTest(tx, op.testId);
      const kind = g.kind === "part1_topic" ? "part_1" : "part_3";
      const target = (await sectionsOf(tx, op.testId)).find((x) => x.kind === kind);
      const part = kind === "part_1" ? 1 : 3;
      if (!target) throw new ContentError(400, `That test has no Part ${part}. Add the part there first.`);
      const [{ m }] = await tx
        .select({ m: max(questionGroups.position) })
        .from(questionGroups)
        .where(eq(questionGroups.sectionId, target.id));
      const [ng] = await tx
        .insert(questionGroups)
        .values({
          sectionId: target.id,
          kind: g.kind,
          title: g.title,
          intro: g.intro,
          isCore: g.isCore,
          engineKey: newKey(part === 1 ? "t" : "s"),
          position: (m ?? 0) + 1,
        })
        .returning({ id: questionGroups.id });
      const rows = await tx
        .select({ q: questions })
        .from(examQuestions)
        .innerJoin(questions, eq(questions.id, examQuestions.questionId))
        .where(and(eq(examQuestions.groupId, g.id), isNull(questions.deletedAt)))
        .orderBy(asc(examQuestions.position));
      let position = await nextPosition(tx, target.id);
      for (const { q } of rows) {
        // New rows and keys: the copy is independent, and one test never holds the same key twice.
        const parsed = (part === 1 ? p1QuestionPayload : p3QuestionPayload).parse(q.content);
        const id = newKey("q");
        const [nq] = await tx
          .insert(questions)
          .values({
            type: q.type,
            title: g.title,
            prompt: q.prompt,
            content: { ...parsed, engineId: id, question: { ...parsed.question, id } },
            status: q.status,
            createdBy: actor.id,
          })
          .returning({ id: questions.id });
        await tx.insert(examQuestions).values({
          examId: op.testId,
          sectionId: target.id,
          groupId: ng.id,
          questionId: nq.id,
          position: position++,
        });
      }
      const same = op.testId === g.examId;
      return {
        id: ng.id,
        message: `Topic “${g.title}” copied${same ? "" : " to the other test"} with ${rows.length} question${rows.length === 1 ? "" : "s"}.`,
      };
    }

    // ---- questions
    case "question.create": {
      const g = await mustGroup(tx, op.topicId);
      const part = g.kind === "part1_topic" ? 1 : 3;
      if (op.fields.part !== part) {
        throw new ContentError(
          400,
          `“${g.title}” is a Part ${part} topic. Add Part ${op.fields.part} questions under a Part ${op.fields.part} topic.`,
        );
      }
      const payload = questionPayload(op.fields, newKey("q"));
      const [q] = await tx
        .insert(questions)
        .values({
          type: "speaking_prompt",
          title: g.title,
          prompt: op.fields.text,
          content: payload,
          status: "published",
          createdBy: actor.id,
        })
        .returning({ id: questions.id });
      await tx.insert(examQuestions).values({
        examId: g.examId,
        sectionId: g.sectionId,
        groupId: g.id,
        questionId: q.id,
        position: await nextPosition(tx, g.sectionId),
      });
      return { id: q.id, message: "Question added." };
    }
    case "question.createMany": {
      const g = await mustGroup(tx, op.topicId);
      const part = g.kind === "part1_topic" ? 1 : 3;
      if (op.kind && part === 1) throw new ContentError(400, "Question types are for Part 3 questions.");
      let position = await nextPosition(tx, g.sectionId);
      for (const text of op.texts) {
        const fields: QuestionFieldsInput = part === 1 ? { part, text } : { part, text, kind: op.kind };
        const [q] = await tx
          .insert(questions)
          .values({
            type: "speaking_prompt",
            title: g.title,
            prompt: text,
            content: questionPayload(fields, newKey("q")),
            status: "published",
            createdBy: actor.id,
          })
          .returning({ id: questions.id });
        await tx.insert(examQuestions).values({
          examId: g.examId,
          sectionId: g.sectionId,
          groupId: g.id,
          questionId: q.id,
          position: position++,
        });
      }
      const n = op.texts.length;
      return { id: g.id, message: `${n} question${n === 1 ? "" : "s"} added.` };
    }
    case "question.update": {
      const { q, link } = await mustQuestion(tx, op.id);
      if (!link.groupId) throw new ContentError(400, "This is the Part 2 card. Edit it in the Part 2 tab.");
      const old = (op.fields.part === 1 ? p1QuestionPayload : p3QuestionPayload).safeParse(q.content);
      if (!old.success) throw new ContentError(400, "This question belongs to the other part.");
      const o = old.data.question as { id: string; text: string; rephrase?: string; followUps?: string[] };
      const f = op.fields;
      const spokenChanged =
        f.text !== o.text ||
        (f.part === 3 &&
          ((f.rephrase ?? "") !== (o.rephrase ?? "") ||
            JSON.stringify(f.followUps ?? []) !== JSON.stringify(o.followUps ?? [])));
      const payload = questionPayload(f, spokenChanged ? newKey("q") : o.id);
      await tx
        .update(questions)
        .set({ prompt: f.text, content: payload, version: sql`${questions.version} + 1` })
        .where(eq(questions.id, q.id));
      return { id: q.id, message: "Question saved." };
    }
    case "question.move": {
      const { link } = await mustQuestion(tx, op.id);
      const sibs = await tx
        .select({ id: examQuestions.id, position: examQuestions.position })
        .from(examQuestions)
        .where(link.groupId ? eq(examQuestions.groupId, link.groupId) : eq(examQuestions.sectionId, link.sectionId))
        .orderBy(asc(examQuestions.position), asc(examQuestions.id));
      // Positions are unique per section but DEFERRABLE, so a swap in one transaction is fine.
      await swap(sibs, link.id, op.direction, (id, p) =>
        tx.update(examQuestions).set({ position: p }).where(eq(examQuestions.id, id)),
      );
      return { id: op.id, message: "Moved." };
    }
    case "question.regroup": {
      const { q, link } = await mustQuestion(tx, op.id);
      if (!link.groupId) throw new ContentError(400, "The Part 2 card has no topic.");
      const g = await mustGroup(tx, op.topicId);
      if (g.sectionId !== link.sectionId) {
        throw new ContentError(
          400,
          "Choose a topic of the same part in this test. To reuse it elsewhere, copy the topic.",
        );
      }
      if (g.id === link.groupId) return { id: q.id, message: "It is already in that topic." };
      await tx
        .update(examQuestions)
        .set({ groupId: g.id, position: await nextPosition(tx, g.sectionId) })
        .where(eq(examQuestions.id, link.id));
      await tx.update(questions).set({ title: g.title }).where(eq(questions.id, q.id));
      return { id: q.id, message: `Moved to “${g.title}”.` };
    }
    case "question.status": {
      const { q } = await mustQuestion(tx, op.id);
      await tx.update(questions).set({ status: op.status }).where(eq(questions.id, q.id));
      return {
        id: q.id,
        message: op.status === "archived" ? "Question archived (hidden from students)." : "Question restored.",
      };
    }
    case "question.delete": {
      const { q, link } = await mustQuestion(tx, op.id);
      const used = await answersOn(tx, [link.id]);
      if (used > 0) {
        throw new ContentError(
          409,
          `Students answered this question ${used} time${used === 1 ? "" : "s"}, so it stays for their results. Archive it to hide it.`,
        );
      }
      await deleteLinks(tx, [link.id]);
      return { id: q.id, message: "Question deleted." };
    }

    // ---- Part 2 card
    case "card.save": {
      await mustTest(tx, op.testId);
      const s = (await sectionsOf(tx, op.testId)).find((x) => x.kind === "part_2");
      if (!s) throw new ContentError(400, "This test has no Part 2. Add the part first.");
      const [existing] = await tx
        .select({ q: questions, linkId: examQuestions.id })
        .from(examQuestions)
        .innerJoin(questions, eq(questions.id, examQuestions.questionId))
        .where(eq(examQuestions.sectionId, s.id));
      const old = existing ? p2CardPayload.safeParse(existing.q.content).data?.card : undefined;
      const f = op.fields;
      const spokenPrompt = f.spokenPrompt || defaultSpokenPrompt(f.prompt);
      const part3Intro = f.part3Intro || DEFAULT_P3_INTRO;
      const part3OnlyIntro = f.part3OnlyIntro || DEFAULT_P3_ONLY_INTRO;
      const keep =
        old &&
        old.spokenPrompt === spokenPrompt &&
        old.part3Intro === part3Intro &&
        old.part3OnlyIntro === part3OnlyIntro;
      const card = cardShape.parse({
        id: keep ? old.id : newKey("card"),
        prompt: f.prompt,
        bullets: f.bullets,
        explain: f.explain,
        spokenPrompt,
        roundOff: roundOffWithIds(f.roundOff, old?.roundOff),
        part3Intro,
        part3OnlyIntro,
      });
      const content = { part: 2, engineId: card.id, card };
      if (existing) {
        await tx
          .update(questions)
          .set({
            title: f.prompt,
            prompt: f.prompt,
            content,
            status: "published",
            version: sql`${questions.version} + 1`,
          })
          .where(eq(questions.id, existing.q.id));
        return { id: existing.q.id, message: "Cue card saved." };
      }
      const [q] = await tx
        .insert(questions)
        .values({
          type: "cue_card",
          title: f.prompt,
          prompt: f.prompt,
          content,
          status: "published",
          createdBy: actor.id,
        })
        .returning({ id: questions.id });
      await tx
        .insert(examQuestions)
        .values({ examId: op.testId, sectionId: s.id, questionId: q.id, position: await nextPosition(tx, s.id) });
      return { id: q.id, message: "Cue card added." };
    }
  }
}

// ----------------------------------------------------------------- helpers

function questionPayload(f: QuestionFieldsInput, id: string) {
  if (f.part === 1) {
    return p1QuestionPayload.parse({
      part: 1,
      engineId: id,
      question: { id, text: f.text, ...(f.allowWhyProbe ? { allowWhyProbe: true } : {}) },
    });
  }
  return p3QuestionPayload.parse({
    part: 3,
    engineId: id,
    question: {
      id,
      text: f.text,
      ...(f.rephrase ? { rephrase: f.rephrase } : {}),
      ...(f.followUps?.length ? { followUps: f.followUps } : {}),
      ...(f.kind ? { kind: f.kind } : {}),
    },
  });
}

async function createBook(tx: Tx, categoryId: string, n: number, title?: string): Promise<string> {
  const [b] = await tx
    .insert(collections)
    .values({
      moduleId: categoryId,
      slug: `cambridge-${n}`,
      title: title || `Cambridge ${n}`,
      sortNumber: n,
      status: "published",
    })
    .returning({ id: collections.id });
  return b.id;
}

async function resolveBook(
  tx: Tx,
  c: { id: string; kind: CategoryKind; title: string },
  bookId: string | null | undefined,
  newBookNumber: number | undefined,
): Promise<string | null> {
  if (!usesBooks(c.kind)) {
    if (bookId || newBookNumber) throw new ContentError(400, `${c.title} tests have no book; give the test a number.`);
    return null;
  }
  if (newBookNumber) return createBook(tx, c.id, newBookNumber);
  if (!bookId) throw new ContentError(400, "Choose a Cambridge book, or add a new one.");
  const b = await mustBook(tx, bookId);
  if (b.moduleId !== c.id) throw new ContentError(400, "That book belongs to another category.");
  return b.id;
}

/** Adds a part section. The full test needs the three parts and records them as its explicit sequence. */
async function addPart(tx: Tx, testId: string, part: PartKeyInput): Promise<string> {
  const all = await sectionsOf(tx, testId);
  if (all.some((s) => s.kind === KIND[part])) throw new ContentError(409, `This test already has ${PART_NAME[part]}.`);
  let config: Record<string, unknown> = {};
  if (part === "full") {
    const seq = (["part_1", "part_2", "part_3"] as const).map((k) => all.find((s) => s.kind === k)?.id);
    if (!seq.every(Boolean))
      throw new ContentError(400, "Add Part 1, Part 2 and Part 3 first: the full test runs them in order.");
    config = { sequence: seq };
  }
  const kind = KIND[part];
  const [s] = await tx
    .insert(examSections)
    .values({
      examId: testId,
      kind,
      title: SECTION_TITLE[kind],
      displayOrder: ["part_1", "part_2", "part_3", "full_test"].indexOf(kind) + 1,
      status: "published",
      config,
    })
    .returning({ id: examSections.id });
  return s.id;
}

/** Copies a test (parts, topics, questions, card) as a new draft. */
async function duplicateTest(tx: Tx, actor: AppUser, op: Extract<TestOp, { op: "test.duplicate" }>): Promise<OpResult> {
  const src = await mustTest(tx, op.id);
  const c = await mustCategory(tx, src.moduleId);
  const bookId = op.bookId === undefined ? src.collectionId : await resolveBook(tx, c, op.bookId, undefined);
  await assertFreeNumber(tx, { moduleId: src.moduleId, bookId, number: op.number });
  const [copy] = await tx
    .insert(exams)
    .values({
      moduleId: src.moduleId,
      collectionId: bookId,
      examNumber: op.number,
      slug: `test-${op.number}-${newKey("x").slice(2)}`,
      title: src.title,
      description: src.description,
      status: "draft",
      metadata: { copiedFrom: src.id },
    })
    .returning({ id: exams.id });
  const sections = await sectionsOf(tx, src.id);
  const sectionMap = new Map<string, string>();
  for (const s of sections.filter((x) => x.kind !== "full_test")) {
    const [ns] = await tx
      .insert(examSections)
      .values({
        examId: copy.id,
        kind: s.kind,
        title: s.title,
        displayOrder: s.displayOrder,
        status: s.status,
        config: s.config,
      })
      .returning({ id: examSections.id });
    sectionMap.set(s.id, ns.id);
    const groups = await tx.select().from(questionGroups).where(eq(questionGroups.sectionId, s.id));
    const groupMap = new Map<string, string>();
    for (const g of groups) {
      const [ng] = await tx
        .insert(questionGroups)
        .values({
          sectionId: ns.id,
          kind: g.kind,
          title: g.title,
          intro: g.intro,
          isCore: g.isCore,
          engineKey: g.engineKey,
          position: g.position,
        })
        .returning({ id: questionGroups.id });
      groupMap.set(g.id, ng.id);
    }
    const links = await tx
      .select({ link: examQuestions, q: questions })
      .from(examQuestions)
      .innerJoin(questions, eq(questions.id, examQuestions.questionId))
      .where(and(eq(examQuestions.sectionId, s.id), isNull(questions.deletedAt)));
    for (const { link, q } of links) {
      // New question rows, so editing the copy never changes the original.
      const [nq] = await tx
        .insert(questions)
        .values({
          type: q.type,
          title: q.title,
          prompt: q.prompt,
          content: q.content,
          status: q.status,
          createdBy: actor.id,
        })
        .returning({ id: questions.id });
      await tx.insert(examQuestions).values({
        examId: copy.id,
        sectionId: ns.id,
        groupId: link.groupId ? (groupMap.get(link.groupId) ?? null) : null,
        questionId: nq.id,
        position: link.position,
      });
    }
  }
  const full = sections.find((x) => x.kind === "full_test");
  if (full) {
    const seq = ((full.config.sequence as string[]) ?? []).map((id) => sectionMap.get(id)).filter(Boolean);
    await tx.insert(examSections).values({
      examId: copy.id,
      kind: "full_test",
      title: full.title,
      displayOrder: 4,
      status: full.status,
      config: { sequence: seq },
    });
  }
  return { id: copy.id, message: "Copied as a draft." };
}
