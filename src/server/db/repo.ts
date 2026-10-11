import "server-only";
import { and, asc, desc, eq, isNull, lt, ne, sql } from "drizzle-orm";
import type { ExaminerId } from "@/engine/examiners";
import type { EngineEvent, ExamMode, Fidelity } from "@/engine/types";
import { getDb } from "./client";
import { liveTestsSummary, loadCueCardForAttempt, loadTestForAttempt } from "./library";
import type { QuestionIdMap } from "./content";
import { deadlineMs, feedbackRowsFor, KIND_BY_MODE, MODE_BY_KIND, toAttemptStatus, toSessionStatus } from "./mappers";
import {
  attemptAnswers,
  examAttempts,
  examQuestions,
  exams,
  examSections,
  feedback,
  questions,
  results,
} from "./schema";
import type {
  ExamSession,
  FinalReport,
  PartReport,
  QuestionSet,
  SessionStatus,
  SessionSummary,
  TurnRecord,
} from "./types";
import { UUID_RE, uuidv7 } from "./uuid";

/**
 * Data access for the app (PostgreSQL via Drizzle). Route handlers and pages
 * use only these functions, never the database directly. The function
 * signatures are the same as the old JSON store's, so callers did not change.
 */

// ------------------------------------------------------------ question bank

/** Published tests and the parts each offers (GET /api/question-sets). */
export function listPracticeExams() {
  return liveTestsSummary(getDb());
}

/**
 * The content of a new attempt (database-integration.md §12.1): a test part, or a
 * Makkar cue card. No test id → the first published test offering the part.
 * Unpublished content only for users who may preview it (flagged as a preview).
 */
export function loadAttemptContent(input: {
  examId?: string | null;
  cueCardId?: string | null;
  mode: ExamMode;
  canPreview: boolean;
}) {
  if (input.cueCardId) return loadCueCardForAttempt(getDb(), { cardId: input.cueCardId, canPreview: input.canPreview });
  return loadTestForAttempt(getDb(), { testId: input.examId, mode: input.mode, canPreview: input.canPreview });
}

/** Full content (all parts) of a test by id or old JSON id. Used by tests and scripts. */
export async function getQuestionSet(id: string): Promise<QuestionSet> {
  return (await loadTestForAttempt(getDb(), { testId: id, mode: "full", canPreview: true })).set;
}

/** Marks a user's unfinished attempts whose server deadline has passed as expired (lazy expiry). */
async function expireStale(userId: string): Promise<void> {
  await getDb()
    .update(examAttempts)
    .set({ status: "expired" })
    .where(
      and(
        eq(examAttempts.userId, userId),
        eq(examAttempts.status, "in_progress"),
        lt(examAttempts.deadlineAt, sql`now()`),
      ),
    );
}

export class AttemptClosedError extends Error {}

// ----------------------------------------------------------------- sessions

/**
 * Starts an attempt. A previous attempt of the same test that was never
 * finished (closed tab, crash) is marked abandoned: a voice exam cannot be
 * resumed mid-answer, and the database allows one in-progress attempt per test.
 */
