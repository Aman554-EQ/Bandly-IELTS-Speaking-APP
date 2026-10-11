/**
 * Idempotent seed data (safe to run any number of times), content v2:
 * the four fixed categories (found or upgraded by kind), Cambridge books
 * 10–21, the sample test (Practice Test Exam, Test 1) built with real topic
 * rows, the cue card topics and (development only) one sample cue card.
 * Used by `pnpm db:seed`, `pnpm db:content-v2`, `pnpm db:import-json` and tests.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { CATEGORY_DEFAULTS, CATEGORY_KINDS, type CategoryKind, DEFAULT_CUE_TOPICS } from "@/content/categories";
import type { ExamContent } from "@/engine/types";
import { p1QuestionPayload, p2CardPayload, p3QuestionPayload } from "./assemble";
import type { Db } from "./client";
import type { SectionKind } from "./content";
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
  results,
  roles,
  userRoles,
  users,
} from "./schema";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Conn = Db | Tx;

export const ROLES = [
  {
    key: "superadmin",
    name: "Superadmin",
    description: "Platform administrator: users, roles, analytics, audit log.",
    rank: 100,
  },
  { key: "admin", name: "Admin", description: "Content manager: tests, topics, questions, cue cards.", rank: 50 },
  { key: "student", name: "Student", description: "Learner: takes tests and sees their own results.", rank: 10 },
] as const;

export const CAMBRIDGE_BOOKS = Array.from({ length: 12 }, (_, i) => 10 + i); // 10 … 21

/**
 * Owner of attempts made before sign-in existed and of sessions imported from
 * the old JSON store. `pnpm db:claim-guest <email>` moves them to a real account.
 */
export const LOCAL_USER = { clerkUserId: "local:guest", email: "guest@bandly.local", displayName: "Local guest" };

/** The built-in question set (src/content/sample-set.ts): Practice Test Exam, Test 1. */
export const SAMPLE_EXAM = {
  category: "practice_test" as CategoryKind,
  number: 1,
  slug: "set-01",
  title: "Walking · A film to see again · Theatre and acting",
  description:
    "Part 1: work or studies, walking. Part 2: a play or film you would like to see again with friends. Part 3: theatre culture, being an actor.",
  source: "Cambridge-style practice set (supplied by the project owner)",
};

export async function seedRoles(db: Conn): Promise<void> {
  await db
    .insert(roles)
    .values(ROLES.map((r) => ({ ...r })))
    .onConflictDoUpdate({
      target: roles.key,
      set: { name: sql`excluded.name`, description: sql`excluded.description`, rank: sql`excluded.rank` },
    });
}

/**
 * The four categories. A row is matched by `kind`, else by its default or old
 * slug (pre-v2 databases), and upgraded in place: kind set, "Test Exam" renamed
 * to "Practice Test Exam", the old slug kept for redirects. Admin-edited titles
 * are left alone.
 */
export async function ensureCategories(db: Conn): Promise<Map<CategoryKind, string>> {
  const out = new Map<CategoryKind, string>();
  for (const [i, kind] of CATEGORY_KINDS.entries()) {
    const d = CATEGORY_DEFAULTS[kind];
    const [byKind] = await db.select().from(modules).where(eq(modules.kind, kind));
    if (byKind) {
      out.set(kind, byKind.id);
      continue;
    }
    const slugs = [d.slug, ...d.legacySlugs];
    const [old] = await db
      .select()
      .from(modules)
      .where(
        sql`${modules.slug} IN (${sql.join(
          slugs.map((s) => sql`${s}`),
          sql`, `,
        )})`,
      );
    if (old) {
      const oldSlugs = [
        ...new Set([...((old.config.oldSlugs as string[]) ?? []), ...(old.slug !== d.slug ? [old.slug] : [])]),
      ];
      await db
        .update(modules)
        .set({
          kind,
          slug: d.slug,
          title: d.legacyTitles.includes(old.title) ? d.title : old.title,
          description: old.description ?? d.description,
          status: "published",
          config: { ...old.config, oldSlugs },
        })
        .where(eq(modules.id, old.id));
      out.set(kind, old.id);
      continue;
    }
    const [m] = await db
      .insert(modules)
      .values({
        kind,
        slug: d.slug,
        title: d.title,
        description: d.description,
        navigationMode: kind === "cue_cards" ? "direct_exam_list" : "collection_list",
        displayOrder: i + 1,
        status: "published",
      })
      .returning({ id: modules.id });
    out.set(kind, m.id);
  }
  return out;
}

export async function seedCambridgeBooks(db: Conn, categoryId: string): Promise<void> {
  await db
    .insert(collections)
    .values(
      CAMBRIDGE_BOOKS.map((n) => ({
        moduleId: categoryId,
        slug: `cambridge-${n}`,
        title: `Cambridge ${n}`,
        sortNumber: n,
        status: "published" as const,
      })),
    )
    .onConflictDoNothing({ target: [collections.moduleId, collections.slug] });
}

