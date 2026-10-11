/**
 * Authorization, user sync, webhooks, profile and bootstrap against a real
 * PostgreSQL (`bandly_test`). Run with `pnpm test:db` after `pnpm db:up`.
 */
import { and, eq, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapAdmins, type ClerkAdminApi, isProductionTarget } from "@/server/auth/bootstrap";
import {
  changeUserAccess,
  type ClerkUserLite,
  grantRoleRow,
  handleClerkEvent,
  loadAppUser,
  profileUpdateSchema,
  updateProfile,
  upsertUserFromClerk,
} from "@/server/auth/users";
import type { AppUser } from "@/server/auth/policy";
import { closeDb, type Db } from "@/server/db/client";
import { auditLogs, examAttempts, userRoles, users } from "@/server/db/schema";
import { claimGuestAttempts } from "@/server/db/seed";
import { listAudit, listUsers } from "@/server/auth/admin-queries";
import { resetDatabase, pointAtTestDatabase } from "./helpers";

pointAtTestDatabase();
const repo = await import("@/server/db/repo");

let db: Db;
let sampleExamId: string;
let guestId: string;

const clerkUser = (n: string, extra: Partial<ClerkUserLite> = {}): ClerkUserLite => ({
  id: `user_${n}`,
  email: `${n}@example.com`,
  firstName: n,
  lastName: null,
  imageUrl: null,
  ...extra,
});

async function makeUser(n: string, ...roles: ("admin" | "superadmin")[]): Promise<AppUser> {
  const { id } = await upsertUserFromClerk(db, clerkUser(n), "lazy_sync");
  for (const r of roles) await grantRoleRow(db, id, r, null);
  return (await loadAppUser(db, { id }))!;
}

const auditCount = async (action: string) =>
  (
    await db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(eq(auditLogs.action, action))
  )[0].n;

beforeAll(async () => {
  const r = await resetDatabase();
  db = r.db;
  sampleExamId = r.sampleExamId;
  guestId = r.localUserId;
}, 60_000);

afterAll(async () => {
  await closeDb();
});

describe("user sync (lazy sync and webhooks)", () => {
  it("a new user gets exactly the student role, once", async () => {
    const a = await upsertUserFromClerk(db, clerkUser("ann"), "lazy_sync");
    const b = await upsertUserFromClerk(db, clerkUser("ann", { imageUrl: "https://img/x.png" }), "webhook");
    expect(a.created).toBe(true);
    expect(b).toEqual({ id: a.id, created: false });
    expect((await loadAppUser(db, { id: a.id }))!.roles).toEqual(["student"]);
  });

  it("a webhook delivered twice is processed once", async () => {
    const evt = { deliveryId: "msg_1", type: "user.created", user: clerkUser("bob") };
    expect(await handleClerkEvent(db, evt)).toBe("processed");
    expect(await handleClerkEvent(db, evt)).toBe("duplicate");
    const rows = await db.select().from(users).where(eq(users.clerkUserId, "user_bob"));
    expect(rows).toHaveLength(1);
    expect((await loadAppUser(db, { id: rows[0].id }))!.roles).toEqual(["student"]);
  });

  it("an edited display name survives later Clerk updates", async () => {
    const u = await loadAppUser(db, { clerkUserId: "user_bob" });
    await updateProfile(db, u!.id, { displayName: "Bobby" });
    await handleClerkEvent(db, {
      deliveryId: "msg_2",
      type: "user.updated",
      user: clerkUser("bob", { firstName: "Robert" }),
    });
    expect((await loadAppUser(db, { id: u!.id }))!.displayName).toBe("Bobby");
  });

  it("user.deleted soft-deletes and anonymises, keeping the row for history", async () => {
    await handleClerkEvent(db, { deliveryId: "msg_3", type: "user.deleted", deletedUserId: "user_bob" });
    const [row] = await db.select().from(users).where(eq(users.clerkUserId, "user_bob"));
    expect(row.status).toBe("deleted");
    expect(row.deletedAt).not.toBeNull();
    expect(row.email).toMatch(/^deleted\+.+@bandly\.invalid$/);
    expect(row.displayName).toBeNull();
  });
});

