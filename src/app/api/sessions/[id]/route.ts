import { connection } from "next/server";
import { requirePermission } from "@/server/auth/session";
import { getSession } from "@/server/db/repo";
import { errorResponse } from "@/server/http";

/** GET /api/sessions/:id: the full stored session (turns, reports). */
export async function GET(_req: Request, ctx: RouteContext<"/api/sessions/[id]">) {
  await connection();
  try {
    const { id } = await ctx.params;
    const user = await requirePermission("result.view_own");
    const session = await getSession(id, user.id);
    if (!session) return Response.json({ error: "This test session was not found." }, { status: 404 });
    return Response.json(session);
  } catch (e) {
    return errorResponse(e, "sessions:get");
  }
}
