/**
 * Database tests against a real PostgreSQL (the `bandly_test` database in the
 * local Docker container). Run with `pnpm test:db` after `pnpm db:up`.
 * The schema is dropped and re-migrated at the start, so never point
 * DATABASE_URL_TEST at a database you care about (its name must end in _test).
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SAMPLE_SET } from "@/content/sample-set";
import { closeDb, getDb, type Db } from "@/server/db/client";
import { importJsonStore } from "@/server/db/import-json";
import {
  attemptAnswers,
  collections,
  examAttempts,
  examQuestions,
  exams,
  examSections,
  feedback,
  modules,
  questions,
  results,
  roles,
} from "@/server/db/schema";
import { seedAll, upsertExamFromContent } from "@/server/db/seed";
import type { ExamSession, FinalReport, PartReport, TurnRecord } from "@/server/db/types";
import { loadEnv } from "../../scripts/lib/load-env";

loadEnv();
const TEST_URL = process.env.DATABASE_URL_TEST;
if (!TEST_URL) throw new Error("DATABASE_URL_TEST is missing (see .env.example).");
if (!/_test(\?|$)/.test(new URL(TEST_URL).pathname + "?")) {
  throw new Error("DATABASE_URL_TEST must point at a database whose name ends in _test.");
}
process.env.DATABASE_URL = TEST_URL; // repo.ts uses DATABASE_URL

// Imported after DATABASE_URL is set.
const repo = await import("@/server/db/repo");

let db: Db;
let sampleExamId: string;
let moduleIds: Map<string, string>;
let ownerId: string;

/** Postgres error code of a failed query (drizzle wraps the driver error in `cause`). */
async function pgCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } };
    return err.code ?? err.cause?.code;
  }
}

const rowsOf = async (table: PgTable) => (await db.select({ n: count() }).from(table))[0].n;

function take(n: number, over: Partial<TurnRecord> = {}): Omit<TurnRecord, "seq"> {
  return {
    takeId: `take-${n}`,
    part: 1,
    questionId: "work-study-1",
    question: "Do you work, or are you a student?",
    kind: "main",
    attempt: 1,
    outcome: "answered",
    speechMs: 4000,
    durationMs: 5000,
    firstSpeechLatencyMs: 600,
    scored: true,
    transcript: `answer ${n}`,
    features: null,
    analysis: { intent: "answer" } as unknown as TurnRecord["analysis"],
    sttModel: "whisper-large-v3-turbo",
    analysisModel: null,
    createdAt: new Date(Date.UTC(2026, 9, 10, 10, 0, n)).toISOString(),
    ...over,
  } as Omit<TurnRecord, "seq">;
}

const partReport = (part: 1 | 2 | 3, band: number) =>
  ({
    part,
    band,
    criteria: null,
    feedback: `Part ${part} feedback`,
    promptVersion: "test-v1",
  }) as unknown as PartReport;

beforeAll(async () => {
  db = getDb();
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await migrate(db, { migrationsFolder: "drizzle" });
  const r = await seedAll(db, SAMPLE_SET);
  sampleExamId = r.sampleExamId;
  moduleIds = r.moduleIds;
  ownerId = r.localUserId;
}, 60_000);

afterAll(async () => {
  await closeDb();
});

