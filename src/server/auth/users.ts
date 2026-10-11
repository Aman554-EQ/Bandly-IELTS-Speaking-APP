/**
 * Users, roles, profile and audit log in the database. Clerk owns sign-in and
 * credentials; this module owns everything else (database-integration.md §4.1, §7).
 * Takes the database as a parameter (no Clerk or Next.js imports), so scripts,
 * webhooks and tests share the same rules.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db/client";
import { auditLogs, roles, userRoles, users, webhookEvents } from "@/server/db/schema";
import {
  type AppUser,
  can,
  checkRoleChange,
  DENIAL_MESSAGES,
  type Denial,
  type RoleChange,
  type RoleKey,
} from "./policy";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Conn = Db | Tx;

/** The parts of a Clerk user we keep (from the Backend API or a webhook payload). */
export interface ClerkUserLite {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
}

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

// ------------------------------------------------------------------ audit

export async function writeAudit(
  conn: Conn,
  entry: {
    actorUserId: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    before?: unknown;
    after?: unknown;
    meta?: RequestMeta;
  },
): Promise<void> {
  await conn.insert(auditLogs).values({
    actorUserId: entry.actorUserId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ipAddress: entry.meta?.ip ?? null,
    userAgent: entry.meta?.userAgent?.slice(0, 300) ?? null,
  });
}

// ------------------------------------------------------------------ users

async function roleId(conn: Conn, key: RoleKey): Promise<string> {
  const [r] = await conn.select({ id: roles.id }).from(roles).where(eq(roles.key, key));
  if (!r) throw new Error(`Role "${key}" is missing. Run \`pnpm db:seed\`.`);
  return r.id;
}

/** Active (not revoked) roles of a user. */
async function activeRoles(conn: Conn, userId: string): Promise<RoleKey[]> {
  const rows = await conn
    .select({ key: roles.key })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(userRoles.userId, userId), isNull(userRoles.revokedAt)));
  return rows.map((r) => r.key);
}

export async function loadAppUser(conn: Conn, by: { id: string } | { clerkUserId: string }): Promise<AppUser | null> {
  const [u] = await conn
    .select({
      id: users.id,
      clerkUserId: users.clerkUserId,
      email: users.email,
      displayName: users.displayName,
      status: users.status,
    })
    .from(users)
    .where("id" in by ? eq(users.id, by.id) : eq(users.clerkUserId, by.clerkUserId));
  if (!u) return null;
  return { ...u, roles: await activeRoles(conn, u.id) };
}

/** Grants a role if it is not active yet (re-activates a revoked grant). Returns true if it changed. */
export async function grantRoleRow(
  conn: Conn,
  userId: string,
  key: RoleKey,
  grantedBy: string | null,
): Promise<boolean> {
  const rid = await roleId(conn, key);
  const res = await conn
    .insert(userRoles)
    .values({ userId, roleId: rid, grantedBy })
    .onConflictDoUpdate({
      target: [userRoles.userId, userRoles.roleId],
      set: { revokedAt: null, grantedBy, grantedAt: sql`now()` },
      setWhere: sql`${userRoles.revokedAt} IS NOT NULL`,
    })
    .returning({ userId: userRoles.userId });
  return res.length > 0;
}

/**
 * Creates or refreshes the local user for a Clerk user (webhook or first request).
 * New users get the student role. The display name is only set on creation,
 * because the user may edit it later.
 */
export async function upsertUserFromClerk(
  conn: Conn,
  u: ClerkUserLite,
  source: "webhook" | "lazy_sync" | "bootstrap",
): Promise<{ id: string; created: boolean }> {
  const displayName = [u.firstName, u.lastName].filter(Boolean).join(" ") || null;
  const [row] = await conn
    .insert(users)
    .values({ clerkUserId: u.id, email: u.email, displayName, avatarUrl: u.imageUrl })
    .onConflictDoUpdate({
      target: users.clerkUserId,
      set: { email: u.email, avatarUrl: u.imageUrl, updatedAt: sql`now()` },
    })
    .returning({ id: users.id, created: sql<boolean>`(xmax = 0)` });
  if (row.created) {
    await grantRoleRow(conn, row.id, "student", null);
    await writeAudit(conn, {
      actorUserId: null,
      action: "user.created",
      entityType: "user",
      entityId: row.id,
      after: { clerkUserId: u.id, email: u.email, source },
    });
  }
  return row;
}

