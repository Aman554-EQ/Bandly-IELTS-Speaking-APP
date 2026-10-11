import { z } from "zod";
import { requirePermission } from "@/server/auth/session";
import { completeSession, ownsSession } from "@/server/db/repo";
import { errorResponse } from "@/server/http";

/** POST /api/sessions/:id/complete: store how the exam ended and the engine timeline. */
const schema = z.object({
  endReason: z.enum(["completed", "ended_early"]),
  durationMs: z.number().min(0).nullable(),
  events: z
    .array(
      z.object({
        seq: z.number(),
        t: z.number(),
        type: z.string(),
        data: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .max(5_000),
});

export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[id]/complete">) {
  const { id } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  try {
    const user = await requirePermission("exam.take");
    if (!(await ownsSession(id, user.id))) {
      return Response.json({ error: "This test session was not found." }, { status: 404 });
    }
    const s = await completeSession(id, parsed.data as Parameters<typeof completeSession>[1]);
    return Response.json({ id: s.id, status: s.status });
  } catch (e) {
    return errorResponse(e, "complete");
  }
}