/** Creates (or finds) the local user with the student role. Returns its id. */
export async function ensureLocalUser(db: Conn): Promise<string> {
  await db.insert(users).values(LOCAL_USER).onConflictDoNothing({ target: users.clerkUserId });
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.clerkUserId, LOCAL_USER.clerkUserId));
  const [student] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, "student"));
  if (student) await db.insert(userRoles).values({ userId: u.id, roleId: student.id }).onConflictDoNothing();
  return u.id;
}

const SECTION_TITLE: Record<SectionKind, string> = {
  part_1: "Part 1: Introduction and interview",
  part_2: "Part 2: Long turn",
  part_3: "Part 3: Discussion",
  full_test: "Full test",
};

/**
 * Creates a test from engine content in one transaction: one section per part,
 * Part 1/3 topics as question_groups (their ids become engine keys, so existing
 * audio clips still match), and the explicit full-test sequence. If a test with
 * the same slug already exists in the category it is returned untouched.
 */
export async function upsertExamFromContent(
  db: Db,
  input: {
    moduleId: string;
    collectionId: string | null;
    number?: number | null;
    slug: string;
    title: string;
    description: string;
    metadata?: Record<string, unknown>;
    content: ExamContent;
    /** Parts to create (default: all four). */
    kinds?: SectionKind[];
    status?: "draft" | "published";
  },
): Promise<{ examId: string; created: boolean }> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: exams.id })
      .from(exams)
      .where(and(eq(exams.moduleId, input.moduleId), eq(exams.slug, input.slug), isNull(exams.deletedAt)));
    if (existing) return { examId: existing.id, created: false };

    const status = input.status ?? "published";
    const [exam] = await tx
      .insert(exams)
      .values({
        moduleId: input.moduleId,
        collectionId: input.collectionId,
        examNumber: input.number ?? null,
        slug: input.slug,
        title: input.title,
        description: input.description,
        status,
        publishedAt: status === "published" ? new Date() : null,
        metadata: input.metadata ?? {},
      })
      .returning({ id: exams.id });

    const kinds = input.kinds ?? (["part_1", "part_2", "part_3", "full_test"] as SectionKind[]);
    const sectionIds: Partial<Record<SectionKind, string>> = {};
    for (const kind of kinds.filter((k) => k !== "full_test")) {
      const [s] = await tx
        .insert(examSections)
        .values({
          examId: exam.id,
          kind,
          title: SECTION_TITLE[kind],
          displayOrder: kinds.indexOf(kind) + 1,
          status: "published",
        })
        .returning({ id: examSections.id });
      sectionIds[kind] = s.id;
    }
    let position = 0;
    const addQuestion = async (
      sectionId: string,
      groupId: string | null,
      row: { type: "speaking_prompt" | "cue_card"; title: string; prompt: string; content: Record<string, unknown> },
    ) => {
      const [q] = await tx
        .insert(questions)
        .values({ ...row, status: "published" })
        .returning({ id: questions.id });
      await tx
        .insert(examQuestions)
        .values({ examId: exam.id, sectionId, groupId, questionId: q.id, position: ++position });
    };

    if (sectionIds.part_1) {
      for (const [i, t] of input.content.part1.entries()) {
        const [g] = await tx
          .insert(questionGroups)
          .values({
            sectionId: sectionIds.part_1,
            kind: "part1_topic",
            title: t.title,
            intro: t.intro,
            isCore: Boolean(t.isCore),
            engineKey: t.id,
            position: i + 1,
          })
          .returning({ id: questionGroups.id });
        for (const q of t.questions) {
          await addQuestion(sectionIds.part_1, g.id, {
            type: "speaking_prompt",
            title: t.title,
            prompt: q.text,
            content: p1QuestionPayload.parse({ part: 1, engineId: q.id, question: q }),
          });
        }
      }
    }
    if (sectionIds.part_2) {
      const { part3: _p3, ...card } = input.content.cueCard;
      await addQuestion(sectionIds.part_2, null, {
        type: "cue_card",
        title: card.prompt,
        prompt: card.prompt,
        content: p2CardPayload.parse({ part: 2, engineId: card.id, card }),
      });
    }
    if (sectionIds.part_3) {
      for (const [i, sub] of input.content.cueCard.part3.entries()) {
        const [g] = await tx
          .insert(questionGroups)
          .values({
            sectionId: sectionIds.part_3,
            kind: "part3_topic",
            title: sub.title,
            intro: sub.intro,
            engineKey: sub.id,
            position: i + 1,
          })
          .returning({ id: questionGroups.id });
        for (const q of sub.questions) {
          await addQuestion(sectionIds.part_3, g.id, {
            type: "speaking_prompt",
            title: sub.title,
            prompt: q.text,
            content: p3QuestionPayload.parse({ part: 3, engineId: q.id, question: q }),
          });
        }
      }
    }
    if (kinds.includes("full_test") && sectionIds.part_1 && sectionIds.part_2 && sectionIds.part_3) {
      await tx.insert(examSections).values({
        examId: exam.id,
        kind: "full_test",
        title: SECTION_TITLE.full_test,
        displayOrder: 4,
        status: "published",
        config: { sequence: [sectionIds.part_1, sectionIds.part_2, sectionIds.part_3] },
      });
    }
    return { examId: exam.id, created: true };
  });
}

