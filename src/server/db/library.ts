/**
 * Content v2, read side: the four categories, tests (with their parts and
 * topics), books, and the separate Makkar cue card library. Students see only
 * published content; `preview: true` (admins, superadmins) shows everything.
 * Takes the database as a parameter so tests and scripts share it.
 * See step3-redesign-plan.md §2–3.
 */
import { and, asc, count, eq, ilike, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import type { CategoryKind } from "@/content/categories";
import type { ExamMode } from "@/engine/types";
import {
  availableParts,
  type CardData,
  cardShape,
  type ContentStatus,
  contentForTest,
  cueCardContent,
  type GroupView,
  p1QuestionPayload,
  p2CardPayload,
  p3QuestionPayload,
  PART_LABEL,
  publishProblems,
  type QuestionView,
  type TestParts,
  testLabel,
} from "./assemble";
import type { Db } from "./client";
import {
  collections,
  cueCards,
  cueCardTopics,
  examAttempts,
  examQuestions,
  exams,
  examSections,
  modules,
  questionGroups,
  questions,
} from "./schema";
import type { QuestionSet } from "./types";
import { UUID_RE } from "./uuid";

export class NotAvailableError extends Error {}

export interface Visibility {
  preview?: boolean;
}

// --------------------------------------------------------------- categories

export interface CategoryRow {
  id: string;
  kind: CategoryKind;
  slug: string;
  title: string;
  description: string | null;
  displayOrder: number;
}

const categoryCols = {
  id: modules.id,
  kind: modules.kind,
  slug: modules.slug,
  title: modules.title,
  description: modules.description,
  displayOrder: modules.displayOrder,
};

export async function listCategories(db: Db): Promise<CategoryRow[]> {
  const rows = await db
    .select(categoryCols)
    .from(modules)
    .where(and(isNotNull(modules.kind), isNull(modules.deletedAt)))
    .orderBy(asc(modules.displayOrder), asc(modules.id));
  return rows as CategoryRow[];
}

/** A category by its URL slug. An old slug (e.g. "test-exam") returns `{ redirectTo }`. */
export async function getCategory(
  db: Db,
  slug: string,
): Promise<{ category: CategoryRow } | { redirectTo: string } | null> {
  const all = await db
    .select({ ...categoryCols, config: modules.config })
    .from(modules)
    .where(and(isNotNull(modules.kind), isNull(modules.deletedAt)));
  const hit = all.find((c) => c.slug === slug);
  if (hit) return { category: hit as CategoryRow };
  const old = all.find((c) => ((c.config.oldSlugs as string[] | undefined) ?? []).includes(slug));
  return old ? { redirectTo: old.slug } : null;
}

export async function getCategoryByKind(db: Db, kind: CategoryKind): Promise<CategoryRow | null> {
  const [c] = await db.select(categoryCols).from(modules).where(eq(modules.kind, kind));
  return (c as CategoryRow) ?? null;
}

// --------------------------------------------------------------------- tests

export interface TestView {
  id: string;
  category: { id: string; kind: CategoryKind; title: string; slug: string };
  book: { id: string; title: string; number: number | null } | null;
  number: number | null;
  title: string | null;
  description: string | null;
  status: ContentStatus;
  everPublished: boolean;
  /** "Cambridge 21, Test 4" */
  label: string;
  parts: TestParts;
  /** Parts students can start right now (if published). */
  available: ExamMode[];
  /** What blocks publishing. */
  problems: string[];
  metadata: Record<string, unknown>;
}

/** Loads tests with their parts, topics and questions in five queries (no N+1). */
async function loadTests(db: Db, where: SQL | undefined): Promise<TestView[]> {
  const rows = await db
    .select({
      id: exams.id,
      number: exams.examNumber,
      title: exams.title,
      description: exams.description,
      status: exams.status,
      publishedAt: exams.publishedAt,
      metadata: exams.metadata,
      categoryId: modules.id,
      categoryKind: modules.kind,
      categoryTitle: modules.title,
      categorySlug: modules.slug,
      bookId: collections.id,
      bookTitle: collections.title,
      bookNumber: collections.sortNumber,
    })
    .from(exams)
    .innerJoin(modules, eq(modules.id, exams.moduleId))
    .leftJoin(collections, eq(collections.id, exams.collectionId))
    .where(and(isNull(exams.deletedAt), isNotNull(modules.kind), ne(modules.kind, "cue_cards"), where));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const sections = await db
    .select({ id: examSections.id, examId: examSections.examId, kind: examSections.kind, config: examSections.config })
    .from(examSections)
    .where(and(inArray(examSections.examId, ids), isNull(examSections.deletedAt)));
  const sectionIds = sections.map((s) => s.id);
  const [groups, qrows] = await Promise.all([
    sectionIds.length
      ? db
          .select()
          .from(questionGroups)
          .where(inArray(questionGroups.sectionId, sectionIds))
          .orderBy(asc(questionGroups.position), asc(questionGroups.id))
      : Promise.resolve([]),
    db
      .select({
        examQuestionId: examQuestions.id,
        sectionId: examQuestions.sectionId,
        groupId: examQuestions.groupId,
        position: examQuestions.position,
        id: questions.id,
        status: questions.status,
        content: questions.content,
        usedBy: sql<number>`(SELECT count(*)::int FROM attempt_answers aa
          WHERE aa.question_id = ${questions.id} OR aa.exam_question_id = ${examQuestions.id})`,
      })
      .from(examQuestions)
      .innerJoin(questions, eq(questions.id, examQuestions.questionId))
      .where(and(inArray(examQuestions.examId, ids), isNull(questions.deletedAt)))
      .orderBy(asc(examQuestions.position), asc(examQuestions.id)),
  ]);

  function groupsOf<Q>(sectionId: string, parse: (c: unknown) => Q | null): GroupView<Q>[] {
    return groups
      .filter((g) => g.sectionId === sectionId)
      .map((g) => ({
        id: g.id,
        title: g.title,
        intro: g.intro,
        isCore: g.isCore,
        engineKey: g.engineKey,
        position: g.position,
        questions: qrows
          .filter((q) => q.groupId === g.id)
          .flatMap((q): QuestionView<Q>[] => {
            const parsed = parse(q.content);
            return parsed
              ? [
                  {
                    id: q.id,
                    examQuestionId: q.examQuestionId,
                    position: q.position,
                    status: q.status,
                    question: parsed,
                    usedBy: q.usedBy,
                  },
                ]
              : [];
          }),
      }));
  }

  return rows.map((r) => {
    const mine = sections.filter((s) => s.examId === r.id);
    const s1 = mine.find((s) => s.kind === "part_1");
    const s2 = mine.find((s) => s.kind === "part_2");
    const s3 = mine.find((s) => s.kind === "part_3");
    const sf = mine.find((s) => s.kind === "full_test");
    const parts: TestParts = {};
    if (s1)
      parts.part1 = {
        sectionId: s1.id,
        groups: groupsOf(s1.id, (c) => p1QuestionPayload.safeParse(c).data?.question ?? null),
      };
    if (s3)
      parts.part3 = {
        sectionId: s3.id,
        groups: groupsOf(s3.id, (c) => p3QuestionPayload.safeParse(c).data?.question ?? null),
      };
    if (s2) {
      const q = qrows.find((x) => x.sectionId === s2.id && p2CardPayload.safeParse(x.content).success);
      const card = q ? p2CardPayload.parse(q.content).card : null;
      parts.part2 = {
        sectionId: s2.id,
        card:
          q && card
            ? {
                id: q.id,
                examQuestionId: q.examQuestionId,
                position: q.position,
                status: q.status,
                question: card,
                card,
                usedBy: q.usedBy,
              }
            : null,
      };
    }
    if (sf) {
      const seq = (sf.config.sequence as string[] | undefined) ?? [];
      parts.full = { sectionId: sf.id, sequence: seq };
    }
    const book = r.bookId ? { id: r.bookId, title: r.bookTitle!, number: r.bookNumber } : null;
    return {
      id: r.id,
      category: { id: r.categoryId, kind: r.categoryKind!, title: r.categoryTitle, slug: r.categorySlug },
      book,
      number: r.number,
      title: r.title || null,
      description: r.description,
      status: r.status,
      everPublished: r.publishedAt !== null,
      label: testLabel({
        categoryTitle: r.categoryTitle,
        bookTitle: book?.title ?? null,
        number: r.number,
        title: r.title || null,
      }),
      parts,
      available: availableParts(parts),
      problems: publishProblems(parts),
      metadata: r.metadata,
    };
  });
}

/** Library order: category order; Cambridge newest book first; tests by number. */
function sortTests(tests: TestView[], categoryOrder: Map<string, number>): TestView[] {
  return [...tests].sort(
    (a, b) =>
      (categoryOrder.get(a.category.id) ?? 0) - (categoryOrder.get(b.category.id) ?? 0) ||
      (b.book?.number ?? -1) - (a.book?.number ?? -1) ||
      (a.book ? (a.number ?? 0) - (b.number ?? 0) : (b.number ?? 0) - (a.number ?? 0)) ||
      a.label.localeCompare(b.label),
  );
}

async function categoryOrder(db: Db) {
  return new Map((await listCategories(db)).map((c) => [c.id, c.displayOrder]));
}

/**
 * Published tests offering a part, optionally in one category (step3.md §2.1, §5.2).
 * Only tests whose part is complete are listed; cue cards never appear here.
 */
export async function listTestsForPart(db: Db, opts: { mode: ExamMode; categoryId?: string }): Promise<TestView[]> {
  const tests = await loadTests(
    db,
    and(eq(exams.status, "published"), opts.categoryId ? eq(exams.moduleId, opts.categoryId) : undefined),
  );
  return sortTests(
    tests.filter((t) => t.available.includes(opts.mode)),
    await categoryOrder(db),
  );
}

/** How many published tests offer each part, per category (for the part tiles). */
export async function partCounts(db: Db, categoryId: string): Promise<Record<ExamMode, number>> {
  const tests = await loadTests(db, and(eq(exams.status, "published"), eq(exams.moduleId, categoryId)));
  const out: Record<ExamMode, number> = { part1: 0, part2: 0, part3: 0, full: 0 };
  for (const t of tests) for (const m of t.available) out[m]++;
  return out;
}

/** One test (published only, unless preview). Old JSON ids ("set-01") still resolve. */
export async function getTest(db: Db, id: string, v: Visibility = {}): Promise<TestView | null> {
  const byId = UUID_RE.test(id) ? eq(exams.id, id) : sql`${exams.metadata} ->> 'legacySetId' = ${id}`;
  const [t] = await loadTests(db, and(byId, v.preview ? undefined : eq(exams.status, "published")));
  return t ?? null;
}

/** All tests for the admin list, with filters. */
export async function listTestsAdmin(
  db: Db,
  f: { categoryId?: string; mode?: ExamMode; status?: ContentStatus; q?: string } = {},
): Promise<TestView[]> {
  const q = f.q?.trim().toLowerCase();
  const tests = await loadTests(
    db,
    and(f.categoryId ? eq(exams.moduleId, f.categoryId) : undefined, f.status ? eq(exams.status, f.status) : undefined),
  );
  return sortTests(
    tests.filter(
      (t) =>
        (!f.mode || partIncluded(t, f.mode)) &&
        (!q || t.label.toLowerCase().includes(q) || (t.title ?? "").toLowerCase().includes(q)),
    ),
    await categoryOrder(db),
  );
}

export function partIncluded(t: TestView, mode: ExamMode): boolean {
  return mode === "full" ? Boolean(t.parts.full) : Boolean(t.parts[mode]);
}

/** Attempts recorded on a test (blocks deleting it). */
export async function testAttemptCount(db: Db, testId: string): Promise<number> {
  const [r] = await db.select({ n: count() }).from(examAttempts).where(eq(examAttempts.examId, testId));
  return r.n;
}

/** Published tests with their parts, for GET /api/question-sets and quick starts. */
export async function liveTestsSummary(db: Db) {
  const tests = sortTests(await loadTests(db, eq(exams.status, "published")), await categoryOrder(db));
  return tests
    .filter((t) => t.available.length > 0)
    .map((t) => ({
      id: t.id,
      title: t.label,
      description: t.title ?? "",
      group: t.category.title,
      modes: t.available,
    }));
}

export interface AttemptContent {
  set: QuestionSet;
  /** An admin trying unpublished content. */
  preview: boolean;
}

/**
 * Content for a new test attempt. Without a test id, the first published test
 * offering the part is used (quick starts and scripts).
 */
export async function loadTestForAttempt(
  db: Db,
  input: { testId?: string | null; mode: ExamMode; canPreview: boolean },
): Promise<AttemptContent> {
  let test: TestView | null;
  if (input.testId) {
    test = await getTest(db, input.testId, { preview: input.canPreview });
    if (!test) throw new NotAvailableError("This test was not found.");
  } else {
    test = (await listTestsForPart(db, { mode: input.mode }))[0] ?? null;
    if (!test) throw new NotAvailableError(`No published test offers ${PART_LABEL[input.mode]} yet.`);
  }
  if (!test.available.includes(input.mode)) {
    throw new NotAvailableError(`${test.label} does not offer ${PART_LABEL[input.mode]}.`);
  }
  const source = test.metadata.source;
  return {
    set: {
      id: test.id,
      title: test.label,
      description: test.title ?? "",
      source: typeof source === "string" ? source : "",
      content: contentForTest(test.parts, input.mode),
    },
    preview: test.status !== "published",
  };
}

// --------------------------------------------------------------------- books

export interface BookRow {
  id: string;
  title: string;
  number: number | null;
  testCount: number;
}

/** Books of a category (Cambridge), newest number first. */
export async function listBooks(db: Db, categoryId: string): Promise<BookRow[]> {
  return db
    .select({
      id: collections.id,
      title: collections.title,
      number: collections.sortNumber,
      testCount: sql<number>`(SELECT count(*)::int FROM exams e WHERE e.collection_id = collections.id AND e.deleted_at IS NULL)`,
    })
    .from(collections)
    .where(and(eq(collections.moduleId, categoryId), isNull(collections.deletedAt), ne(collections.status, "archived")))
    .orderBy(sql`${collections.sortNumber} DESC NULLS LAST`, asc(collections.title));
}

// ----------------------------------------------------------------- cue cards

export interface CueTopicRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  position: number;
  cardCount: number;
}

