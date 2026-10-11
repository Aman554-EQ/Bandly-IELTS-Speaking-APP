/**
 * Copies the old JSON store (question-bank.json and sessions/*.json) into
 * PostgreSQL. Idempotent: sessions already imported (client_meta.importedFrom)
 * are skipped, and the JSON files are never changed. Used by `pnpm db:import-json`.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { SAMPLE_SET } from "@/content/sample-set";
import type { Db } from "./client";
import { feedbackRowsFor, KIND_BY_MODE, toAttemptStatus } from "./mappers";
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
import { ensureLocalUser, SAMPLE_EXAM, seedAll, upsertExamFromContent } from "./seed";
import type { ExamSession, QuestionBank } from "./types";
import { uuidv7 } from "./uuid";

/** The take as stored in attempt_answers.answer (seq is derived on read). */
function withoutSeq(t: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...t };
  delete copy.seq;
  return copy;
}

export interface ImportSummary {
  imported: number;
  skipped: number;
  files: number;
}

export async function importJsonStore(
  db: Db,
  dataDir: string,
  { dryRun = false, log = console.log }: { dryRun?: boolean; log?: (msg: string) => void } = {},
): Promise<ImportSummary> {
  const base = await seedAll(db, SAMPLE_SET);
  const userId = await ensureLocalUser(db);

  // 1. Question sets → exams (set-01 is the seeded sample exam).
  const examBySetId = new Map<string, string>([[SAMPLE_EXAM.slug, base.sampleExamId]]);
  const bankFile = path.join(dataDir, "question-bank.json");
  if (existsSync(bankFile)) {
    const bank = JSON.parse(readFileSync(bankFile, "utf8")) as QuestionBank;
    // Extra sets become numbered Practice Test Exam tests (next free numbers).
    const moduleId = base.categories.get("practice_test")!;
    const [{ top }] = await db
      .select({ top: sql<number>`coalesce(max(${exams.examNumber}), 0)::int` })
      .from(exams)
      .where(eq(exams.moduleId, moduleId));
    let next = top;
    for (const set of bank.sets) {
      if (examBySetId.has(set.id)) continue;
      if (dryRun) {
        log(`would import question set ${set.id}`);
        continue;
      }
      const r = await upsertExamFromContent(db, {
        moduleId,
        collectionId: null,
        number: ++next,
        slug: set.id,
        title: set.title,
        description: set.description,
        metadata: { legacySetId: set.id, source: set.source },
        content: set.content,
      });
      examBySetId.set(set.id, r.examId);
      log(`question set ${set.id} → test ${r.examId}${r.created ? "" : " (already there)"}`);
    }
  }

  // 2. Sessions → attempts, takes, results, feedback.
  const sessionDir = path.join(dataDir, "sessions");
  const files = existsSync(sessionDir) ? readdirSync(sessionDir).filter((f) => f.endsWith(".json")) : [];
  let imported = 0;
  let skipped = 0;
  for (const file of files) {
    const s = JSON.parse(readFileSync(path.join(sessionDir, file), "utf8")) as ExamSession;
    const [already] = await db
      .select({ id: examAttempts.id })
      .from(examAttempts)
      .where(sql`${examAttempts.clientMeta} ->> 'importedFrom' = ${s.id}`);
    if (already) {
      skipped++;
      log(`skip ${s.id} (already imported as ${already.id})`);
      continue;
    }
    const examId = examBySetId.get(s.setId);
    if (!examId) {
      log(`skip ${s.id}: question set "${s.setId}" not found`);
      continue;
    }
    if (dryRun) {
      log(`would import ${s.id} (${s.mode}, ${s.turns.length} takes, status ${s.status})`);
      continue;
    }

    const newId = await db.transaction(async (tx) => {
      const [section] = await tx
        .select({ id: examSections.id })
        .from(examSections)
        .where(and(eq(examSections.examId, examId), eq(examSections.kind, KIND_BY_MODE[s.mode])));
      const idRows = await tx
        .select({
          examQuestionId: examQuestions.id,
          questionId: examQuestions.questionId,
          engineId: sql<string>`${questions.content} ->> 'engineId'`,
        })
        .from(examQuestions)
        .innerJoin(questions, eq(questions.id, examQuestions.questionId))
        .where(eq(examQuestions.examId, examId));
      const ids = new Map(idRows.map((r) => [r.engineId, r]));

      // Old unfinished sessions cannot be resumed: store them as abandoned.
      const st =
        s.status === "in_progress"
          ? { status: "abandoned" as const }
          : toAttemptStatus(s.status === "scoring" ? (s.endReason ?? "completed") : s.status);
      const created = new Date(s.createdAt);
      const id = uuidv7(created.getTime());
      await tx.insert(examAttempts).values({
        id,
        userId,
        examId,
        sectionId: section.id,
        status: st.status,
        endReason: s.endReason ?? st.endReason ?? null,
        startedAt: created,
        submittedAt: s.endReason ? new Date(s.updatedAt) : null,
        lastActivityAt: new Date(s.updatedAt),
        durationMs: s.durationMs === null ? null : Math.round(s.durationMs),
        settings: { fidelity: s.fidelity, examinerId: s.examinerId },
        contentSnapshot: {
          setTitle: s.setTitle,
          questionIds: Object.fromEntries(
            [...ids].map(([k, v]) => [k, { questionId: v.questionId, examQuestionId: v.examQuestionId }]),
          ),
        },
        events: s.events,
        error: s.error,
        clientMeta: { importedFrom: s.id },
      });

      if (s.turns.length) {
        await tx.insert(attemptAnswers).values(
          s.turns.map(({ takeId, part, questionId, createdAt, ...rest }) => ({
            attemptId: id,
            takeId,
            part,
            questionKey: questionId,
            questionId: ids.get(questionId)?.questionId ?? null,
            examQuestionId: ids.get(questionId)?.examQuestionId ?? null,
            answer: withoutSeq(rest),
            answeredAt: new Date(createdAt),
          })),
        );
      }

      const hasParts = Object.keys(s.partReports).length > 0;
      if (hasParts || s.report) {
        const [exam] = await tx.select({ moduleId: exams.moduleId }).from(exams).where(eq(exams.id, examId));
        const [result] = await tx
          .insert(results)
          .values({
            attemptId: id,
            userId,
            examId,
            moduleId: exam.moduleId,
            bandScore: s.report?.overall ?? null,
            breakdown: { partReports: s.partReports, final: s.report },
            scoringVersion: s.report?.promptVersion ?? Object.values(s.partReports)[0]?.promptVersion ?? "unknown",
            createdAt: new Date(s.report?.createdAt ?? s.updatedAt),
          })
          .returning({ id: results.id });
        if (s.report) {
          const rows = feedbackRowsFor(s.report);
          if (rows.length)
            await tx
              .insert(feedback)
              .values(rows.map((r) => ({ ...r, resultId: result.id, attemptId: id, source: "ai" as const })));
        }
      }
      return id;
    });
    imported++;
    log(`imported ${s.id} → ${newId} (${s.mode}, ${s.turns.length} takes)`);
  }
  log(`\nSessions: ${imported} imported, ${skipped} already imported, ${files.length} files.`);
  if (imported) log("Old /results/<old-id> links do not carry over; open the results list instead.");
  return { imported, skipped, files: files.length };
}