export async function createSession(input: {
  /** Owner (the signed-in user). */
  userId: string;
  mode: ExamMode;
  fidelity: Fidelity;
  examinerId: ExaminerId;
  set: QuestionSet;
  /** `set.id` is a Makkar cue card (not a test); the attempt is Part 2. */
  cueCard?: boolean;
  /** An admin trying unpublished content. */
  preview?: boolean;
}): Promise<ExamSession> {
  const db = getDb();
  const userId = input.userId;
  const kind = KIND_BY_MODE[input.mode];
  await expireStale(userId);

  const row = await db.transaction(async (tx) => {
    if (input.cueCard) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`attempt:${userId}:card:${input.set.id}`}))`);
      await tx
        .update(examAttempts)
        .set({ status: "abandoned" })
        .where(
          and(
            eq(examAttempts.userId, userId),
            eq(examAttempts.cueCardId, input.set.id),
            eq(examAttempts.status, "in_progress"),
          ),
        );
      const [attempt] = await tx
        .insert(examAttempts)
        .values({
          userId,
          cueCardId: input.set.id,
          settings: { fidelity: input.fidelity, examinerId: input.examinerId },
          deadlineAt: new Date(Date.now() + deadlineMs("part2", input.fidelity)),
          clientMeta: input.preview ? { preview: true } : {},
          contentSnapshot: { setTitle: input.set.title, content: input.set.content, questionIds: {} },
        })
        .returning();
      return attempt;
    }
    // Serialise concurrent starts of the same test by the same user (double click,
    // two tabs), so "abandon the old one, insert the new one" cannot race.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`attempt:${userId}:${input.set.id}:${kind}`}))`);
    const [section] = await tx
      .select({ id: examSections.id })
      .from(examSections)
      .where(
        and(
          eq(examSections.examId, input.set.id),
          eq(examSections.kind, kind),
          ne(examSections.status, "archived"),
          isNull(examSections.deletedAt),
        ),
      );
    if (!section) throw new Error(`This test has no ${kind.replace("_", " ")} section.`);

    const idRows = await tx
      .select({
        examQuestionId: examQuestions.id,
        questionId: examQuestions.questionId,
        engineId: sql<string>`${questions.content}->>'engineId'`,
      })
      .from(examQuestions)
      .innerJoin(questions, eq(questions.id, examQuestions.questionId))
      .where(eq(examQuestions.examId, input.set.id));
    const questionIds: QuestionIdMap = Object.fromEntries(
      idRows.map((r) => [r.engineId, { questionId: r.questionId, examQuestionId: r.examQuestionId }]),
    );

    await tx
      .update(examAttempts)
      .set({ status: "abandoned" })
      .where(
        and(
          eq(examAttempts.userId, userId),
          eq(examAttempts.examId, input.set.id),
          eq(examAttempts.sectionId, section.id),
          eq(examAttempts.status, "in_progress"),
        ),
      );

    const [attempt] = await tx
      .insert(examAttempts)
      .values({
        userId,
        examId: input.set.id,
        sectionId: section.id,
        settings: { fidelity: input.fidelity, examinerId: input.examinerId },
        // Server-set deadline (§12.1): turns after it are refused and the attempt expires.
        deadlineAt: new Date(Date.now() + deadlineMs(input.mode, input.fidelity)),
        clientMeta: input.preview ? { preview: true } : {},
        contentSnapshot: { setTitle: input.set.title, content: input.set.content, questionIds },
      })
      .returning();
    return attempt;
  });

  return {
    id: row.id,
    createdAt: row.startedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    mode: input.cueCard ? "part2" : input.mode,
    fidelity: input.fidelity,
    examinerId: input.examinerId,
    setId: input.set.id,
    setTitle: input.set.title,
    status: "in_progress",
    endReason: null,
    durationMs: null,
    turns: [],
    events: [],
    partReports: {},
    report: null,
    error: null,
  };
}

/**
 * A session, only if `ownerId` owns it. Other users' sessions look exactly like
 * missing ones (null → 404), so their existence is never revealed.
 */
