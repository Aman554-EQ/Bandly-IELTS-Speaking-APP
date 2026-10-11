/**
 * Content v2 (step3-redesign-plan.md): the data migration, the library rules,
 * test and cue card admin operations, and cue card attempts, against a real
 * PostgreSQL (`bandly_test`). Run with `pnpm test:db` after `pnpm db:up`.
 */
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CueOp } from "@/content/cue-card-ops";
import { SAMPLE_SET } from "@/content/sample-set";
import { compileBlueprint } from "@/engine/compiler";
import type { TestOp } from "@/content/test-ops";
import type { AppUser } from "@/server/auth/policy";
import { grantRoleRow, loadAppUser, upsertUserFromClerk } from "@/server/auth/users";
import { ContentError } from "@/server/db/admin-common";
import { closeDb, type Db } from "@/server/db/client";
import { contentToSections } from "@/server/db/content";
import { migrateContentV2 } from "@/server/db/content-v2";
import { applyCueOp } from "@/server/db/cue-cards-admin";
import {
  getCategory,
  getTest,
  listCategories,
  listCueCards,
  listCueTopics,
  listTestsForPart,
  loadCueCardForAttempt,
  loadTestForAttempt,
  NotAvailableError,
  searchQuestionBank,
} from "@/server/db/library";
import {
  auditLogs,
  collections,
  cueCards,
  examAttempts,
  examQuestions,
  exams,
  examSections,
  modules,
  questionGroups,
  questions,
  results,
} from "@/server/db/schema";
import { applyTestOp } from "@/server/db/tests-admin";
import type { FinalReport, TurnRecord } from "@/server/db/types";
import { pointAtTestDatabase, resetDatabase } from "./helpers";

pointAtTestDatabase();
const repo = await import("@/server/db/repo");

let db: Db;
let cats: Map<string, string>;
let topics: Map<string, string>;
let admin: AppUser;
let student: AppUser;

async function makeUser(n: string, role?: "admin" | "superadmin"): Promise<AppUser> {
  const { id } = await upsertUserFromClerk(
    db,
    { id: `user_${n}`, email: `${n}@example.com`, firstName: n, lastName: null, imageUrl: null },
    "lazy_sync",
  );
  if (role) await grantRoleRow(db, id, role, null);
  return (await loadAppUser(db, { id }))!;
}

const t = (op: TestOp, actor: AppUser = admin) => applyTestOp(db, actor, op);
const c = (op: CueOp, actor: AppUser = admin) => applyCueOp(db, actor, op);

async function fails(p: Promise<unknown>): Promise<ContentError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ContentError) return e;
    throw e;
  }
  throw new Error("Expected the operation to fail");
}

const card = (prompt = "Describe a book you enjoyed reading.") => ({
  prompt,
  bullets: ["what the book was", "when you read it", "what it was about"],
  explain: "and explain why you enjoyed it.",
  roundOff: ["Do you read often?"],
});

const take = (n: number, questionKey: string): Omit<TurnRecord, "seq"> =>
  ({
    takeId: `t${n}`,
    part: 2,
    questionId: questionKey,
    question: "q",
    kind: "long_turn",
    attempt: 0,
    outcome: "end_of_turn",
    speechMs: 60_000,
    durationMs: 61_000,
    firstSpeechLatencyMs: 500,
    scored: true,
    transcript: `answer ${n}`,
    features: null,
    analysis: { intent: "answer" },
    sttModel: null,
    analysisModel: null,
    createdAt: new Date().toISOString(),
  }) as unknown as Omit<TurnRecord, "seq">;

