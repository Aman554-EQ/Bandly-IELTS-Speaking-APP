/**
 * One-time (and re-runnable) creation of the first superadmin and the default
 * admin (database-integration.md §8). Credentials stay in Clerk: accounts are
 * created without a password and the owner sets one with "Forgot password?".
 * Nothing secret is stored, printed or logged here.
 */
import { z } from "zod";
import type { Db } from "@/server/db/client";
import type { RoleKey } from "./policy";
import { type ClerkUserLite, grantRoleRow, loadAppUser, upsertUserFromClerk, writeAudit } from "./users";
import { users } from "@/server/db/schema";
import { eq } from "drizzle-orm";

/** The two Clerk Backend API calls bootstrap needs (a fake is used in tests). */
export interface ClerkAdminApi {
  findUserByEmail(email: string): Promise<ClerkUserLite | null>;
  createUser(email: string): Promise<ClerkUserLite>;
}

export class BootstrapError extends Error {}

export interface BootstrapResult {
  email: string;
  role: RoleKey;
  clerk: "found" | "created";
  roleGranted: boolean;
  reactivated: boolean;
}

const email = z.email().transform((e) => e.trim().toLowerCase());

/** Production = a live Clerk key or NODE_ENV=production. Requires --confirm-production. */
export function isProductionTarget(env: { NODE_ENV?: string; CLERK_SECRET_KEY?: string }): boolean {
  return env.NODE_ENV === "production" || Boolean(env.CLERK_SECRET_KEY?.startsWith("sk_live_"));
}

export async function bootstrapAdmins(
  db: Db,
  clerk: ClerkAdminApi,
  input: { superadminEmail?: string; adminEmail?: string; production: boolean; confirmProduction: boolean },
): Promise<BootstrapResult[]> {
  if (input.production && !input.confirmProduction) {
    throw new BootstrapError("Refusing to bootstrap a production instance without --confirm-production.");
  }
  const wanted: { email: string; role: RoleKey }[] = [];
  for (const [value, role] of [
    [input.superadminEmail, "superadmin"],
    [input.adminEmail, "admin"],
  ] as const) {
    if (!value) continue;
    const parsed = email.safeParse(value);
    if (!parsed.success)
      throw new BootstrapError(`BOOTSTRAP_${role.toUpperCase()}_EMAIL is not a valid email address.`);
    wanted.push({ email: parsed.data, role });
  }
  if (wanted.length === 0) {
    throw new BootstrapError("Set BOOTSTRAP_SUPERADMIN_EMAIL and/or BOOTSTRAP_ADMIN_EMAIL in .env.local.");
  }
  if (wanted.length === 2 && wanted[0].email === wanted[1].email) {
    throw new BootstrapError("Use two different emails for the superadmin and the admin.");
  }

  const out: BootstrapResult[] = [];
  for (const w of wanted) {
    // Clerk first (outside the transaction: it is an external call).
    let clerkUser = await clerk.findUserByEmail(w.email);
    const clerkState: BootstrapResult["clerk"] = clerkUser ? "found" : "created";
    clerkUser ??= await clerk.createUser(w.email);

    const result = await db.transaction(async (tx) => {
      const { id } = await upsertUserFromClerk(tx, clerkUser, "bootstrap");
      const user = (await loadAppUser(tx, { id }))!;
      // Recovery: a suspended bootstrap account is reactivated (never a deleted one).
      let reactivated = false;
      if (user.status === "suspended") {
        await tx.update(users).set({ status: "active" }).where(eq(users.id, id));
        reactivated = true;
      }
      if (user.status === "deleted") throw new BootstrapError(`${w.email} belongs to a deleted account.`);
      const roleGranted = await grantRoleRow(tx, id, w.role, null);
      if (roleGranted || reactivated || clerkState === "created") {
        await writeAudit(tx, {
          actorUserId: null,
          action: `bootstrap.${w.role}`,
          entityType: "user",
          entityId: id,
          after: { email: w.email, role: w.role, clerk: clerkState, roleGranted, reactivated },
        });
      }
      return { roleGranted, reactivated };
    });
    out.push({ email: w.email, role: w.role, clerk: clerkState, ...result });
  }
  return out;
}
