import { z } from "zod";
import { requestMeta, requireUser } from "@/server/auth/session";
import { changeUserAccess } from "@/server/auth/users";
import { getDb } from "@/server/db/client";
import { UUID_RE } from "@/server/db/uuid";
import { errorResponse } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";

/**
 * POST /api/superadmin/users/:id/access
 *   { kind: "grant" | "revoke", role: "admin" | "superadmin" | "student" }
 *   { kind: "status", status: "active" | "suspended" }
 * Every rule (who may do what, no self-changes, last superadmin) is enforced in
 * `changeUserAccess` inside a transaction; denied attempts are audited.
 */
const schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["grant", "revoke"]), role: z.enum(["superadmin", "admin", "student"]) }).strict(),
  z.object({ kind: z.literal("status"), status: z.enum(["active", "suspended"]) }).strict(),
]);

const STATUS = {
  not_allowed: 403,
  self_change: 403,
  last_superadmin: 409,
  student_role_fixed: 400,
  target_deleted: 409,
  no_change: 409,
} as const;

export async function POST(req: Request, ctx: RouteContext<"/api/superadmin/users/[id]/access">) {
  try {
    const actor = await requireUser();
    const rl = rateLimit(`admin:${actor.id}`, 60, 10 * 60_000);
    if (!rl.ok) return Response.json({ error: "Too many changes. Please wait a few minutes." }, { status: 429 });
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return Response.json({ error: "User not found." }, { status: 404 });
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });

    const r = await changeUserAccess(getDb(), { actor, targetId: id, change: parsed.data, meta: requestMeta(req) });
    if (!r.ok) {
      const status = r.message === "User not found." ? 404 : STATUS[r.denial];
      return Response.json({ error: r.message, reason: r.denial }, { status });
    }
    return Response.json({ user: { id: r.user.id, roles: r.user.roles, status: r.user.status } });
  } catch (e) {
    return errorResponse(e, "superadmin:access");
  }
}