export async function getSession(id: string, ownerId: string): Promise<ExamSession | null> {
  if (!UUID_RE.test(id)) return null;
  const db = getDb();
  const [a] = await db
    .select({ attempt: examAttempts, title: exams.title, kind: examSections.kind })
    .from(examAttempts)
    .leftJoin(exams, eq(exams.id, examAttempts.examId))
    .leftJoin(examSections, eq(examSections.id, examAttempts.sectionId))
    .where(and(eq(examAttempts.id, id), eq(examAttempts.userId, ownerId)));
  if (!a) return null;

  const [answerRows, [result]] = await Promise.all([
    db
      .select()
      .from(attemptAnswers)
      .where(eq(attemptAnswers.attemptId, id))
      .orderBy(asc(attemptAnswers.answeredAt), asc(attemptAnswers.id)),
    db.select({ breakdown: results.breakdown }).from(results).where(eq(results.attemptId, id)),
  ]);

  const at = a.attempt;
  const breakdown = (result?.breakdown ?? {}) as {
    partReports?: ExamSession["partReports"];
    final?: FinalReport | null;
  };
  const snapshotTitle = (at.contentSnapshot as { setTitle?: string } | null)?.setTitle;

  return {
    id: at.id,
    createdAt: at.startedAt.toISOString(),
    updatedAt: at.updatedAt.toISOString(),
    // Cue card attempts have no section: they are always Part 2.
    mode: a.kind ? MODE_BY_KIND[a.kind] : "part2",
    fidelity: at.settings.fidelity,
    examinerId: at.settings.examinerId,
    setId: at.examId ?? at.cueCardId ?? "",
    setTitle: snapshotTitle ?? a.title ?? "",
    status: toSessionStatus(at.status, at.endReason),
    endReason: at.endReason,
    durationMs: at.durationMs,
    turns: answerRows.map(
      (r, i) =>
        ({
          ...r.answer,
          takeId: r.takeId,
          seq: i + 1,
          part: r.part,
          questionId: r.questionKey,
          createdAt: r.answeredAt.toISOString(),
        }) as TurnRecord,
    ),
    events: at.events as EngineEvent[],
    partReports: breakdown.partReports ?? {},
    report: breakdown.final ?? null,
    error: at.error,
  };
}

/**
 * Adds or replaces a take (idempotent by takeId). Refused (AttemptClosedError)
 * once the attempt expired, was abandoned, or its deadline passed.
 */
export async function upsertTurn(id: string, turn: Omit<TurnRecord, "seq">): Promise<void> {
  const db = getDb();
  const [a] = await db
    .select({ status: examAttempts.status, late: sql<boolean>`${examAttempts.deadlineAt} < now()` })
    .from(examAttempts)
    .where(eq(examAttempts.id, id));
  if (!a) throw new Error("Session not found");
  if (a.status === "in_progress" && a.late) {
    await db.update(examAttempts).set({ status: "expired" }).where(eq(examAttempts.id, id));
    throw new AttemptClosedError("The time for this test has run out. Start a new test.");
  }
  if (a.status === "expired" || a.status === "abandoned") {
    throw new AttemptClosedError("This test is closed. Start a new test.");
  }
  const { takeId, part, questionId, createdAt, ...answer } = turn;
  const idFrom = (field: "questionId" | "examQuestionId") =>
    sql`(SELECT (${examAttempts.contentSnapshot} -> 'questionIds' -> ${questionId}::text ->> ${field}::text)::uuid
         FROM ${examAttempts} WHERE ${examAttempts.id} = ${id})`;
  await db
    .insert(attemptAnswers)
    .values({
      attemptId: id,
      takeId,
      part,
      questionKey: questionId,
      questionId: idFrom("questionId"),
      examQuestionId: idFrom("examQuestionId"),
      answer: answer as Record<string, unknown>,
      answeredAt: new Date(createdAt),
    })
    .onConflictDoUpdate({
      target: [attemptAnswers.attemptId, attemptAnswers.takeId],
      set: { answer: sql`excluded.answer`, part: sql`excluded.part`, questionKey: sql`excluded.question_key` },
    });
  await db.update(examAttempts).set({ lastActivityAt: new Date() }).where(eq(examAttempts.id, id));
}