/** Builds a complete test through admin operations and publishes it. */
async function buildTest(
  categoryId: string,
  number: number,
  parts = { part1: true, part2: true, part3: true, full: true },
  book?: { newBookNumber?: number; bookId?: string },
) {
  const { id } = await t({ op: "test.create", categoryId, number, parts, ...book });
  const topic1 = parts.part1
    ? (
        await t({
          op: "topic.create",
          testId: id!,
          part: 1,
          title: "Hometown",
          intro: "Let's talk about your hometown.",
          isCore: true,
        })
      ).id!
    : null;
  if (topic1) {
    await t({ op: "question.create", topicId: topic1, fields: { part: 1, text: "Where is your hometown?" } });
    await t({ op: "question.create", topicId: topic1, fields: { part: 1, text: "What do you like about it?" } });
  }
  if (parts.part2) await t({ op: "card.save", testId: id!, fields: card() });
  const topic3 = parts.part3
    ? (await t({ op: "topic.create", testId: id!, part: 3, title: "Reading", intro: "Let's consider reading habits." }))
        .id!
    : null;
  if (topic3) {
    await t({ op: "question.create", topicId: topic3, fields: { part: 3, text: "Why do people read less?" } });
    await t({ op: "question.create", topicId: topic3, fields: { part: 3, text: "Will books disappear?" } });
  }
  return { id: id!, topic1, topic3 };
}

beforeAll(async () => {
  const r = await resetDatabase();
  db = r.db;
  cats = r.categories;
  topics = r.topics;
  admin = await makeUser("v2-admin", "admin");
  student = await makeUser("v2-student");
}, 60_000);

afterAll(async () => {
  await closeDb();
});

describe("categories", () => {
  it("exactly four, in order, with the new name", async () => {
    const all = await listCategories(db);
    expect(all.map((x) => [x.kind, x.title])).toEqual([
      ["cambridge", "Cambridge"],
      ["practice_test", "Practice Test Exam"],
      ["recent_real", "Recent Real Test Questions"],
      ["cue_cards", "Makkar Cue Cards"],
    ]);
  });

  it("can be renamed and reordered, but no fifth category can be created", async () => {
    await t({ op: "category.update", id: cats.get("recent_real")!, description: "Fresh questions." });
    await t({ op: "category.move", id: cats.get("recent_real")!, direction: "up" });
    expect((await listCategories(db)).map((x) => x.kind)).toEqual([
      "cambridge",
      "recent_real",
      "practice_test",
      "cue_cards",
    ]);
    await t({ op: "category.move", id: cats.get("recent_real")!, direction: "down" });
    // There is no "category.create" operation at all (schema-level guarantee).
    expect(
      await import("@/content/test-ops").then((m) => m.testOp.safeParse({ op: "category.create", title: "X" }).success),
    ).toBe(false);
  });
});