/** Clerk user deleted: soft delete and anonymise; rows referenced by attempts stay. */
export async function softDeleteUser(conn: Conn, clerkUserId: string): Promise<void> {
  const [u] = await conn
    .update(users)
    .set({
      status: "deleted",
      deletedAt: new Date(),
      email: sql`'deleted+' || ${users.id}::text || '@bandly.invalid'`,
      displayName: null,
      avatarUrl: null,
      bio: null,
    })
    .where(and(eq(users.clerkUserId, clerkUserId), isNull(users.deletedAt)))
    .returning({ id: users.id });
  if (u) await writeAudit(conn, { actorUserId: null, action: "user.deleted", entityType: "user", entityId: u.id });
}

export async function countActiveSuperadmins(conn: Conn): Promise<number> {
  const [r] = await conn
    .select({ n: sql<number>`count(*)::int` })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(eq(roles.key, "superadmin"), isNull(userRoles.revokedAt), eq(users.status, "active")));
  return r.n;
}

export type ChangeResult = { ok: true; user: AppUser } | { ok: false; denial: Denial; message: string };

/**
 * Applies a role or status change with every safeguard, in one transaction.
 * Role changes are serialised (advisory lock), so two superadmins cannot demote
 * each other at the same moment and leave none. Denials are audited too.
 */