/** Marks the exam as over (idempotent: a second call keeps the first submitted_at). */
export async function completeSession(
  id: string,
  input: { endReason: "completed" | "ended_early"; events: EngineEvent[]; durationMs: number | null },
): Promise<Pick<ExamSession, "id" | "status">> {
  if (!UUID_RE.test(id)) throw new Error("Session not found");
  const [row] = await getDb()
    .update(examAttempts)
    .set({
      endReason: input.endReason,
      events: input.events,
      durationMs: input.durationMs === null ? null : Math.round(input.durationMs),
      submittedAt: sql`coalesce(${examAttempts.submittedAt}, now())`,
      lastActivityAt: new Date(),
      status: sql`CASE WHEN ${examAttempts.status} = 'in_progress' THEN 'submitted'::attempt_status ELSE ${examAttempts.status} END`,
    })
    .where(eq(examAttempts.id, id))
    .returning({ id: examAttempts.id, status: examAttempts.status, endReason: examAttempts.endReason });
  if (!row) throw new Error("Session not found");
  return { id: row.id, status: toSessionStatus(row.status, row.endReason) };
}

/**
 * Saves one part's report. The result row is created on the first part report
 * (full tests score each part as soon as it ends). The JSON merge happens in one
 * statement, so parts scored in parallel cannot overwrite each other.
 */
export async function savePartReport(id: string, report: PartReport): Promise<void> {
  const part = JSON.stringify({ [String(report.part)]: report });
  const res = await getDb().execute(sql`
    INSERT INTO results (id, attempt_id, user_id, exam_id, module_id, cue_card_id, breakdown, scoring_version)
    SELECT ${uuidv7()}::uuid, a.id, a.user_id, a.exam_id, e.module_id, a.cue_card_id,
           jsonb_build_object('partReports', ${part}::jsonb), ${report.promptVersion}::text
    FROM exam_attempts a LEFT JOIN exams e ON e.id = a.exam_id
    WHERE a.id = ${id}::uuid
    ON CONFLICT (attempt_id) DO UPDATE SET
      breakdown = results.breakdown || jsonb_build_object(
        'partReports', coalesce(results.breakdown -> 'partReports', '{}'::jsonb) || ${part}::jsonb),
      updated_at = now()`);
  if (res.rowCount === 0) throw new Error("Session not found");
}

/** Saves the final report, its feedback rows and the scored status in one transaction. */
export async function saveFinalReport(id: string, report: FinalReport): Promise<void> {
  const parts = JSON.stringify(Object.fromEntries(report.parts.map((p) => [String(p.part), p])));
  const final = JSON.stringify(report);
  await getDb().transaction(async (tx) => {
    const res = await tx.execute<{ id: string }>(sql`
      INSERT INTO results (id, attempt_id, user_id, exam_id, module_id, cue_card_id, band_score, breakdown, scoring_version)
      SELECT ${uuidv7()}::uuid, a.id, a.user_id, a.exam_id, e.module_id, a.cue_card_id, ${report.overall}::numeric,
             jsonb_build_object('partReports', ${parts}::jsonb, 'final', ${final}::jsonb), ${report.promptVersion}::text
      FROM exam_attempts a LEFT JOIN exams e ON e.id = a.exam_id
      WHERE a.id = ${id}::uuid
      ON CONFLICT (attempt_id) DO UPDATE SET
        band_score = excluded.band_score,
        breakdown = results.breakdown || jsonb_build_object(
          'partReports', coalesce(results.breakdown -> 'partReports', '{}'::jsonb) || ${parts}::jsonb,
          'final', ${final}::jsonb),
        scoring_version = excluded.scoring_version,
        updated_at = now()
      RETURNING id`);
    const resultId = res.rows[0]?.id;
    if (!resultId) throw new Error("Session not found");

    // AI feedback is regenerated on every (re)score.
    await tx.delete(feedback).where(and(eq(feedback.resultId, resultId), eq(feedback.source, "ai")));
    const rows = feedbackRowsFor(report);
    if (rows.length) {
      await tx.insert(feedback).values(rows.map((r) => ({ ...r, resultId, attemptId: id, source: "ai" as const })));
    }
    await tx.update(examAttempts).set({ status: "scored", error: null }).where(eq(examAttempts.id, id));
  });
}