describe("tests: build, publish, list by part", () => {
  let cam: { id: string; topic1: string | null; topic3: string | null };

  it("a Cambridge test needs a book; the label is “Cambridge 22, Test 1”", async () => {
    expect(
      (
        await fails(
          t({
            op: "test.create",
            categoryId: cats.get("cambridge")!,
            number: 1,
            parts: { part1: true, part2: false, part3: false, full: false },
          }),
        )
      ).message,
    ).toMatch(/Choose a Cambridge book/);
    cam = await buildTest(cats.get("cambridge")!, 1, undefined, { newBookNumber: 22 });
    const view = await getTest(db, cam.id, { preview: true });
    expect(view!.label).toBe("Cambridge 22, Test 1");
    expect(view!.status).toBe("draft");
    expect(await getTest(db, cam.id)).toBeNull(); // drafts are invisible to students
  });

  it("publishing is refused while a part is incomplete, with the reasons", async () => {
    const { id } = await t({
      op: "test.create",
      categoryId: cats.get("recent_real")!,
      number: 1,
      parts: { part1: true, part2: true, part3: false, full: false },
    });
    const e = await fails(t({ op: "test.status", id: id!, status: "published" }));
    expect(e.status).toBe(400);
    expect(e.problems).toEqual([
      "Part 1 has no topic yet.",
      "Part 1 needs at least 2 questions (it has 0).",
      "Part 2 has no cue card yet.",
    ]);
    await t({ op: "test.delete", id: id! });
  });

  it("a complete test publishes and appears in every part's list", async () => {
    await t({ op: "test.status", id: cam.id, status: "published" });
    for (const mode of ["part1", "part2", "part3", "full"] as const) {
      const list = await listTestsForPart(db, { mode, categoryId: cats.get("cambridge")! });
      expect(list.map((x) => x.label)).toContain("Cambridge 22, Test 1");
    }
  });

  it("a test with only Parts 1 and 2 is listed under those parts only", async () => {
    const pt = await buildTest(cats.get("practice_test")!, 2, { part1: true, part2: true, part3: false, full: false });
    await t({ op: "test.status", id: pt.id, status: "published" });
    const listed = async (mode: "part1" | "part2" | "part3" | "full") =>
      (await listTestsForPart(db, { mode, categoryId: cats.get("practice_test")! })).map((x) => x.label);
    expect(await listed("part1")).toContain("Practice Test Exam, Test 2");
    expect(await listed("part2")).toContain("Practice Test Exam, Test 2");
    expect(await listed("part3")).not.toContain("Practice Test Exam, Test 2");
    expect(await listed("full")).not.toContain("Practice Test Exam, Test 2");
    // Newest number first in a category without books.
    expect((await listed("part1"))[0]).toBe("Practice Test Exam, Test 2");
  });

  it("a duplicate test number in the same place is refused", async () => {
    const e = await fails(
      t({
        op: "test.create",
        categoryId: cats.get("practice_test")!,
        number: 2,
        parts: { part1: true, part2: false, part3: false, full: false },
      }),
    );
    expect(e.status).toBe(409);
    expect(e.message).toMatch(/^Test 2 already exists in Practice Test Exam .*the next free one is \d+\.$/);
    // Same rule per Cambridge book, and when renumbering or duplicating.
    const again = await fails(
      t({
        op: "test.create",
        categoryId: cats.get("cambridge")!,
        bookId: (await getTest(db, cam.id))!.book!.id,
        number: 1,
        parts: { part1: true, part2: false, part3: false, full: false },
      }),
    );
    expect(again.message).toMatch(/^Test 1 already exists in Cambridge 22/);
    expect((await fails(t({ op: "test.duplicate", id: cam.id, number: 1 }))).status).toBe(409);
    expect(e.name).toBe("ContentError");
  });

  it("a Part 3 question can't go into a Part 1 topic", async () => {
    const e = await fails(t({ op: "question.create", topicId: cam.topic1!, fields: { part: 3, text: "Why?" } }));
    expect(e.message).toBe("“Hometown” is a Part 1 topic. Add Part 3 questions under a Part 3 topic.");
  });

  it("the full test is explicit: it needs all three parts, and they can't be removed under it", async () => {
    const { id } = await t({
      op: "test.create",
      categoryId: cats.get("recent_real")!,
      number: 5,
      parts: { part1: true, part2: false, part3: false, full: false },
    });
    expect((await fails(t({ op: "part.add", testId: id!, part: "full" }))).message).toMatch(
      /Add Part 1, Part 2 and Part 3 first/,
    );
    expect((await fails(t({ op: "part.remove", testId: cam.id, part: "part2" }))).message).toMatch(
      /Remove the full test first/,
    );
    const view = await getTest(db, cam.id);
    expect(view!.parts.full!.sequence).toEqual([
      view!.parts.part1!.sectionId,
      view!.parts.part2!.sectionId,
      view!.parts.part3!.sectionId,
    ]);
    await t({ op: "test.delete", id: id! });
  });

  it("topic and question order is what the examiner asks", async () => {
    const t2 = (
      await t({
        op: "topic.create",
        testId: cam.id,
        part: 1,
        title: "Walking",
        intro: "Now, let's talk about walking.",
      })
    ).id!;
    await t({ op: "question.create", topicId: t2, fields: { part: 1, text: "Do you walk a lot?" } });
    await t({ op: "topic.move", id: t2, direction: "up" });
    const content = (await loadTestForAttempt(db, { testId: cam.id, mode: "part1", canPreview: false })).set.content;
    expect(content.part1.map((x) => x.title)).toEqual(["Walking", "Hometown"]);
    const view = await getTest(db, cam.id);
    const [q1, q2] = view!.parts.part1!.groups.find((g) => g.title === "Hometown")!.questions;
    await t({ op: "question.move", id: q2.id, direction: "up" });
    const after = (await getTest(db, cam.id))!.parts
      .part1!.groups.find((g) => g.title === "Hometown")!
      .questions.map((q) => q.id);
    expect(after).toEqual([q2.id, q1.id]);
  });

  it("changed spoken wording gets a new engine key; other edits keep it", async () => {
    const before = (await getTest(db, cam.id))!;
    const g = before.parts.part1!.groups.find((x) => x.title === "Hometown")!;
    const q = g.questions[0];
    await t({ op: "question.update", id: q.id, fields: { part: 1, text: q.question.text, allowWhyProbe: true } });
    await t({ op: "topic.update", id: g.id, title: "Your hometown" });
    let now = (await getTest(db, cam.id))!.parts.part1!.groups.find((x) => x.id === g.id)!;
    expect(now.questions.find((x) => x.id === q.id)!.question.id).toBe(q.question.id);
    expect(now.engineKey).toBe(g.engineKey);
    await t({ op: "question.update", id: q.id, fields: { part: 1, text: "Where were you born?" } });
    await t({ op: "topic.update", id: g.id, intro: "First, your hometown." });
    now = (await getTest(db, cam.id))!.parts.part1!.groups.find((x) => x.id === g.id)!;
    expect(now.questions.find((x) => x.id === q.id)!.question.id).not.toBe(q.question.id);
    expect(now.engineKey).not.toBe(g.engineKey);
    const cardBefore = before.parts.part2!.card!.card.id;
    await t({ op: "card.save", testId: cam.id, fields: { ...card(), bullets: ["who wrote it"] } });
    expect((await getTest(db, cam.id))!.parts.part2!.card!.card.id).toBe(cardBefore);
    await t({ op: "card.save", testId: cam.id, fields: { ...card(), spokenPrompt: "Please describe a book." } });
    expect((await getTest(db, cam.id))!.parts.part2!.card!.card.id).not.toBe(cardBefore);
  });

  it("a recorded test blocks deleting; archiving hides it from students", async () => {
    const a = await loadTestForAttempt(db, { testId: cam.id, mode: "part1", canPreview: false });
    const s = await repo.createSession({
      userId: student.id,
      mode: "part1",
      fidelity: "exam",
      examinerId: "emma",
      set: a.set,
    });
    const qKey = a.set.content.part1[0].questions[0].id;
    await repo.upsertTurn(s.id, { ...take(1, qKey), part: 1 });
    expect((await fails(t({ op: "test.delete", id: cam.id }))).message).toMatch(/1 recorded test used it/);
    const topicId = (await getTest(db, cam.id))!.parts.part1!.groups[0].id;
    expect((await fails(t({ op: "topic.delete", id: topicId }))).status).toBe(409);
    await t({ op: "test.status", id: cam.id, status: "archived" });
    expect(await getTest(db, cam.id)).toBeNull();
    expect(await repo.getSession(s.id, student.id)).not.toBeNull();
    await t({ op: "test.status", id: cam.id, status: "published" });
  });

  it("books: only Cambridge has them; a book with tests can't be deleted", async () => {
    expect((await fails(t({ op: "book.create", categoryId: cats.get("practice_test")!, number: 3 }))).status).toBe(400);
    const book = (await getTest(db, cam.id))!.book!;
    expect((await fails(t({ op: "book.delete", id: book.id }))).message).toMatch(/still has 1 test/);
  });

  it("students can't change content, and the attempt is audited", async () => {
    expect((await fails(t({ op: "category.update", id: cats.get("cambridge")!, title: "X" }, student))).status).toBe(
      403,
    );
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(eq(auditLogs.action, "category.update.denied"));
    expect(row.n).toBe(1);
  });

  it("duplicating a test copies its parts and topics as an independent draft", async () => {
    const { id } = await t({ op: "test.duplicate", id: cam.id, number: 2 });
    const copy = (await getTest(db, id!, { preview: true }))!;
    const orig = (await getTest(db, cam.id))!;
    expect(copy.status).toBe("draft");
    expect(copy.label).toBe("Cambridge 22, Test 2");
    expect(copy.parts.part1!.groups.map((g) => g.title)).toEqual(orig.parts.part1!.groups.map((g) => g.title));
    expect(copy.parts.part1!.groups[0].questions[0].id).not.toBe(orig.parts.part1!.groups[0].questions[0].id);
    expect(copy.problems).toEqual([]);
  });
});

