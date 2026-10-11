import "server-only";
import { partsForMode } from "@/engine/compiler";
import type { Part } from "@/engine/types";
import { getSessionUnchecked, saveFinalReport, savePartReport, setStatus } from "./db/repo";
import type { ExamSession, FinalReport, PartReport } from "./db/types";
import { chatJson } from "./groq";
import {
  answersForPart,
  buildPartReport,
  combineParts,
  conductForPart,
  parseJson,
  partLlmJsonSchema,
  partLlmSchema,
  partSystemPrompt,
  partUserMessage,
  PROMPT_VERSION,
  summaryLlmJsonSchema,
  summaryLlmSchema,
  summarySystemPrompt,
  summaryUserMessage,
  type PartLlm,
} from "./scoring";

/** Scores one part of a session (idempotent unless `force`). Callers check ownership first. */
export async function scorePart(sessionId: string, part: Part, force = false): Promise<PartReport> {
  const session = await mustGet(sessionId);
  const existing = session.partReports[String(part) as "1" | "2" | "3"];
  if (existing && !force) return existing;

  const answers = answersForPart(session.turns, part);
  const conduct = conductForPart(session.turns, part);
  const hasSpeech = answers.some((a) => !a.noResponse);

  let llm: PartLlm | null = null;
  let model: string | null = null;
  if (hasSpeech) {
    const messages = [
      { role: "system" as const, content: partSystemPrompt(part) },
      { role: "user" as const, content: partUserMessage(part, session.mode, answers) },
    ];
    const format = { name: "ielts_part_report", schema: partLlmJsonSchema as unknown as Record<string, unknown> };
    let reply = await chatJson(messages, format, { maxTokens: 3_500 });
    model = reply.model;
    try {
      llm = parseJson(partLlmSchema, reply.content);
    } catch (err) {
      // One repair attempt with the validation error.
      reply = await chatJson(
        [
          ...messages,
          { role: "assistant", content: reply.content },
          {
            role: "user",
            content: `That was not valid for the schema (${String(err).slice(0, 300)}). Return the corrected JSON only.`,
          },
        ],
        format,
        { maxTokens: 3_500 },
      );
      model = reply.model;
      llm = parseJson(partLlmSchema, reply.content);
    }
  }

  const report = buildPartReport({ part, answers, conduct, llm, model });
  await savePartReport(sessionId, report);
  return report;
}

/** Scores every part (reusing parts already scored during the exam) and writes the final report. */
export async function finalizeSession(sessionId: string, force = false): Promise<FinalReport> {
  const session = await mustGet(sessionId);
  if (session.report && !force) return session.report;
  await setStatus(sessionId, "scoring");

  try {
    const parts = partsForMode(session.mode);
    const reports: PartReport[] = [];
    for (const p of parts) {
      // Only score parts the candidate actually reached.
      if (!session.turns.some((t) => t.part === p)) continue;
      reports.push(await scorePart(sessionId, p, force));
    }

    const { criteria, overall } = combineParts(reports);
    let summary = "";
    let strengths: string[] = [];
    let priorities: string[] = [];
    let model: string | null = reports.find((r) => r.model)?.model ?? null;

    if (session.mode === "full" && reports.filter((r) => r.criteria).length > 1) {
      try {
        const reply = await chatJson(
          [
            { role: "system", content: summarySystemPrompt() },
            { role: "user", content: summaryUserMessage(reports, overall, criteria) },
          ],
          { name: "ielts_summary", schema: summaryLlmJsonSchema as unknown as Record<string, unknown> },
          { maxTokens: 1_200 },
        );
        const s = parseJson(summaryLlmSchema, reply.content);
        summary = s.summary;
        strengths = s.strengths;
        priorities = s.priorities;
        model = reply.model;
      } catch {
        /* fall back to part feedback below */
      }
    }
    if (!summary) {
      const only = reports.find((r) => r.criteria);
      summary = only?.feedback ?? "Not enough speech was captured to give an assessment.";
      priorities = reports.flatMap((r) => r.priorities).slice(0, 3);
    }

    const report: FinalReport = {
      mode: session.mode,
      overall,
      criteria,
      parts: reports,
      summary,
      strengths,
      priorities,
      model,
      promptVersion: PROMPT_VERSION,
      createdAt: new Date().toISOString(),
    };
    await saveFinalReport(sessionId, report);
    return report;
  } catch (e) {
    await setStatus(sessionId, "score_failed", e instanceof Error ? e.message : String(e));
    throw e;
  }
}

async function mustGet(id: string): Promise<ExamSession> {
  const s = await getSessionUnchecked(id);
  if (!s) throw new NotFoundError("Session not found");
  return s;
}

export class NotFoundError extends Error {}
