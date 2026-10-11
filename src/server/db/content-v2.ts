/**
 * One-time, repeatable data migration from the v0.5 content shape to content v2
 * (step3-redesign-plan.md §6.2). Runs in ONE transaction; `dryRun` rolls back
 * and only reports. A second run changes nothing. Nothing is deleted:
 * replaced rows are archived, and old attempts keep pointing at them.
 *
 *   1. categories get their `kind` ("Test Exam" → "Practice Test Exam")
 *   2. Part 1/3 topics stored inside question payloads → question_groups rows
 *   3. full-test sections get an explicit `sequence`
 *   4. Practice Test Exam / Recent Real tests leave their one-test collections
 *      and get a test number; Cambridge tests get a number from their title
 *   5. Makkar "exams" → cue_cards (old exams archived with metadata.migratedTo)
 *   6. hidden default collections archived
 */
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { usesBooks } from "@/content/categories";
import type { Db } from "./client";
import { part1Payload, part3Payload, speakingPayload } from "./content";
import {
  collections,
  cueCards,
  cueCardTopics,
  examQuestions,
  exams,
  examSections,
  modules,
  questionGroups,
  questions,
} from "./schema";
import { ensureCategories, seedCueTopics } from "./seed";

export interface ContentV2Report {
  categoriesUpgraded: number;
  groupsCreated: number;
  questionsLinked: number;
  questionsWithoutTopic: number;
  fullTestsSequenced: number;
  fullTestsIncomplete: number;
  testsNumbered: number;
  testsMovedOutOfCollections: number;
  collectionsArchived: number;
  cueCardsCreated: number;
  oldCueExamsArchived: number;
  needsReview: string[];
}

class DryRun extends Error {}