describe("question management (v0.7)", () => {
  let a: Awaited<ReturnType<typeof buildTest>>;
  let b: Awaited<ReturnType<typeof buildTest>>;
  const p3 = (id: string) => getTest(db, id, { preview: true }).then((x) => x!.parts.part3!.groups);

  beforeAll(async () => {
    a = await buildTest(cats.get("practice_test")!, 40);
    b = await buildTest(cats.get("practice_test")!, 41, { part1: true, part2: false, part3: false, full: false });
  });

  it("several questions can be pasted at once; Part 3 questions keep their type", async () => {
    await t({
      op: "question.createMany",
      topicId: a.topic3!,
      texts: ["What makes a good book?", "How has reading changed?"],
      kind: "compare",
    });
    const g = (await p3(a.id))[0];
    expect(g.questions.map((q) => q.question.text)).toEqual([
      "Why do people read less?",
      "Will books disappear?",
      "What makes a good book?",
      "How has reading changed?",
    ]);
    expect(g.questions[3].question.kind).toBe("compare");
    expect(new Set(g.questions.map((q) => q.question.id)).size).toBe(4);
    expect(
      (await fails(t({ op: "question.createMany", topicId: a.topic1!, texts: ["Q?"], kind: "opinion" }))).status,
    ).toBe(400);
    const q = g.questions[0];
    await t({ op: "question.update", id: q.id, fields: { part: 3, text: q.question.text, kind: "reasons" } });
    const after = (await p3(a.id))[0].questions[0].question;
    expect(after.kind).toBe("reasons");
    expect(after.id).toBe(q.question.id); // a type is not spoken: same audio key
  });

  it("a question can move to another topic of the same part, but not to another part or test", async () => {
    const t2 = (await t({ op: "topic.create", testId: a.id, part: 3, title: "Libraries", intro: "Now, libraries." }))
      .id!;
    const q = (await p3(a.id))[0].questions[0];
    await t({ op: "question.regroup", id: q.id, topicId: t2 });
    const groups = await p3(a.id);
    expect(groups[0].questions.map((x) => x.id)).not.toContain(q.id);
    expect(groups[1].questions.map((x) => x.id)).toEqual([q.id]);
    expect((await fails(t({ op: "question.regroup", id: q.id, topicId: a.topic1! }))).status).toBe(400);
    expect((await fails(t({ op: "question.regroup", id: q.id, topicId: b.topic1! }))).status).toBe(400);
  });

  it("a topic can be copied to another test with its questions, as independent rows", async () => {
    const r = await t({ op: "topic.copy", id: a.topic1!, testId: b.id });
    expect(r.message).toMatch(/copied to the other test with 2 questions/);
    const src = (await getTest(db, a.id, { preview: true }))!.parts.part1!.groups[0];
    const dst = (await getTest(db, b.id, { preview: true }))!.parts.part1!.groups;
    expect(dst.map((g) => g.title)).toEqual(["Hometown", "Hometown"]);
    const copy = dst[1];
    expect(copy.questions.map((q) => q.question.text)).toEqual(src.questions.map((q) => q.question.text));
    expect(copy.questions[0].id).not.toBe(src.questions[0].id);
    expect(copy.questions[0].question.id).not.toBe(src.questions[0].question.id);
    expect(copy.engineKey).not.toBe(src.engineKey);
    expect((await fails(t({ op: "topic.copy", id: a.topic3!, testId: b.id }))).message).toMatch(/has no Part 3/);
  });

  it("the question bank finds questions across tests and cue cards", async () => {
    const bank = await searchQuestionBank(db, { q: "good book" });
    expect(bank.rows.map((r) => r.text)).toEqual(["What makes a good book?"]);
    expect(bank.rows[0]).toMatchObject({ part: 3, kind: "compare", topic: "Reading", ownerId: a.id });
    const byKind = await searchQuestionBank(db, { kind: "reasons" });
    expect(byKind.rows.every((r) => r.kind === "reasons")).toBe(true);
    const p1 = await searchQuestionBank(db, { part: 1, categoryId: cats.get("practice_test")! });
    expect(p1.rows.every((r) => r.part === 1)).toBe(true);
    expect(p1.rows.length).toBeGreaterThanOrEqual(4);
    const cards = await searchQuestionBank(db, { part: 2 });
    expect(cards.rows.some((r) => r.source === "card")).toBe(true);
    expect(cards.rows.some((r) => r.source === "test")).toBe(true);
  });

  it("the exam engine asks the database questions in the admin's order", async () => {
    const qs = (await p3(a.id))[0].questions;
    await t({ op: "question.move", id: qs[1].id, direction: "up" });
    await t({ op: "test.status", id: a.id, status: "published" });
    const { set } = await loadTestForAttempt(db, { testId: a.id, mode: "full", canPreview: false });
    const bp = compileBlueprint({ mode: "full", fidelity: "exam", content: set.content, localHour: 9 });
    const asked = bp.steps.flatMap((s) => (s.kind === "ask" ? [s.clip.text] : []));
    const view = (await getTest(db, a.id))!;
    const expected = [
      ...view.parts.part1!.groups.flatMap((g) => g.questions.map((q) => q.question.text)),
      ...view.parts.part3!.groups.flatMap((g) => g.questions.map((q) => q.question.text)),
    ];
    expect(asked).toEqual(expected);
    expect(asked.slice(2, 4)).toEqual(["What makes a good book?", "Will books disappear?"]);
    expect(bp.steps.some((s) => s.kind === "cuecard_show")).toBe(true);
    await t({ op: "question.status", id: qs[1].id, status: "archived" });
    const again = await loadTestForAttempt(db, { testId: a.id, mode: "part3", canPreview: false });
    expect(again.set.content.cueCard.part3[0].questions.map((q) => q.text)).not.toContain("What makes a good book?");
  });
});

