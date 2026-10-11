/** Newsletter sign-ups (footer form). */
import { sql } from "drizzle-orm";
import type { Db } from "./client";
import { newsletterSubscribers } from "./schema";

/** Adds (or re-activates) a subscriber. Returns true if this address is new. */
export async function subscribe(
  db: Db,
  input: { email: string; source?: string; userId?: string | null },
): Promise<boolean> {
  const email = input.email.trim().toLowerCase();
  const rows = await db
    .insert(newsletterSubscribers)
    .values({ email, source: input.source ?? "footer", userId: input.userId ?? null })
    .onConflictDoUpdate({
      target: newsletterSubscribers.email,
      set: { unsubscribedAt: null },
    })
    .returning({ isNew: sql<boolean>`(xmax = 0)` });
  return rows[0]?.isNew ?? false;
}