export async function migrateContentV2(
  db: Db,
  { dryRun = false, log = () => undefined }: { dryRun?: boolean; log?: (m: string) => void } = {},
): Promise<ContentV2Report> {
  const r: ContentV2Report = {
    categoriesUpgraded: 0,
    groupsCreated: 0,
    questionsLinked: 0,
    questionsWithoutTopic: 0,
    fullTestsSequenced: 0,
    fullTestsIncomplete: 0,
    testsNumbered: 0,
    testsMovedOutOfCollections: 0,
    collectionsArchived: 0,
    cueCardsCreated: 0,
    oldCueExamsArchived: 0,
    needsReview: [],
  };
  try {
    await db.transaction(async (tx) => {
      // 1. Categories
      const before = await tx
        .select({ id: modules.id })
        .from(modules)
        .where(sql`${modules.kind} IS NOT NULL`);
      const cats = await ensureCategories(tx);
      r.categoriesUpgraded = cats.size - before.length;
      const topics = await seedCueTopics(tx);

      // 2. Topics → question_groups
      const sections = await tx
        .select({
          id: examSections.id,
          examId: examSections.examId,
          kind: examSections.kind,
          config: examSections.config,
        })
        .from(examSections)
        .where(isNull(examSections.deletedAt));
      for (const s of sections.filter((x) => x.kind === "part_1" || x.kind === "part_3")) {
        const rows = await tx
          .select({ eqId: examQuestions.id, groupId: examQuestions.groupId, content: questions.content })
          .from(examQuestions)
          .innerJoin(questions, eq(questions.id, examQuestions.questionId))
          .where(eq(examQuestions.sectionId, s.id))
          .orderBy(asc(examQuestions.position));
        const pending = rows.filter((x) => !x.groupId);
        if (pending.length === 0) continue;
        const existing = await tx.select().from(questionGroups).where(eq(questionGroups.sectionId, s.id));
        const byKey = new Map(existing.map((g) => [g.engineKey, g.id]));
        let pos = existing.reduce((m, g) => Math.max(m, g.position), 0);
        for (const q of pending) {
          const parsed = s.kind === "part_1" ? part1Payload.safeParse(q.content) : part3Payload.safeParse(q.content);
          const topic = parsed.success ? ("topic" in parsed.data ? parsed.data.topic : parsed.data.subtopic) : null;
          if (!topic) {
            r.questionsWithoutTopic++;
            r.needsReview.push(`Question ${q.eqId} in ${s.kind} has no topic; it is hidden until assigned.`);
            continue;
          }
          let gid = byKey.get(topic.id);
          if (!gid) {
            const [g] = await tx
              .insert(questionGroups)
              .values({
                sectionId: s.id,
                kind: s.kind === "part_1" ? "part1_topic" : "part3_topic",
                title: topic.title,
                intro: topic.intro,
                isCore: Boolean((topic as { isCore?: boolean }).isCore),
                engineKey: topic.id,
                position: ++pos,
              })
              .returning({ id: questionGroups.id });
            gid = g.id;
            byKey.set(topic.id, gid);
            r.groupsCreated++;
          }
          await tx.update(examQuestions).set({ groupId: gid }).where(eq(examQuestions.id, q.eqId));
          r.questionsLinked++;
        }
      }

      // 3. Explicit full-test sequence
      for (const s of sections.filter((x) => x.kind === "full_test")) {
        if (Array.isArray(s.config.sequence)) continue;
        const sib = sections.filter((x) => x.examId === s.examId);
        const seq = (["part_1", "part_2", "part_3"] as const).map((k) => sib.find((x) => x.kind === k)?.id);
        if (seq.every(Boolean)) {
          await tx
            .update(examSections)
            .set({ config: { ...s.config, sequence: seq } })
            .where(eq(examSections.id, s.id));
          r.fullTestsSequenced++;
        } else {
          await tx
            .update(examSections)
            .set({ config: { ...s.config, sequence: [] } })
            .where(eq(examSections.id, s.id));
          r.fullTestsIncomplete++;
          r.needsReview.push(`Test ${s.examId}: full test without all three parts; it stays unavailable.`);
        }
      }

      // 4. Test numbers; tests without books leave their one-test collections
      for (const [kind, categoryId] of cats) {
        if (kind === "cue_cards") continue;
        const tests = await tx
          .select({
            id: exams.id,
            title: exams.title,
            number: exams.examNumber,
            collectionId: exams.collectionId,
            bookNumber: collections.sortNumber,
          })
          .from(exams)
          .leftJoin(collections, eq(collections.id, exams.collectionId))
          .where(and(eq(exams.moduleId, categoryId), isNull(exams.deletedAt)))
          .orderBy(asc(exams.createdAt));
        const keepBook = usesBooks(kind);
        const groupOf = (t: (typeof tests)[number]) => (keepBook ? (t.collectionId ?? "") : "");
        const used = new Map<string, Set<number>>();
        for (const t of tests) {
          if (t.number !== null && (keepBook || !t.collectionId)) {
            used.set(groupOf(t), (used.get(groupOf(t)) ?? new Set()).add(t.number));
          }
        }
        for (const t of tests) {
          const movesOut = !keepBook && t.collectionId !== null;
          if (t.number !== null && !movesOut) continue;
          const g = keepBook ? (t.collectionId ?? "") : "";
          const taken = used.get(g) ?? new Set<number>();
          const wanted = t.number ?? (keepBook ? null : t.bookNumber) ?? Number(/(\d+)/.exec(t.title)?.[1] ?? NaN);
          let n = Number.isFinite(wanted) && wanted !== null && !taken.has(wanted) ? wanted : 1;
          while (taken.has(n)) n++;
          taken.add(n);
          used.set(g, taken);
          await tx
            .update(exams)
            .set({ examNumber: n, ...(movesOut ? { collectionId: null } : {}) })
            .where(eq(exams.id, t.id));
          r.testsNumbered++;
          if (movesOut) r.testsMovedOutOfCollections++;
        }
        if (!keepBook) {
          const archived = await tx
            .update(collections)
            .set({ status: "archived" })
            .where(
              and(
                eq(collections.moduleId, categoryId),
                ne(collections.status, "archived"),
                sql`NOT EXISTS (SELECT 1 FROM exams e WHERE e.collection_id = ${collections.id})`,
              ),
            )
            .returning({ id: collections.id });
          r.collectionsArchived += archived.length;
        }
      }

      // 5. Makkar "exams" → cue cards
      const cueCat = cats.get("cue_cards")!;
      const oldCue = await tx
        .select({ id: exams.id, title: exams.title, status: exams.status, metadata: exams.metadata })
        .from(exams)
        .where(and(eq(exams.moduleId, cueCat), isNull(exams.deletedAt)));
      for (const e of oldCue.filter((x) => !x.metadata.migratedTo)) {
        const [q] = await tx
          .select({ content: questions.content })
          .from(examQuestions)
          .innerJoin(questions, eq(questions.id, examQuestions.questionId))
          .innerJoin(examSections, eq(examSections.id, examQuestions.sectionId))
          .where(and(eq(examQuestions.examId, e.id), eq(examSections.kind, "part_2")));
        const p = q ? speakingPayload.safeParse(q.content) : null;
        if (!p?.success || p.data.part !== 2) {
          r.needsReview.push(`Cue-card exam “${e.title}” has no card; archived without a copy.`);
          await tx
            .update(exams)
            .set({ status: "archived", metadata: { ...e.metadata, migratedTo: null } })
            .where(eq(exams.id, e.id));
          r.oldCueExamsArchived++;
          continue;
        }
        const card = p.data.card;
        let topicId = e.metadata.sample ? topics.get("experiences") : undefined;
        if (!topicId) {
          await tx
            .insert(cueCardTopics)
            .values({
              slug: "uncategorised",
              title: "Uncategorised",
              description: "Cards moved from the old layout. Move each one to its topic.",
              position: 99,
            })
            .onConflictDoNothing();
          const [u] = await tx
            .select({ id: cueCardTopics.id })
            .from(cueCardTopics)
            .where(eq(cueCardTopics.slug, "uncategorised"));
          topicId = u.id;
          r.needsReview.push(`Cue card “${card.prompt}” is in “Uncategorised”: move it to its topic.`);
        }
        const [existingCard] = await tx
          .select({ id: cueCards.id })
          .from(cueCards)
          .where(eq(cueCards.engineKey, card.id));
        let cardId = existingCard?.id;
        if (!cardId) {
          const [{ n }] = await tx
            .select({ n: sql<number>`coalesce(max(${cueCards.position}), 0)::int` })
            .from(cueCards)
            .where(eq(cueCards.topicId, topicId));
          const base =
            card.prompt
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, "")
              .slice(0, 60) || "card";
          const [row] = await tx
            .insert(cueCards)
            .values({
              topicId,
              slug: `${base}-${e.id.slice(-4)}`,
              prompt: card.prompt,
              bullets: card.bullets,
              explain: card.explain,
              spokenPrompt: card.spokenPrompt,
              roundOff: card.roundOff,
              engineKey: card.id,
              status: e.status === "published" ? "published" : "draft",
              position: n + 1,
              metadata: { migratedFrom: e.id, ...(e.metadata.sample ? { sample: true } : {}) },
            })
            .returning({ id: cueCards.id });
          cardId = row.id;
          r.cueCardsCreated++;
        }
        await tx
          .update(exams)
          .set({ status: "archived", metadata: { ...e.metadata, migratedTo: cardId } })
          .where(eq(exams.id, e.id));
        r.oldCueExamsArchived++;
      }

      // 6. Hidden default collections
      const defaults = await tx
        .update(collections)
        .set({ status: "archived" })
        .where(and(sql`${collections.metadata} ->> 'default' = 'true'`, ne(collections.status, "archived")))
        .returning({ id: collections.id });
      r.collectionsArchived += defaults.length;

      // Sanity: every published test question in Part 1/3 now has a topic.
      const loose = await tx
        .select({ id: examQuestions.id })
        .from(examQuestions)
        .innerJoin(examSections, eq(examSections.id, examQuestions.sectionId))
        .where(and(isNull(examQuestions.groupId), inArray(examSections.kind, ["part_1", "part_3"])));
      if (loose.length !== r.questionsWithoutTopic && r.questionsWithoutTopic === 0 && loose.length > 0) {
        r.needsReview.push(`${loose.length} Part 1/3 questions still have no topic.`);
      }

      for (const [k, v] of Object.entries(r)) if (k !== "needsReview") log(`${k}: ${v}`);
      for (const n of r.needsReview) log(`review: ${n}`);
      if (dryRun) throw new DryRun();
    });
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }
  return r;
}