describe("cue cards (separate from tests)", () => {
  let hobbies: string;
  let cardA: string;
  let cardB: string;

  it("the seeded topics exist and the sample card is under Experiences", async () => {
    const all = await listCueTopics(db, { preview: true });
    expect(all.slice(0, 6).map((x) => x.title)).toEqual([
      "People",
      "Places",
      "Objects",
      "Experiences",
      "Events",
      "Activities",
    ]);
    expect((await listCueTopics(db)).map((x) => x.title)).toEqual(["Experiences"]); // students: topics with cards only
  });

  it("a topic appears to students once it has a published card", async () => {
    hobbies = (await c({ op: "cueTopic.create", title: "Hobbies" })).id!;
    cardA = (await c({ op: "cueCard.create", topicId: hobbies, fields: card("Describe a hobby you enjoy.") })).id!;
    cardB = (await c({ op: "cueCard.create", topicId: hobbies, fields: card("Describe a new hobby you want to try.") }))
      .id!;
    expect((await listCueTopics(db)).map((x) => x.title)).not.toContain("Hobbies");
    await c({ op: "cueCard.status", id: cardA, status: "published" });
    expect((await listCueTopics(db)).find((x) => x.title === "Hobbies")!.cardCount).toBe(1);
  });

  it("cards never appear in any test list", async () => {
    for (const mode of ["part1", "part2", "part3", "full"] as const) {
      const labels = (await listTestsForPart(db, { mode })).map((x) => x.label);
      expect(labels.some((l) => l.includes("hobby"))).toBe(false);
    }
  });

  it("cards can be reordered, searched and moved between topics", async () => {
    await c({ op: "cueCard.status", id: cardB, status: "published" });
    await c({ op: "cueCard.move", id: cardB, direction: "up" });
    expect((await listCueCards(db, { topicId: hobbies })).items.map((x) => x.id)).toEqual([cardB, cardA]);
    expect((await listCueCards(db, { q: "new hobby" })).items.map((x) => x.id)).toEqual([cardB]);
    await c({
      op: "cueCard.update",
      id: cardB,
      topicId: topics.get("activities")!,
      fields: card("Describe a new hobby you want to try."),
    });
    expect((await listCueCards(db, { topicId: topics.get("activities")! })).items.map((x) => x.id)).toEqual([cardB]);
  });

  it("a topic with cards can't be deleted", async () => {
    expect((await fails(c({ op: "cueTopic.delete", id: hobbies }))).message).toMatch(/still has 1 card/);
  });

  it("a cue card attempt is Part 2, is scored, and blocks deleting the card", async () => {
    const a = await loadCueCardForAttempt(db, { cardId: cardA, canPreview: false });
    expect(a.set.content.part1).toEqual([]);
    expect(a.set.content.cueCard.prompt).toBe("Describe a hobby you enjoy.");
    const s = await repo.createSession({
      userId: student.id,
      mode: "part2",
      fidelity: "guided",
      examinerId: "james",
      set: a.set,
      cueCard: true,
    });
    const [row] = await db.select().from(examAttempts).where(eq(examAttempts.id, s.id));
    expect(row).toMatchObject({ examId: null, sectionId: null, cueCardId: cardA });
    await repo.upsertTurn(s.id, take(1, "long-turn"));
    await repo.completeSession(s.id, { endReason: "completed", events: [], durationMs: 90_000 });
    await repo.saveFinalReport(s.id, {
      mode: "part2",
      overall: 6,
      criteria: null,
      parts: [],
      summary: "Good",
      strengths: [],
      priorities: [],
      model: "test",
      promptVersion: "v",
      createdAt: new Date().toISOString(),
    } as unknown as FinalReport);
    const [res] = await db.select().from(results).where(eq(results.attemptId, s.id));
    expect(res).toMatchObject({ cueCardId: cardA, examId: null, bandScore: 6 });
    const got = await repo.getSession(s.id, student.id);
    expect(got).toMatchObject({ mode: "part2", status: "scored", setTitle: a.set.title });
    expect((await repo.listSessions(student.id)).find((x) => x.id === s.id)?.mode).toBe("part2");
    expect((await fails(c({ op: "cueCard.delete", id: cardA }))).message).toMatch(/Archive it instead/);
  });

  it("drafts can't be practiced by students", async () => {
    const { id } = await c({ op: "cueCard.create", topicId: hobbies, fields: card("Describe a draft.") });
    await expect(loadCueCardForAttempt(db, { cardId: id!, canPreview: false })).rejects.toBeInstanceOf(
      NotAvailableError,
    );
    expect((await loadCueCardForAttempt(db, { cardId: id!, canPreview: true })).preview).toBe(true);
  });

  it("the cue card endpoint accepts no test operations, and the other way round", async () => {
    const cue = (await import("@/content/cue-card-ops")).cueOp;
    const test = (await import("@/content/test-ops")).testOp;
    expect(cue.safeParse({ op: "card.save", testId: cardA, fields: card() }).success).toBe(false);
    expect(test.safeParse({ op: "cueCard.create", topicId: hobbies, fields: card() }).success).toBe(false);
  });
});