export async function setStatus(id: string, status: SessionStatus, error: string | null = null): Promise<void> {
  await getDb()
    .update(examAttempts)
    .set({ ...toAttemptStatus(status), error })
    .where(eq(examAttempts.id, id));
}

export function summarise(s: ExamSession): SessionSummary {
  const partBands: SessionSummary["partBands"] = {};
  for (const [k, r] of Object.entries(s.partReports)) partBands[k as "1" | "2" | "3"] = r?.band ?? null;
  return {
    id: s.id,
    createdAt: s.createdAt,
    mode: s.mode,
    fidelity: s.fidelity,
    examinerId: s.examinerId,
    setTitle: s.setTitle,
    status: s.status,
    overall: s.report?.overall ?? null,
    partBands,
    durationMs: s.durationMs,
    turns: s.turns.length,
  };
}

/** Past attempts, newest first (one query, no per-attempt lookups). */
/** For server jobs (scoring) after the route has checked ownership. */
export async function getSessionUnchecked(id: string): Promise<ExamSession | null> {
  const owner = await sessionOwner(id);
  return owner ? getSession(id, owner) : null;
}

async function sessionOwner(id: string): Promise<string | null> {
  if (!UUID_RE.test(id)) return null;
  const [row] = await getDb().select({ userId: examAttempts.userId }).from(examAttempts).where(eq(examAttempts.id, id));
  return row?.userId ?? null;
}

/** True if the attempt exists and belongs to `ownerId`. */
export async function ownsSession(id: string, ownerId: string): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  const [row] = await getDb()
    .select({ id: examAttempts.id })
    .from(examAttempts)
    .where(and(eq(examAttempts.id, id), eq(examAttempts.userId, ownerId)));
  return Boolean(row);
}

/** One user's past attempts, newest first. */
export async function listSessions(ownerId: string, limit = 100): Promise<SessionSummary[]> {
  await expireStale(ownerId);
  const rows = await getDb()
    .select({
      id: examAttempts.id,
      startedAt: examAttempts.startedAt,
      status: examAttempts.status,
      endReason: examAttempts.endReason,
      settings: examAttempts.settings,
      durationMs: examAttempts.durationMs,
      setTitle: sql<string>`coalesce(${examAttempts.contentSnapshot} ->> 'setTitle', ${exams.title}, '')`,
      kind: examSections.kind,
      breakdown: results.breakdown,
      turns: sql<number>`(SELECT count(*)::int FROM ${attemptAnswers} WHERE ${attemptAnswers.attemptId} = ${examAttempts.id})`,
    })
    .from(examAttempts)
    .leftJoin(exams, eq(exams.id, examAttempts.examId))
    .leftJoin(examSections, eq(examSections.id, examAttempts.sectionId))
    .leftJoin(results, eq(results.attemptId, examAttempts.id))
    .where(eq(examAttempts.userId, ownerId))
    .orderBy(desc(examAttempts.startedAt), desc(examAttempts.id))
    .limit(Math.min(Math.max(limit, 1), 100));

  return rows.map((r) => {
    const b = (r.breakdown ?? {}) as { partReports?: ExamSession["partReports"]; final?: FinalReport | null };
    const partBands: SessionSummary["partBands"] = {};
    for (const [k, rep] of Object.entries(b.partReports ?? {})) partBands[k as "1" | "2" | "3"] = rep?.band ?? null;
    return {
      id: r.id,
      createdAt: r.startedAt.toISOString(),
      mode: r.kind ? MODE_BY_KIND[r.kind] : "part2",
      fidelity: r.settings.fidelity,
      examinerId: r.settings.examinerId,
      setTitle: r.setTitle,
      status: toSessionStatus(r.status, r.endReason),
      overall: b.final?.overall ?? null,
      partBands,
      durationMs: r.durationMs,
      turns: r.turns,
    };
  });
}
