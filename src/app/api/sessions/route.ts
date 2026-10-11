import { connection } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/auth/session";
import { can } from "@/server/auth/policy";
import { createSession, listSessions, loadAttemptContent } from "@/server/db/repo";
import { errorResponse } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";

const createSchema = z.object({
  mode: z.enum(["part1", "part2", "part3", "full"]),
  fidelity: z.enum(["exam", "guided"]),
  examinerId: z.enum(["emma", "james"]),
  setId: z.string().max(64).nullish(),
  /** A Makkar cue card instead of a test (always Part 2). */
  cueCardId: z.uuid().nullish(),
});

/** POST /api/sessions: start a new test; returns the session id and its questions. */
export async function POST(req: Request) {
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  try {
    const user = await requirePermission("exam.take");
    const rl = rateLimit(`session:${user.id}`, 20, 60 * 60_000);
    if (!rl.ok) return Response.json({ error: "Too many tests started. Please wait a while." }, { status: 429 });
    const { cueCardId, setId, ...rest } = parsed.data;
    const mode = cueCardId ? "part2" : rest.mode;
    const { set, preview } = await loadAttemptContent({
      examId: setId,
      cueCardId,
      mode,
      canPreview: can(user, "content.preview"),
    });
    const session = await createSession({ ...rest, mode, set, preview, cueCard: Boolean(cueCardId), userId: user.id });
    return Response.json({ id: session.id, setId: set.id, setTitle: set.title, content: set.content }, { status: 201 });
  } catch (e) {
    return errorResponse(e, "sessions:create");
  }
}

/** GET /api/sessions: past tests, newest first. */
export async function GET() {
  await connection();
  try {
    const user = await requirePermission("result.view_own");
    return Response.json({ sessions: await listSessions(user.id) });
  } catch (e) {
    return errorResponse(e, "sessions:list");
  }
}