export async function listCueTopics(db: Db, v: Visibility = {}): Promise<CueTopicRow[]> {
  const vis = v.preview ? sql`TRUE` : sql`c.status = 'published'`;
  const rows = await db
    .select({
      id: cueCardTopics.id,
      slug: cueCardTopics.slug,
      title: cueCardTopics.title,
      description: cueCardTopics.description,
      position: cueCardTopics.position,
      cardCount: sql<number>`(SELECT count(*)::int FROM cue_cards c WHERE c.topic_id = cue_card_topics.id AND ${vis})`,
    })
    .from(cueCardTopics)
    .orderBy(asc(cueCardTopics.position), asc(cueCardTopics.title));
  // Students only see topics that have something to practice.
  return v.preview ? rows : rows.filter((r) => r.cardCount > 0);
}

export async function getCueTopic(db: Db, by: { slug: string } | { id: string }) {
  if ("id" in by && !UUID_RE.test(by.id)) return null;
  const [t] = await db
    .select()
    .from(cueCardTopics)
    .where("id" in by ? eq(cueCardTopics.id, by.id) : eq(cueCardTopics.slug, by.slug));
  return t ?? null;
}

export interface CueCardRow {
  id: string;
  topicId: string;
  topicTitle: string;
  topicSlug: string;
  slug: string;
  prompt: string;
  bullets: string[];
  explain: string;
  spokenPrompt: string;
  roundOff: { id: string; text: string }[];
  engineKey: string;
  status: ContentStatus;
  position: number;
}