describe("migrations and seed", () => {
  it("applying migrations again changes nothing", async () => {
    const before = await db.execute(sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`);
    await migrate(db, { migrationsFolder: "drizzle" });
    const after = await db.execute(sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`);
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect((before.rows[0] as { n: number }).n).toBeGreaterThanOrEqual(2);
  });

  it("seed is idempotent: running it twice creates no duplicates", async () => {
    const tables = [roles, modules, collections, exams, questions, examQuestions];
    const first = await Promise.all(tables.map(rowsOf));
    await seedAll(db, SAMPLE_SET);
    const second = await Promise.all(tables.map(rowsOf));
    expect(second).toEqual(first);
    expect(first.slice(0, 2)).toEqual([3, 4]); // roles, modules
  });

  it("seeds Cambridge 10 to 21", async () => {
    const rows = await db
      .select({ n: collections.sortNumber })
      .from(collections)
      .where(eq(collections.moduleId, moduleIds.get("cambridge")!));
    expect(rows.map((r) => r.n).sort((a, b) => a! - b!)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
  });

  it("the seeded exam round-trips to the same engine content", async () => {
    const set = await repo.getQuestionSet(sampleExamId);
    expect(set.content).toEqual(SAMPLE_SET);
    expect((await repo.getQuestionSet("set-01")).id).toBe(sampleExamId); // old JSON id still works
  });
});

describe("collections: numeric order and constraints", () => {
  const cambridge = () => moduleIds.get("cambridge")!;
  const add = (n: number, slug = `cambridge-${n}`) =>
    db
      .insert(collections)
      .values({ moduleId: cambridge(), slug, title: `Cambridge ${n}`, sortNumber: n, status: "published" });
  const listing = async () =>
    (
      await db
        .select({ n: collections.sortNumber })
        .from(collections)
        .where(and(eq(collections.moduleId, cambridge()), isNull(collections.deletedAt)))
        .orderBy(sql`${collections.sortNumber} DESC NULLS LAST`, asc(collections.displayOrder), asc(collections.id))
    ).map((r) => r.n);

  it("Cambridge 22 sorts first and 9 sorts after 10 (numbers, not text)", async () => {
    await add(22);
    await add(9);
    const order = await listing();
    expect(order[0]).toBe(22);
    expect(order.at(-1)).toBe(9);
    expect(order.indexOf(10)).toBeLessThan(order.indexOf(9));
  });

  it("a duplicate number in the same module is rejected", async () => {
    expect(await pgCode(add(21, "cambridge-21-copy"))).toBe("23505"); // unique_violation
  });

  it("a soft-deleted number can be reused", async () => {
    await db.update(collections).set({ deletedAt: new Date() }).where(eq(collections.slug, "cambridge-9"));
    await add(9, "cambridge-9-new");
    expect((await listing()).filter((n) => n === 9)).toHaveLength(1);
  });

  it("an exam cannot point at a collection of another module", async () => {
    const [c] = await db.select({ id: collections.id }).from(collections).where(eq(collections.slug, "cambridge-21"));
    const wrong = db.insert(exams).values({
      collectionId: c.id,
      moduleId: moduleIds.get("practice-test")!,
      slug: "x",
      title: "x",
    });
    expect(await pgCode(wrong)).toBe("23503"); // foreign_key_violation
  });
});

describe("content integrity", () => {
  it("an invalid exam is rolled back completely", async () => {
    const before = await rowsOf(exams);
    const broken = { ...SAMPLE_SET, cueCard: { ...SAMPLE_SET.cueCard, bullets: [] } };
    await expect(
      upsertExamFromContent(db, {
        moduleId: moduleIds.get("practice-test")!,
        collectionId: null,
        slug: "broken",
        title: "Broken",
        description: "",
        content: broken,
      }),
    ).rejects.toThrow();
    expect(await rowsOf(exams)).toBe(before);
  });

  it("question positions can be swapped inside one transaction (deferrable unique)", async () => {
    const [s] = await db
      .select({ id: examSections.id })
      .from(examSections)
      .where(and(eq(examSections.examId, sampleExamId), eq(examSections.kind, "part_1")));
    const [a, b] = await db
      .select()
      .from(examQuestions)
      .where(eq(examQuestions.sectionId, s.id))
      .orderBy(asc(examQuestions.position))
      .limit(2);
    await db.transaction(async (tx) => {
      await tx.update(examQuestions).set({ position: b.position }).where(eq(examQuestions.id, a.id));
      await tx.update(examQuestions).set({ position: a.position }).where(eq(examQuestions.id, b.id));
    });
    // Swap back so content stays as seeded.
    await db.transaction(async (tx) => {
      await tx.update(examQuestions).set({ position: a.position }).where(eq(examQuestions.id, a.id));
      await tx.update(examQuestions).set({ position: b.position }).where(eq(examQuestions.id, b.id));
    });
    // A real duplicate still fails at commit.
    const dup = db.update(examQuestions).set({ position: a.position }).where(eq(examQuestions.id, b.id));
    expect(await pgCode(dup)).toBe("23505");
  });
});

describe("attempt lifecycle (repo)", () => {
  let session: ExamSession;

  it("creates an attempt with a content snapshot", async () => {
    const set = await repo.getQuestionSet(sampleExamId);
    session = await repo.createSession({ userId: ownerId, mode: "part1", fidelity: "exam", examinerId: "emma", set });
    const [row] = await db.select().from(examAttempts).where(eq(examAttempts.id, session.id));
    expect(row.status).toBe("in_progress");
    expect((row.contentSnapshot as { content: unknown }).content).toEqual(SAMPLE_SET);
  });

  it("starting the same test again abandons the unfinished one (only one in progress)", async () => {
    const set = await repo.getQuestionSet(sampleExamId);
    const second = await repo.createSession({
      userId: ownerId,
      mode: "part1",
      fidelity: "exam",
      examinerId: "emma",
      set,
    });
    const [old] = await db.select({ s: examAttempts.status }).from(examAttempts).where(eq(examAttempts.id, session.id));
    expect(old.s).toBe("abandoned");
    session = second;
  });

  it("two starts at the same moment both succeed and leave exactly one in progress", async () => {
    const set = await repo.getQuestionSet(sampleExamId);
    const start = () =>
      repo.createSession({ userId: ownerId, mode: "part2", fidelity: "exam", examinerId: "emma", set });
    const [a, b] = await Promise.all([start(), start(), start()]);
    expect(a.id).not.toBe(b.id);
    const live = await db
      .select({ id: examAttempts.id })
      .from(examAttempts)
      .innerJoin(examSections, eq(examSections.id, examAttempts.sectionId))
      .where(and(eq(examAttempts.status, "in_progress"), eq(examSections.kind, "part_2")));
    expect(live).toHaveLength(1);
  });

  it("saving the same take twice keeps one row and links the question", async () => {
    await repo.upsertTurn(session.id, take(1));
    await repo.upsertTurn(session.id, take(1, { transcript: "corrected" }));
    await repo.upsertTurn(session.id, take(2, { questionId: "work-study-1:why", kind: "probe" }));
    const rows = await db.select().from(attemptAnswers).where(eq(attemptAnswers.attemptId, session.id));
    expect(rows).toHaveLength(2);
    const first = rows.find((r) => r.takeId === "take-1")!;
    expect(first.questionId).not.toBeNull(); // mapped through the snapshot
    expect(rows.find((r) => r.takeId === "take-2")!.questionId).toBeNull(); // probes have no question row
    const s = await repo.getSession(session.id, ownerId);
    expect(s!.turns.map((t) => [t.seq, t.transcript])).toEqual([
      [1, "corrected"],
      [2, "answer 2"],
    ]);
  });

  it("completing twice keeps the first submit time", async () => {
    await repo.completeSession(session.id, { endReason: "completed", events: [], durationMs: 1234.4 });
    const [a] = await db.select().from(examAttempts).where(eq(examAttempts.id, session.id));
    const again = await repo.completeSession(session.id, { endReason: "completed", events: [], durationMs: 1234 });
    const [b] = await db.select().from(examAttempts).where(eq(examAttempts.id, session.id));
    expect(again.status).toBe("completed");
    expect(b.submittedAt).toEqual(a.submittedAt);
    expect(b.status).toBe("submitted");
  });

  it("parts scored at the same time are both kept", async () => {
    await Promise.all([
      repo.savePartReport(session.id, partReport(1, 6)),
      repo.savePartReport(session.id, partReport(2, 7)),
    ]);
    const s = await repo.getSession(session.id, ownerId);
    expect(Object.keys(s!.partReports).sort()).toEqual(["1", "2"]);
  });

  it("scoring twice creates exactly one result and no duplicate feedback", async () => {
    const report = {
      mode: "part1",
      overall: 6.5,
      criteria: null,
      parts: [partReport(1, 6.5)],
      summary: "Overall summary",
      strengths: [],
      priorities: [],
      model: "test",
      promptVersion: "test-v1",
      createdAt: new Date().toISOString(),
    } as unknown as FinalReport;
    await repo.saveFinalReport(session.id, report);
    await repo.saveFinalReport(session.id, report);
    const rs = await db.select().from(results).where(eq(results.attemptId, session.id));
    expect(rs).toHaveLength(1);
    expect(rs[0].bandScore).toBe(6.5);
    expect(await db.select().from(feedback).where(eq(feedback.attemptId, session.id))).toHaveLength(2);
    const s = await repo.getSession(session.id, ownerId);
    expect(s!.status).toBe("scored");
    expect(s!.report?.overall).toBe(6.5);
  });

  it("the results list shows the attempt with its bands, newest first", async () => {
    const list = await repo.listSessions(ownerId);
    expect(list.map((s) => s.createdAt)).toEqual([...list.map((s) => s.createdAt)].sort().reverse());
    expect(list.find((s) => s.id === session.id)).toMatchObject({
      overall: 6.5,
      turns: 2,
      status: "scored",
      mode: "part1",
    });
  });

  it("an exam with attempts cannot be deleted (RESTRICT)", async () => {
    expect(await pgCode(db.delete(exams).where(eq(exams.id, sampleExamId)))).toBe("23503");
  });

  it("unknown or malformed ids return nothing instead of failing", async () => {
    expect(await repo.getSession("not-a-uuid", ownerId)).toBeNull();
    expect(await repo.getSession("0192f000-0000-7000-8000-000000000000", ownerId)).toBeNull();
  });
});

describe("JSON import", () => {
  it("imports an old session once and skips it on the next run", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bandly-import-"));
    try {
      mkdirSync(path.join(dir, "sessions"));
      const legacy: ExamSession = {
        id: "2026-01-01-abcdef12",
        createdAt: "2026-01-01T10:00:00.000Z",
        updatedAt: "2026-01-01T10:10:00.000Z",
        mode: "part1",
        fidelity: "guided",
        examinerId: "james",
        setId: "set-01",
        setTitle: "Old title",
        status: "ended_early",
        endReason: "ended_early",
        durationMs: 60_000,
        turns: [{ ...take(1), seq: 1 } as TurnRecord],
        events: [],
        partReports: {},
        report: null,
        error: null,
      };
      writeFileSync(path.join(dir, "sessions", `${legacy.id}.json`), JSON.stringify(legacy));
      const quiet = () => undefined;
      expect(await importJsonStore(db, dir, { log: quiet })).toEqual({ imported: 1, skipped: 0, files: 1 });
      expect(await importJsonStore(db, dir, { log: quiet })).toEqual({ imported: 0, skipped: 1, files: 1 });

      const [row] = await db
        .select({ id: examAttempts.id })
        .from(examAttempts)
        .where(sql`${examAttempts.clientMeta} ->> 'importedFrom' = ${legacy.id}`);
      const s = await repo.getSession(row.id, ownerId);
      expect(s).toMatchObject({
        mode: "part1",
        fidelity: "guided",
        examinerId: "james",
        status: "ended_early",
        setTitle: "Old title",
      });
      expect(s!.turns).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
