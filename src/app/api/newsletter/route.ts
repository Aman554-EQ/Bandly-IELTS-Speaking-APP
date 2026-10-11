import { z } from "zod";
import { getDb } from "@/server/db/client";
import { subscribe } from "@/server/db/newsletter";
import { errorResponse } from "@/server/http";
import { clientKey, rateLimit } from "@/server/rate-limit";

const body = z
  .object({
    email: z.email("Enter a valid email address.").max(254),
    source: z.enum(["footer"]).optional(),
    /** Honeypot: real people leave it empty. */
    company: z.string().max(0).optional(),
  })
  .strict();

/**
 * POST /api/newsletter { email }: footer sign-up, no account needed.
 * The answer is the same for new and existing addresses (no address probing).
 */
export async function POST(req: Request) {
  try {
    const rl = rateLimit(`newsletter:${clientKey(req)}`, 5, 10 * 60_000);
    if (!rl.ok) return Response.json({ error: "Too many tries. Please wait a few minutes." }, { status: 429 });
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    await subscribe(getDb(), { email: parsed.data.email, source: parsed.data.source });
    return Response.json({ ok: true, message: "Thanks! You're on the list." });
  } catch (e) {
    return errorResponse(e, "newsletter");
  }
}
