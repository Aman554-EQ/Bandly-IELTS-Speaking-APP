import { z } from "zod";
import { requirePermission } from "@/server/auth/session";
import { ownsSession, upsertTurn } from "@/server/db/repo";
import { errorResponse } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
import { analyzeTurn } from "@/server/turn-analysis";

/**
 * POST /api/sessions/:id/turns: live listening for one take.
 * multipart/form-data: `meta` (JSON TakeMeta) + optional `audio`.
 * Transcribes, works out what the candidate meant, stores the take and
 * returns the analysis so the examiner can respond.
 */
export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024;

const metaSchema = z.object({
  takeId: z.string().regex(/^t\d{1,5}$/),
  part: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  questionId: z.string().max(120),
  question: z.string().max(600),
  kind: z.enum(["name", "main", "probe", "long_turn", "round_off"]),
  attempt: z.number().int().min(0).max(50),
  outcome: z.enum(["end_of_turn", "no_response", "interrupted", "manual_finish", "early_stop", "repeat_requested"]),
  speechMs: z
    .number()
    .min(0)
    .max(30 * 60_000),
  durationMs: z
    .number()
    .min(0)
    .max(30 * 60_000),
  firstSpeechLatencyMs: z.number().min(0).nullable(),
  scored: z.boolean(),
});

export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[id]/turns">) {
  let userId: string;
  try {
    userId = (await requirePermission("exam.take")).id;
  } catch (e) {
    return errorResponse(e, "turns");
  }
  const rl = rateLimit(`turn:${userId}`, 90, 60_000);
  if (!rl.ok) return Response.json({ error: "Too many requests." }, { status: 429 });

  const { id } = await ctx.params;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Expected multipart/form-data." }, { status: 400 });
  }
  const meta = metaSchema.safeParse(JSON.parse(String(form.get("meta") ?? "null")));
  if (!meta.success) return Response.json({ error: "Invalid take metadata." }, { status: 400 });

  const rawAudio = form.get("audio");
  const audio = rawAudio instanceof Blob && rawAudio.size > 0 ? rawAudio : null;
  if (audio && audio.size > MAX_BYTES) return Response.json({ error: "Audio file is too large." }, { status: 413 });
  if (audio && !/^(audio|video)\//.test(audio.type)) {
    return Response.json({ error: "Unsupported audio type." }, { status: 415 });
  }

  try {
    if (!(await ownsSession(id, userId)))
      return Response.json({ error: "This test session was not found." }, { status: 404 });

    const { analysis, features, sttModel, analysisModel } = await analyzeTurn(meta.data, audio);
    const { transcript, ...analysisRest } = analysis;
    await upsertTurn(id, {
      ...meta.data,
      transcript,
      features,
      analysis: analysisRest,
      sttModel,
      analysisModel,
      createdAt: new Date().toISOString(),
    });
    return Response.json({ analysis, features });
  } catch (e) {
    return errorResponse(e, "turns");
  }
}
