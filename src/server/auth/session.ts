import "server-only";
import { auth, clerkClient, type User } from "@clerk/nextjs/server";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { type Action, type AppUser, can } from "./policy";
import { type ClerkUserLite, loadAppUser, type RequestMeta, upsertUserFromClerk } from "./users";

/**
 * The signed-in user for this request, from the database (roles and status are
 * never taken from the client or from Clerk metadata).
 *
 * Lazy sync: if the Clerk webhook has not created the local user yet, it is
 * created here from the Clerk Backend API, so nobody is ever stuck.
 */

export class AuthError extends Error {
  constructor(
    readonly status: 401 | 403 | 404,
    message: string,
  ) {
    super(message);
  }
}

export function clerkUserToLite(u: User): ClerkUserLite {
  const email = u.primaryEmailAddress?.emailAddress ?? u.emailAddresses[0]?.emailAddress;
  if (!email) throw new Error("This Clerk account has no email address.");
  return { id: u.id, email, firstName: u.firstName, lastName: u.lastName, imageUrl: u.imageUrl || null };
}

const LAST_SEEN_EVERY_MS = 5 * 60_000;

export const getCurrentUser = cache(async (): Promise<AppUser | null> => {
  const { userId } = await auth();
  if (!userId) return null;
  const db = getDb();
  let user = await loadAppUser(db, { clerkUserId: userId });
  if (!user) {
    const clerk = await clerkClient();
    await upsertUserFromClerk(db, clerkUserToLite(await clerk.users.getUser(userId)), "lazy_sync");
    user = await loadAppUser(db, { clerkUserId: userId });
  }
  if (user) {
    // Throttled "last seen" (at most one write every 5 minutes).
    await db
      .update(users)
      .set({ lastSeenAt: sql`now()` })
      .where(
        and(
          eq(users.id, user.id),
          or(
            isNull(users.lastSeenAt),
            lt(users.lastSeenAt, sql`now() - ${`${LAST_SEEN_EVERY_MS} milliseconds`}::interval`),
          ),
        ),
      );
  }
  return user;
});

/** For API routes: the active user, or an AuthError (401 signed out, 403 suspended). */
export async function requireUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError(401, "Please sign in.");
  if (user.status !== "active") throw new AuthError(403, "This account is suspended. Contact an administrator.");
  return user;
}

/** For API routes: the user if allowed to perform `action`, else 403. */
export async function requirePermission(action: Action): Promise<AppUser> {
  const user = await requireUser();
  if (!can(user, action)) throw new AuthError(403, "You do not have permission to do this.");
  return user;
}

/** For pages: signed-out users go to sign-in (the proxy normally did this already); suspended ones see a notice. */
export async function requirePageUser(returnTo: string): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/sign-in?redirect_url=${encodeURIComponent(returnTo)}`);
  if (user.status !== "active") redirect("/account-suspended");
  return user;
}

/** For pages: users without the permission get a 404 (the page's existence is not revealed). */
export async function requirePagePermission(action: Action, returnTo: string): Promise<AppUser> {
  const user = await requirePageUser(returnTo);
  if (!can(user, action)) notFound();
  return user;
}

export function requestMeta(req: Request): RequestMeta {
  return {
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip"),
    userAgent: req.headers.get("user-agent"),
  };
}