describe("role and status changes (escalation safeguards)", () => {
  let boss: AppUser;
  let admin: AppUser;
  let student: AppUser;

  beforeAll(async () => {
    boss = await makeUser("boss", "superadmin");
    admin = await makeUser("adam", "admin");
    student = await makeUser("stu");
  });

  it("an admin cannot grant superadmin; the attempt is denied and audited", async () => {
    const r = await changeUserAccess(db, {
      actor: admin,
      targetId: student.id,
      change: { kind: "grant", role: "superadmin" },
    });
    expect(r).toMatchObject({ ok: false, denial: "not_allowed" });
    expect((await loadAppUser(db, { id: student.id }))!.roles).toEqual(["student"]);
    expect(await auditCount("role.grant.denied")).toBe(1);
  });

  it("a student probing an unknown user id is refused (not told 'not found') and audited", async () => {
    const before = await auditCount("role.grant.denied");
    const r = await changeUserAccess(db, {
      actor: student,
      targetId: "0192f000-0000-7000-8000-000000000000",
      change: { kind: "grant", role: "superadmin" },
    });
    expect(r).toMatchObject({ ok: false, denial: "not_allowed" });
    expect(await auditCount("role.grant.denied")).toBe(before + 1);
  });

  it("the only superadmin cannot demote themselves; denied and audited", async () => {
    const r = await changeUserAccess(db, {
      actor: boss,
      targetId: boss.id,
      change: { kind: "revoke", role: "superadmin" },
    });
    expect(r).toMatchObject({ ok: false, denial: "self_change" });
    expect((await loadAppUser(db, { id: boss.id }))!.roles).toContain("superadmin");
    expect(await auditCount("role.revoke.denied")).toBe(1);
  });

  it("a superadmin can make a student an admin, and it is audited with before/after", async () => {
    const r = await changeUserAccess(db, {
      actor: boss,
      targetId: student.id,
      change: { kind: "grant", role: "admin" },
    });
    expect(r.ok).toBe(true);
    const [log] = await db.select().from(auditLogs).where(eq(auditLogs.action, "role.grant"));
    expect(log.actorUserId).toBe(boss.id);
    expect(log.before).toMatchObject({ roles: ["student"] });
  });

  it("a role revoked and granted again reuses the same row", async () => {
    await changeUserAccess(db, { actor: boss, targetId: student.id, change: { kind: "revoke", role: "admin" } });
    await changeUserAccess(db, { actor: boss, targetId: student.id, change: { kind: "grant", role: "admin" } });
    const rows = await db.select().from(userRoles).where(eq(userRoles.userId, student.id));
    expect(rows).toHaveLength(2); // student + admin
    expect(rows.every((r) => r.revokedAt === null)).toBe(true);
  });

  it("two superadmins demoting each other at once leave one superadmin", async () => {
    const other = await makeUser("otto", "superadmin");
    const results = await Promise.all([
      changeUserAccess(db, { actor: boss, targetId: other.id, change: { kind: "revoke", role: "superadmin" } }),
      changeUserAccess(db, { actor: other, targetId: boss.id, change: { kind: "revoke", role: "superadmin" } }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const supers = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM user_roles ur JOIN roles r ON r.id = ur.role_id
      WHERE r.key = 'superadmin' AND ur.revoked_at IS NULL`);
    expect(supers.rows[0].n).toBe(1);
  });

  it("a suspended user is denied everything until reactivated", async () => {
    const sb = (await loadAppUser(db, { clerkUserId: "user_boss" }))!.roles.includes("superadmin")
      ? boss
      : (await loadAppUser(db, { clerkUserId: "user_otto" }))!;
    const target = await makeUser("sue");
    expect(
      (await changeUserAccess(db, { actor: sb, targetId: target.id, change: { kind: "status", status: "suspended" } }))
        .ok,
    ).toBe(true);
    const suspended = (await loadAppUser(db, { id: target.id }))!;
    expect(suspended.status).toBe("suspended");
    const r = await changeUserAccess(db, {
      actor: suspended,
      targetId: student.id,
      change: { kind: "grant", role: "admin" },
    });
    expect(r).toMatchObject({ ok: false, denial: "not_allowed" });
  });
});

describe("superadmin lists", () => {
  it("users come back with roles as real arrays, highest role first", async () => {
    const boss = await loadAppUser(db, { clerkUserId: "user_boss" });
    const page = await listUsers(db, { q: "boss@" });
    expect(page.items).toHaveLength(1);
    expect(Array.isArray(page.items[0].roles)).toBe(true);
    expect(page.items[0].roles).toEqual(boss!.roles.includes("superadmin") ? ["superadmin", "student"] : ["student"]);
  });

  it("cursor pagination walks every user once, newest first", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const p = await listUsers(db, { cursor, limit: 2 });
      seen.push(...p.items.map((u) => u.id));
      cursor = p.nextCursor;
    } while (cursor);
    const all = await db.select({ id: users.id }).from(users);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe(all.length);
  });

  it("the audit log pages without repeats", async () => {
    const first = await listAudit(db, { limit: 3 });
    const second = await listAudit(db, { limit: 3, cursor: first.nextCursor });
    expect(first.items).toHaveLength(3);
    expect(second.items.some((a) => first.items.some((b) => b.id === a.id))).toBe(false);
  });
});

describe("profile updates", () => {
  it("accepts only display name, bio and preferences", () => {
    expect(
      profileUpdateSchema.safeParse({ displayName: "Ann", bio: "Hi", preferences: { examinerId: "james" } }).success,
    ).toBe(true);
    for (const bad of [
      { role: "admin" },
      { email: "x@y.z" },
      { status: "active" },
      { clerkUserId: "u" },
      { preferences: { isAdmin: true } },
    ]) {
      expect(profileUpdateSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("saves allowed fields, merges preferences and audits the change", async () => {
    const u = await makeUser("pam");
    await updateProfile(db, u.id, { preferences: { examinerId: "james" } });
    const p = await updateProfile(db, u.id, { bio: "Teacher", preferences: { fidelity: "guided" } });
    expect(p.bio).toBe("Teacher");
    expect(p.preferences).toEqual({ examinerId: "james", fidelity: "guided" });
    expect(p.roles).toEqual(["student"]);
    expect(await auditCount("profile.update")).toBeGreaterThanOrEqual(2);
  });
});

describe("attempt ownership", () => {
  it("another user's attempt looks missing (404), and lists are per user", async () => {
    const alice = await makeUser("alice");
    const eve = await makeUser("eve");
    const set = await repo.getQuestionSet(sampleExamId);
    const s = await repo.createSession({ userId: alice.id, mode: "part1", fidelity: "exam", examinerId: "emma", set });
    expect(await repo.getSession(s.id, alice.id)).not.toBeNull();
    expect(await repo.getSession(s.id, eve.id)).toBeNull();
    expect(await repo.ownsSession(s.id, eve.id)).toBe(false);
    expect((await repo.listSessions(eve.id)).map((x) => x.id)).not.toContain(s.id);
    expect((await repo.listSessions(alice.id)).map((x) => x.id)).toContain(s.id);
  });

  it("guest attempts can be claimed by a real account", async () => {
    const set = await repo.getQuestionSet(sampleExamId);
    await repo.createSession({ userId: guestId, mode: "part2", fidelity: "exam", examinerId: "emma", set });
    await makeUser("claire");
    const moved = await claimGuestAttempts(db, "CLAIRE@example.com");
    expect(moved.attempts).toBeGreaterThanOrEqual(1);
    const left = await db.select().from(examAttempts).where(eq(examAttempts.userId, guestId));
    expect(left).toHaveLength(0);
    await expect(claimGuestAttempts(db, "nobody@example.com")).rejects.toThrow(/Sign in once/);
  });
});

describe("bootstrap", () => {
  function fakeClerk() {
    const store = new Map<string, ClerkUserLite>();
    let created = 0;
    const api: ClerkAdminApi = {
      async findUserByEmail(email) {
        return store.get(email) ?? null;
      },
      async createUser(email) {
        created++;
        const u = { id: `user_boot_${created}`, email, firstName: null, lastName: null, imageUrl: null };
        store.set(email, u);
        return u;
      },
    };
    return { api, created: () => created };
  }
  const input = {
    superadminEmail: "Owner@Example.com",
    adminEmail: "editor@example.com",
    production: false,
    confirmProduction: false,
  };

  it("creates both accounts with their roles, and a second run changes nothing", async () => {
    const clerk = fakeClerk();
    const first = await bootstrapAdmins(db, clerk.api, input);
    expect(first.map((r) => [r.email, r.role, r.clerk, r.roleGranted])).toEqual([
      ["owner@example.com", "superadmin", "created", true],
      ["editor@example.com", "admin", "created", true],
    ]);
    const auditBefore = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(like(auditLogs.action, "bootstrap.%"));
    const second = await bootstrapAdmins(db, clerk.api, input);
    expect(second.every((r) => r.clerk === "found" && !r.roleGranted && !r.reactivated)).toBe(true);
    expect(clerk.created()).toBe(2);
    const auditAfter = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(like(auditLogs.action, "bootstrap.%"));
    expect(auditAfter[0].n).toBe(auditBefore[0].n);
    const owner = await loadAppUser(db, { clerkUserId: "user_boot_1" });
    expect(owner!.roles.sort()).toEqual(["student", "superadmin"]);
    const [log] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "bootstrap.superadmin")));
    expect(log.actorUserId).toBeNull();
  });

  it("re-running reactivates a suspended bootstrap superadmin (recovery)", async () => {
    const clerk = fakeClerk();
    await bootstrapAdmins(db, clerk.api, input);
    await db.update(users).set({ status: "suspended" }).where(eq(users.clerkUserId, "user_boot_1"));
    const r = await bootstrapAdmins(db, clerk.api, { ...input, adminEmail: undefined });
    expect(r[0].reactivated).toBe(true);
    expect((await loadAppUser(db, { clerkUserId: "user_boot_1" }))!.status).toBe("active");
  });

  it("refuses production without --confirm-production, and bad input", async () => {
    const clerk = fakeClerk();
    expect(isProductionTarget({ CLERK_SECRET_KEY: "sk_live_abc" })).toBe(true);
    expect(isProductionTarget({ CLERK_SECRET_KEY: "sk_test_abc", NODE_ENV: "development" })).toBe(false);
    await expect(bootstrapAdmins(db, clerk.api, { ...input, production: true })).rejects.toThrow(/confirm-production/);
    await expect(bootstrapAdmins(db, clerk.api, { ...input, superadminEmail: "not-an-email" })).rejects.toThrow(
      /valid email/,
    );
    await expect(bootstrapAdmins(db, clerk.api, { ...input, adminEmail: "owner@example.com" })).rejects.toThrow(
      /two different/,
    );
    expect(clerk.created()).toBe(0);
  });
});