export async function changeUserAccess(
  db: Db,
  input: { actor: AppUser; targetId: string; change: RoleChange; meta?: RequestMeta },
): Promise<ChangeResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('bandly:role-changes'))`);
    const actor = (await loadAppUser(tx, { id: input.actor.id })) ?? input.actor; // re-read: roles may have changed
    // Permission first: a user without any user-management right is refused (and audited)
    // before we reveal whether the target exists.
    if (!can(actor, "users.manage_admins")) {
      await writeAudit(tx, {
        actorUserId: actor.id,
        action: `${input.change.kind === "status" ? "user.status" : `role.${input.change.kind}`}.denied`,
        entityType: "user",
        entityId: input.targetId,
        after: { change: input.change, reason: "not_allowed" },
        meta: input.meta,
      });
      return { ok: false, denial: "not_allowed", message: DENIAL_MESSAGES.not_allowed };
    }
    const target = await loadAppUser(tx, { id: input.targetId });
    if (!target) return { ok: false, denial: "not_allowed", message: "User not found." };
    const denial = checkRoleChange({
      actor,
      target,
      change: input.change,
      activeSuperadmins: await countActiveSuperadmins(tx),
    });
    const action =
      input.change.kind === "status" ? "user.status" : input.change.kind === "grant" ? "role.grant" : "role.revoke";

    if (denial) {
      if (denial !== "no_change") {
        await writeAudit(tx, {
          actorUserId: actor.id,
          action: `${action}.denied`,
          entityType: "user",
          entityId: target.id,
          after: { change: input.change, reason: denial },
          meta: input.meta,
        });
      }
      return { ok: false, denial, message: DENIAL_MESSAGES[denial] };
    }

    const before = { roles: target.roles, status: target.status };
    const c = input.change;
    if (c.kind === "status") {
      await tx.update(users).set({ status: c.status }).where(eq(users.id, target.id));
    } else if (c.kind === "grant") {
      await grantRoleRow(tx, target.id, c.role, actor.id);
    } else {
      await tx
        .update(userRoles)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(userRoles.userId, target.id),
            eq(userRoles.roleId, await roleId(tx, c.role)),
            isNull(userRoles.revokedAt),
          ),
        );
    }
    const after = (await loadAppUser(tx, { id: target.id }))!;
    await writeAudit(tx, {
      actorUserId: actor.id,
      action,
      entityType: "user",
      entityId: target.id,
      before,
      after: { roles: after.roles, status: after.status },
      meta: input.meta,
    });
    return { ok: true, user: after };
  });
}

// ---------------------------------------------------------------- profile

export const preferencesSchema = z
  .object({
    theme: z.enum(["light", "white", "dark"]).optional(),
    examinerId: z.enum(["emma", "james"]).optional(),
    fidelity: z.enum(["exam", "guided"]).optional(),
  })
  .strict();

/** Only these fields can be edited by the user; anything else is rejected (§6.3 rule 5). */
export const profileUpdateSchema = z
  .object({
    displayName: z.string().trim().min(1, "Enter a name.").max(80, "Use at most 80 characters.").nullable().optional(),
    bio: z.string().trim().max(500, "Use at most 500 characters.").nullable().optional(),
    preferences: preferencesSchema.optional(),
  })
  .strict();

export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

export interface Profile {
  id: string;
  email: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  preferences: z.infer<typeof preferencesSchema>;
  roles: RoleKey[];
  createdAt: string;
}

export async function getProfile(conn: Conn, userId: string): Promise<Profile | null> {
  const [u] = await conn.select().from(users).where(eq(users.id, userId));
  if (!u) return null;
  const prefs = preferencesSchema.safeParse(u.preferences);
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    bio: u.bio,
    avatarUrl: u.avatarUrl,
    preferences: prefs.success ? prefs.data : {},
    roles: await activeRoles(conn, u.id),
    createdAt: u.createdAt.toISOString(),
  };
}

export async function updateProfile(
  db: Db,
  userId: string,
  input: ProfileUpdate,
  meta?: RequestMeta,
): Promise<Profile> {
  return db.transaction(async (tx) => {
    const before = await getProfile(tx, userId);
    if (!before) throw new Error("User not found");
    const set: Partial<typeof users.$inferInsert> = {};
    if (input.displayName !== undefined) set.displayName = input.displayName;
    if (input.bio !== undefined) set.bio = input.bio || null;
    if (input.preferences !== undefined) set.preferences = { ...before.preferences, ...input.preferences };
    if (Object.keys(set).length) await tx.update(users).set(set).where(eq(users.id, userId));
    const after = (await getProfile(tx, userId))!;
    await writeAudit(tx, {
      actorUserId: userId,
      action: "profile.update",
      entityType: "user",
      entityId: userId,
      before: { displayName: before.displayName, bio: before.bio, preferences: before.preferences },
      after: { displayName: after.displayName, bio: after.bio, preferences: after.preferences },
      meta,
    });
    return after;
  });
}

// --------------------------------------------------------------- webhooks

export interface ClerkEventLite {
  /** Svix message id (svix-id header): the idempotency key. */
  deliveryId: string;
  type: string;
  user?: ClerkUserLite;
  deletedUserId?: string;
}

/** Processes one verified Clerk webhook delivery exactly once. */
export async function handleClerkEvent(db: Db, evt: ClerkEventLite): Promise<"processed" | "duplicate" | "ignored"> {
  return db.transaction(async (tx) => {
    const fresh = await tx
      .insert(webhookEvents)
      .values({ id: evt.deliveryId, source: "clerk", eventType: evt.type })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id });
    if (fresh.length === 0) return "duplicate";
    if ((evt.type === "user.created" || evt.type === "user.updated") && evt.user) {
      await upsertUserFromClerk(tx, evt.user, "webhook");
      return "processed";
    }
    if (evt.type === "user.deleted" && evt.deletedUserId) {
      await softDeleteUser(tx, evt.deletedUserId);
      return "processed";
    }
    return "ignored";
  });
}
