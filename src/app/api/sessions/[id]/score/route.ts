import { z } from "zod";
import { errorResponse } from "@/server/http";
import { requirePermission } from "@/server/auth/session";
import { ownsSession } from "@/server/db/repo";
import { rateLimit } from "@/server/rate-limit";
import { finalizeSession, scorePart } from "@/server/score-service";

/**
 * POST /api/sessions/:id/score
 *   { part: 1|2|3 }  → score one part (called as soon as a part ends in a full test)
 *   { }              → score all remaining parts and write the final report
 *   { force: true }  → re-score from scratch
 */
export const maxDuration = 60;

const schema = z.object({
  part: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  force: z.boolean().optional(),
});

export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[id]/score">) {
  const { id } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  try {
    const user = await requirePermission("result.view_own");
    if (!(await ownsSession(id, user.id))) {
      return Response.json({ error: "This test session was not found." }, { status: 404 });
    }
    const rl = rateLimit(`score:${user.id}`, 30, 10 * 60_000);
    if (!rl.ok) return Response.json({ error: "Scoring limit reached. Please wait a few minutes." }, { status: 429 });
    if (parsed.data.part) return Response.json(await scorePart(id, parsed.data.part, parsed.data.force));
    return Response.json(await finalizeSession(id, parsed.data.force));
  } catch (e) {
    return errorResponse(e, "score");
  }
}
