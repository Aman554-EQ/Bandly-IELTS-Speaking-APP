/**
 * Read queries for the admin and superadmin pages. Callers check permissions first.
 * Lists use cursor pagination on (created_at DESC, id DESC) in SQL (§15.1).
 */
import { and, desc, eq, ilike, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { auditLogs, collections, exams, modules, questions, roles, userRoles, users } from "@/server/db/schema";
import type { RoleKey, UserStatus } from "./policy";

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export const MAX_PAGE = 100;

function encodeCursor(createdAt: Date, id: string | number): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");
}

function decodeCursor(cursor: string | null | undefined): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const createdAt = new Date(iso);
  return id && !Number.isNaN(createdAt.getTime()) ? { createdAt, id } : null;
}

export interface UserRow {
  id: string;
  email: string;
  displayName: string | null;
  status: UserStatus;
  roles: RoleKey[];
  createdAt: string;
  lastSeenAt: string | null;
}

/** Users, newest first; optional search on email or name. */
export async function listUsers(
  db: Db,
  opts: { cursor?: string | null; q?: string | null; limit?: number } = {},
): Promise<Page<UserRow>> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), MAX_PAGE);
  const c = decodeCursor(opts.cursor);
  const q = opts.q?.trim();
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      status: users.status,
      createdAt: users.createdAt,
      lastSeenAt: users.lastSeenAt,
      roles: sql<
        RoleKey[]
        // ::text[] matters: node-postgres cannot parse arrays of a custom enum and would return "{a,b}" as a string.
      >`coalesce(array_agg(${roles.key}::text ORDER BY ${roles.rank} DESC) FILTER (WHERE ${roles.key} IS NOT NULL), '{}'::text[])`,
    })
    .from(users)
    .leftJoin(userRoles, and(eq(userRoles.userId, users.id), isNull(userRoles.revokedAt)))
    .leftJoin(roles, eq(roles.id, userRoles.roleId))
    .where(
      and(
        q ? or(ilike(users.email, `%${q}%`), ilike(users.displayName, `%${q}%`)) : undefined,
        c ? or(lt(users.createdAt, c.createdAt), and(eq(users.createdAt, c.createdAt), lt(users.id, c.id))) : undefined,
      ),
    )
    .groupBy(users.id)
    .orderBy(desc(users.createdAt), desc(users.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items: items.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
    })),
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    hasMore,
  };
}

export interface AuditRow {
  id: number;
  createdAt: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorEmail: string | null;
  after: unknown;
}

export async function listAudit(
  db: Db,
  opts: { cursor?: string | null; limit?: number } = {},
): Promise<Page<AuditRow>> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), MAX_PAGE);
  const c = decodeCursor(opts.cursor);
  const rows = await db
    .select({
      id: auditLogs.id,
      createdAt: auditLogs.createdAt,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      actorEmail: users.email,
      after: auditLogs.after,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(
      c
        ? or(
            lt(auditLogs.createdAt, c.createdAt),
            and(eq(auditLogs.createdAt, c.createdAt), lt(auditLogs.id, Number(c.id))),
          )
        : undefined,
    )
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items: items.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    hasMore,
  };
}

export async function platformCounts(db: Db) {
  const [r] = await db
    .execute<{
      users: number;
      students: number;
      admins: number;
      superadmins: number;
      attempts: number;
      scored: number;
    }>(
      sql`
    SELECT
      (SELECT count(*)::int FROM users WHERE deleted_at IS NULL) AS users,
      (SELECT count(DISTINCT ur.user_id)::int FROM user_roles ur JOIN roles r ON r.id = ur.role_id
         WHERE r.key = 'student' AND ur.revoked_at IS NULL) AS students,
      (SELECT count(DISTINCT ur.user_id)::int FROM user_roles ur JOIN roles r ON r.id = ur.role_id
         WHERE r.key = 'admin' AND ur.revoked_at IS NULL) AS admins,
      (SELECT count(DISTINCT ur.user_id)::int FROM user_roles ur JOIN roles r ON r.id = ur.role_id
         WHERE r.key = 'superadmin' AND ur.revoked_at IS NULL) AS superadmins,
      (SELECT count(*)::int FROM exam_attempts) AS attempts,
      (SELECT count(*)::int FROM exam_attempts WHERE status = 'scored') AS scored`,
    )
    .then((x) => x.rows);
  return r;
}

export async function contentCounts(db: Db) {
  const count = async (t: typeof modules | typeof collections | typeof exams | typeof questions) =>
    (
      await db
        .select({ n: sql<number>`count(*)::int` })
        .from(t)
        .where(isNull(t.deletedAt))
    )[0].n;
  return {
    modules: await count(modules),
    collections: await count(collections),
    exams: await count(exams),
    questions: await count(questions),
  };
}
