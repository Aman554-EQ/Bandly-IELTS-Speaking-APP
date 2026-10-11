import { connection } from "next/server";
import { requestMeta, requirePermission } from "@/server/auth/session";
import { getProfile, profileUpdateSchema, updateProfile } from "@/server/auth/users";
import { getDb } from "@/server/db/client";
import { errorResponse } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";

/** GET /api/profile: the signed-in user's profile. */
export async function GET() {
  await connection();
  try {
    const user = await requirePermission("profile.edit_own");
    return Response.json(await getProfile(getDb(), user.id));
  } catch (e) {
    return errorResponse(e, "profile:get");
  }
}

/**
 * PATCH /api/profile: { displayName?, bio?, preferences? } only.
 * Any other field (role, status, email, ids) is rejected with 400.
 */
export async function PATCH(req: Request) {
  try {
    const user = await requirePermission("profile.edit_own");
    const rl = rateLimit(`profile:${user.id}`, 30, 10 * 60_000);
    if (!rl.ok) return Response.json({ error: "Too many updates. Please wait a few minutes." }, { status: 429 });
    const parsed = profileUpdateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const message =
        issue?.code === "unrecognized_keys"
          ? `These fields cannot be changed here: ${issue.keys.join(", ")}.`
          : (issue?.message ?? "Invalid request.");
      return Response.json({ error: message }, { status: 400 });
    }
    return Response.json(await updateProfile(getDb(), user.id, parsed.data, requestMeta(req)));
  } catch (e) {
    return errorResponse(e, "profile:update");
  }
}