describe("migration from the v0.5 layout", () => {
  let oldTestId: string;
  let oldCueExamId: string;
  let oldAttemptId: string;

  beforeAll(async () => {
    // Build the OLD shape by hand: topics inside question JSON, a one-test collection,
    // an implicit full test, a cue card stored as an exam in a hidden collection,
    // and the category with its old slug and title.
    const practice = cats.get("practice_test")!;
    await db.update(modules).set({ kind: null, slug: "test-exam", title: "Test Exam" }).where(eq(modules.id, practice));
    const [col] = await db
      .insert(collections)
      .values({ moduleId: practice, slug: "test-9", title: "Test 9", sortNumber: 9, status: "published" })
      .returning();
    const [ex] = await db
      .insert(exams)
      .values({
        moduleId: practice,
        collectionId: col.id,
        slug: "old",
        title: "Old test",
        status: "published",
        publishedAt: new Date(),
      })
      .returning();
    oldTestId = ex.id;
    let pos = 0;
    for (const s of contentToSections(SAMPLE_SET)) {
      const [sec] = await db
        .insert(examSections)
        .values({ examId: ex.id, kind: s.kind, title: s.title, status: "published", config: s.config })
        .returning();
      for (const q of s.questions) {
        const [qq] = await db
          .insert(questions)
          .values({ ...q, status: "published" })
          .returning();
        await db.insert(examQuestions).values({ examId: ex.id, sectionId: sec.id, questionId: qq.id, position: ++pos });
      }
    }
    const cue = cats.get("cue_cards")!;
    const [hidden] = await db
      .insert(collections)
      .values({ moduleId: cue, slug: "all", title: "Makkar", status: "published", metadata: { default: true } })
      .returning();
    const [ce] = await db
      .insert(exams)
      .values({ moduleId: cue, collectionId: hidden.id, slug: "old-card", title: "Old card", status: "published" })
      .returning();
    oldCueExamId = ce.id;
    const [sec] = await db
      .insert(examSections)
      .values({ examId: ce.id, kind: "part_2", title: "Part 2", status: "published" })
      .returning();
    const oldCard = { ...SAMPLE_SET.cueCard, id: "old-card-key", prompt: "Describe an old friend." };
    const { part3: _p3, ...cardOnly } = oldCard;
    const [qq] = await db
      .insert(questions)
      .values({
        type: "cue_card",
        title: "x",
        prompt: "x",
        content: { part: 2, engineId: "old-card-key", card: cardOnly },
        status: "published",
      })
      .returning();
    await db.insert(examQuestions).values({ examId: ce.id, sectionId: sec.id, questionId: qq.id, position: 1 });
    const [att] = await db
      .insert(examAttempts)
      .values({
        userId: student.id,
        examId: ce.id,
        sectionId: sec.id,
        status: "submitted",
        settings: { fidelity: "exam", examinerId: "emma" },
        contentSnapshot: { setTitle: "Old card" },
      })
      .returning();
    oldAttemptId = att.id;
  });

  it("a dry run reports but changes nothing", async () => {
    const r = await migrateContentV2(db, { dryRun: true });
    expect(r.groupsCreated).toBeGreaterThan(0);
    const [g] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(questionGroups)
      .innerJoin(examSections, eq(examSections.id, questionGroups.sectionId))
      .where(eq(examSections.examId, oldTestId));
    expect(g.n).toBe(0);
  });

  it("the real run converts everything", async () => {
    const r = await migrateContentV2(db);
    expect(r).toMatchObject({
      categoriesUpgraded: 1,
      groupsCreated: 4,
      questionsLinked: 13,
      fullTestsSequenced: 1,
      testsMovedOutOfCollections: 1,
      cueCardsCreated: 1,
      oldCueExamsArchived: 1,
    });
    expect(r.collectionsArchived).toBe(2); // "Test 9" + the hidden cue card collection
  });

  it("the old test is now “Practice Test Exam, Test 9” with real topics and the same content", async () => {
    const view = (await getTest(db, oldTestId))!;
    expect(view.label).toBe("Practice Test Exam, Test 9");
    expect(view.book).toBeNull();
    expect(view.available).toEqual(["part1", "part2", "part3", "full"]);
    expect((await loadTestForAttempt(db, { testId: oldTestId, mode: "full", canPreview: false })).set.content).toEqual(
      SAMPLE_SET,
    );
  });

  it("the category got its kind back, its new name, and the old link redirects", async () => {
    expect((await listCategories(db)).find((x) => x.kind === "practice_test")!.title).toBe("Practice Test Exam");
    expect(await getCategory(db, "test-exam")).toEqual({ redirectTo: "practice-test" });
  });

  it("the old cue card exam became a real cue card; its old attempt still opens", async () => {
    const [card1] = await db.select().from(cueCards).where(eq(cueCards.engineKey, "old-card-key"));
    expect(card1).toMatchObject({ prompt: "Describe an old friend.", status: "published" });
    const [ex] = await db.select().from(exams).where(eq(exams.id, oldCueExamId));
    expect(ex.status).toBe("archived");
    expect(ex.metadata.migratedTo).toBe(card1.id);
    expect(await repo.getSession(oldAttemptId, student.id)).toMatchObject({ mode: "part2", setTitle: "Old card" });
  });

  it("running it again changes nothing", async () => {
    const r = await migrateContentV2(db);
    expect(r).toMatchObject({
      categoriesUpgraded: 0,
      groupsCreated: 0,
      questionsLinked: 0,
      fullTestsSequenced: 0,
      testsNumbered: 0,
      cueCardsCreated: 0,
      oldCueExamsArchived: 0,
      collectionsArchived: 0,
    });
    const [n] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(cueCards)
      .where(and(eq(cueCards.engineKey, "old-card-key")));
    expect(n.n).toBe(1);
  });
});
