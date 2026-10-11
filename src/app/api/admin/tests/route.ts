import { firstIssue } from "@/content/ops-common";
import { testOp } from "@/content/test-ops";
import { requestMeta, requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { applyTestOp } from "@/server/db/tests-admin";
import { errorResponse } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";

/**
 * POST /api/admin/tests: one test or book change, e.g. { "op": "topic.create", "testId": "…", "part": 1, "title": "Hometown", "intro": "Let's talk about your hometown." }
 * Validated with the same Zod schema the admin forms use (src/content/test-ops.ts).
 * Permission (content.manage), the transaction, safe delete and the audit log
 * live in `applyTestOp`. Errors: 400 (with `problems` when publishing), 401, 403, 404, 409.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const rl = rateLimit(`content:${user.id}`, 240, 10 * 60_000);
    if (!rl.ok) return Response.json({ error: "Too many changes. Please wait a few minutes." }, { status: 429 });
    const parsed = testOp.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: firstIssue(parsed.error) }, { status: 400 });
    return Response.json(await applyTestOp(getDb(), user, parsed.data, requestMeta(req)));
  } catch (e) {
    return errorResponse(e, "admin:tests");
  }
}