const cardCols = {
  id: cueCards.id,
  topicId: cueCards.topicId,
  topicTitle: cueCardTopics.title,
  topicSlug: cueCardTopics.slug,
  slug: cueCards.slug,
  prompt: cueCards.prompt,
  bullets: cueCards.bullets,
  explain: cueCards.explain,
  spokenPrompt: cueCards.spokenPrompt,
  roundOff: cueCards.roundOff,
  engineKey: cueCards.engineKey,
  status: cueCards.status,
  position: cueCards.position,
};

/** Cue cards of a topic (or all), with search in SQL and offset pages. */
export async function listCueCards(
  db: Db,
  opts: Visibility & { topicId?: string; q?: string | null; limit?: number; offset?: number },
): Promise<{ items: CueCardRow[]; total: number; hasMore: boolean }> {
  const limit = Math.min(Math.max(opts.limit ?? 24, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const q = opts.q?.trim().replace(/[%_\\]/g, (m) => `\\${m}`);
  const where = and(
    opts.topicId ? eq(cueCards.topicId, opts.topicId) : undefined,
    opts.preview ? undefined : eq(cueCards.status, "published"),
    q ? or(ilike(cueCards.prompt, `%${q}%`), ilike(cueCardTopics.title, `%${q}%`)) : undefined,
  );
  const [items, [{ total }]] = await Promise.all([
    db
      .select(cardCols)
      .from(cueCards)
      .innerJoin(cueCardTopics, eq(cueCardTopics.id, cueCards.topicId))
      .where(where)
      .orderBy(asc(cueCardTopics.position), asc(cueCards.position), asc(cueCards.id))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(cueCards)
      .innerJoin(cueCardTopics, eq(cueCardTopics.id, cueCards.topicId))
      .where(where),
  ]);
  return { items, total, hasMore: offset + items.length < total };
}

export async function getCueCard(db: Db, id: string, v: Visibility = {}): Promise<CueCardRow | null> {
  if (!UUID_RE.test(id)) return null;
  const [c] = await db
    .select(cardCols)
    .from(cueCards)
    .innerJoin(cueCardTopics, eq(cueCardTopics.id, cueCards.topicId))
    .where(and(eq(cueCards.id, id), v.preview ? undefined : eq(cueCards.status, "published")));
  return c ?? null;
}

/** A cue card row as engine card data. */
export function cardDataOf(
  c: Pick<CueCardRow, "engineKey" | "prompt" | "bullets" | "explain" | "spokenPrompt" | "roundOff">,
): CardData {
  return cardShape.parse({
    id: c.engineKey,
    prompt: c.prompt,
    bullets: c.bullets,
    explain: c.explain,
    spokenPrompt: c.spokenPrompt,
    roundOff: c.roundOff,
    part3Intro: "",
    part3OnlyIntro: "",
  });
}

export async function loadCueCardForAttempt(
  db: Db,
  input: { cardId: string; canPreview: boolean },
): Promise<AttemptContent> {
  const c = await getCueCard(db, input.cardId, { preview: input.canPreview });
  if (!c) throw new NotAvailableError("This cue card was not found.");
  return {
    set: {
      id: c.id,
      title: `Makkar Cue Cards · ${c.topicTitle}: ${c.prompt}`,
      description: c.prompt,
      source: "",
      content: cueCardContent(cardDataOf(c)),
    },
    preview: c.status !== "published",
  };
}

// ------------------------------------------------------------ question bank

export interface BankRow {
  /** "test" rows open the test editor; "card" rows open the Makkar card editor. */
  source: "test" | "card";
  id: string;
  part: 1 | 2 | 3;
  text: string;
  kind: string | null;
  status: ContentStatus;
  topic: string | null;
  categoryTitle: string;
  /** Test id (test rows) or cue card id (card rows). */
  ownerId: string;
  ownerLabel: string;
  ownerStatus: ContentStatus;
}

export interface BankFilter {
  q?: string | null;
  part?: 1 | 2 | 3;
  categoryId?: string;
  status?: ContentStatus;
  kind?: string;
  limit?: number;
}

/**
 * Every question across the four libraries (admin search): Part 1 and Part 3
 * questions and Part 2 cards of tests, plus Makkar cue cards. Newest tests last,
 * in exam order inside a test.
 */
export async function searchQuestionBank(db: Db, f: BankFilter): Promise<{ rows: BankRow[]; more: boolean }> {
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 300);
  const q = f.q?.trim().replace(/[%_\\]/g, (m) => `\\${m}`);
  const kindSql = sql<string | null>`${questions.content}->'question'->>'kind'`;
  const sectionKind = f.part ? (`part_${f.part}` as const) : undefined;
  const cats = await listCategories(db);
  const cat = cats.find((c) => c.id === f.categoryId);

  const testWhere = and(
    isNull(questions.deletedAt),
    isNull(exams.deletedAt),
    sectionKind ? eq(examSections.kind, sectionKind) : ne(examSections.kind, "full_test"),
    f.categoryId ? eq(exams.moduleId, f.categoryId) : undefined,
    f.status ? eq(questions.status, f.status) : undefined,
    f.kind ? sql`${kindSql} = ${f.kind}` : undefined,
    q
      ? or(
          ilike(questions.prompt, `%${q}%`),
          ilike(questionGroups.title, `%${q}%`),
          sql`${questions.content}::text ILIKE ${`%${q}%`}`,
        )
      : undefined,
  );
  const testRows = await db
    .select({
      id: questions.id,
      sectionKind: examSections.kind,
      text: questions.prompt,
      kind: kindSql,
      status: questions.status,
      topic: questionGroups.title,
      categoryTitle: modules.title,
      ownerId: exams.id,
      testNumber: exams.examNumber,
      testTitle: exams.title,
      bookTitle: collections.title,
      ownerStatus: exams.status,
    })
    .from(examQuestions)
    .innerJoin(questions, eq(questions.id, examQuestions.questionId))
    .innerJoin(examSections, eq(examSections.id, examQuestions.sectionId))
    .innerJoin(exams, eq(exams.id, examQuestions.examId))
    .innerJoin(modules, eq(modules.id, exams.moduleId))
    .leftJoin(collections, eq(collections.id, exams.collectionId))
    .leftJoin(questionGroups, eq(questionGroups.id, examQuestions.groupId))
    .where(testWhere)
    .orderBy(
      asc(modules.displayOrder),
      asc(collections.sortNumber),
      asc(exams.examNumber),
      asc(examSections.displayOrder),
      asc(questionGroups.position),
      asc(examQuestions.position),
    )
    .limit(limit + 1);

  const wantCards = (!f.part || f.part === 2) && !f.kind && (!f.categoryId || cat?.kind === "cue_cards");
  const cardRows = wantCards
    ? await db
        .select(cardCols)
        .from(cueCards)
        .innerJoin(cueCardTopics, eq(cueCardTopics.id, cueCards.topicId))
        .where(
          and(
            f.status ? eq(cueCards.status, f.status) : undefined,
            q
              ? or(
                  ilike(cueCards.prompt, `%${q}%`),
                  ilike(cueCardTopics.title, `%${q}%`),
                  sql`${cueCards.bullets}::text ILIKE ${`%${q}%`}`,
                )
              : undefined,
          ),
        )
        .orderBy(asc(cueCardTopics.position), asc(cueCards.position))
        .limit(limit + 1)
    : [];
  const cueTitle = cats.find((c) => c.kind === "cue_cards")?.title ?? "Cue cards";

  const all: BankRow[] = [
    ...testRows.map((r) => {
      const label = testLabel({
        categoryTitle: r.categoryTitle,
        bookTitle: r.bookTitle,
        number: r.testNumber,
        title: r.testTitle,
      });
      return {
        source: "test" as const,
        id: r.id,
        part: Number(r.sectionKind.slice(-1)) as 1 | 2 | 3,
        text: r.text ?? "",
        kind: r.kind,
        status: r.status as ContentStatus,
        topic: r.topic,
        categoryTitle: r.categoryTitle,
        ownerId: r.ownerId,
        ownerLabel: label,
        ownerStatus: r.ownerStatus as ContentStatus,
      };
    }),
    ...cardRows.map((c) => ({
      source: "card" as const,
      id: c.id,
      part: 2 as const,
      text: c.prompt,
      kind: null,
      status: c.status,
      topic: c.topicTitle,
      categoryTitle: cueTitle,
      ownerId: c.id,
      ownerLabel: `${cueTitle}: ${c.topicTitle}`,
      ownerStatus: c.status,
    })),
  ];
  return { rows: all.slice(0, limit), more: all.length > limit };
}