export async function seedSampleExam(db: Db, categories: Map<CategoryKind, string>, content: ExamContent) {
  return upsertExamFromContent(db, {
    moduleId: categories.get(SAMPLE_EXAM.category)!,
    collectionId: null,
    number: SAMPLE_EXAM.number,
    slug: SAMPLE_EXAM.slug,
    title: SAMPLE_EXAM.title,
    description: SAMPLE_EXAM.description,
    metadata: { legacySetId: SAMPLE_EXAM.slug, source: SAMPLE_EXAM.source },
    content,
  });
}

const topicSlug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** Default cue card topics (only added if missing; admins own them afterwards). */
export async function seedCueTopics(db: Conn): Promise<Map<string, string>> {
  const existing = await db.select().from(cueCardTopics);
  let pos = existing.reduce((m, t) => Math.max(m, t.position), 0);
  for (const title of DEFAULT_CUE_TOPICS) {
    if (existing.some((t) => t.slug === topicSlug(title))) continue;
    await db
      .insert(cueCardTopics)
      .values({ slug: topicSlug(title), title, position: ++pos })
      .onConflictDoNothing();
  }
  const rows = await db.select({ id: cueCardTopics.id, slug: cueCardTopics.slug }).from(cueCardTopics);
  return new Map(rows.map((r) => [r.slug, r.id]));
}

/** One sample cue card (development data, metadata.sample). Not seeded when NODE_ENV=production. */
export async function seedSampleCueCard(db: Conn, topicId: string, content: ExamContent) {
  const c = content.cueCard;
  const [found] = await db.select({ id: cueCards.id }).from(cueCards).where(eq(cueCards.engineKey, c.id));
  if (found) return found.id;
  const [row] = await db
    .insert(cueCards)
    .values({
      topicId,
      slug: "a-play-or-film-to-see-again",
      prompt: c.prompt,
      bullets: c.bullets,
      explain: c.explain,
      spokenPrompt: c.spokenPrompt,
      roundOff: c.roundOff,
      engineKey: c.id,
      status: "published",
      position: 1,
      metadata: { sample: true },
    })
    .returning({ id: cueCards.id });
  return row.id;
}

/** Everything `pnpm db:seed` does. */
export async function seedAll(db: Db, content: ExamContent, opts: { sample?: boolean } = {}) {
  await seedRoles(db);
  const categories = await ensureCategories(db);
  await seedCambridgeBooks(db, categories.get("cambridge")!);
  const topics = await seedCueTopics(db);
  if (opts.sample ?? process.env.NODE_ENV !== "production") {
    await seedSampleCueCard(db, topics.get("experiences")!, content);
  }
  const sample = await seedSampleExam(db, categories, content);
  const localUserId = await ensureLocalUser(db);
  const slugRows = await db.select({ id: modules.id, slug: modules.slug }).from(modules);
  return {
    categories,
    /** Category ids by slug (kept for older tests and scripts). */
    moduleIds: new Map(slugRows.map((r) => [r.slug, r.id])),
    topics,
    sampleExamId: sample.examId,
    sampleCreated: sample.created,
    localUserId,
  };
}

/** Moves the local guest's attempts and results to the (signed-in at least once) user with this email. */
export async function claimGuestAttempts(db: Db, email: string): Promise<{ attempts: number; results: number }> {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(sql`lower(${users.email}) = lower(${email})`, isNull(users.deletedAt)));
    if (!target) throw new Error(`No account with email ${email}. Sign in once with it, then run this again.`);
    const [guest] = await tx.select({ id: users.id }).from(users).where(eq(users.clerkUserId, LOCAL_USER.clerkUserId));
    if (!guest || guest.id === target.id) return { attempts: 0, results: 0 };
    // The guest's unfinished attempts could clash with the one-in-progress rule; they cannot be resumed anyway.
    await tx
      .update(examAttempts)
      .set({ status: "abandoned" })
      .where(and(eq(examAttempts.userId, guest.id), eq(examAttempts.status, "in_progress")));
    const a = await tx
      .update(examAttempts)
      .set({ userId: target.id })
      .where(eq(examAttempts.userId, guest.id))
      .returning({ id: examAttempts.id });
    const r = await tx
      .update(results)
      .set({ userId: target.id })
      .where(eq(results.userId, guest.id))
      .returning({ id: results.id });
    return { attempts: a.length, results: r.length };
  });
}
