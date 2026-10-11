import { describe, expect, it } from "vitest";
import { type AppUser, can, checkRoleChange, homeFor, type RoleKey } from "./policy";

const user = (id: string, roles: RoleKey[], status: AppUser["status"] = "active") => ({ id, roles, status });
const student = user("s", ["student"]);
const admin = user("a", ["student", "admin"]);
const superadmin = user("x", ["student", "superadmin"]);
const otherSuper = user("y", ["student", "superadmin"]);

describe("permission matrix", () => {
  it("visitors and suspended users can do nothing", () => {
    expect(can(null, "exam.take")).toBe(false);
    expect(can(user("z", ["student", "superadmin"], "suspended"), "exam.take")).toBe(false);
    expect(can(user("z", ["student"], "deleted"), "result.view_own")).toBe(false);
  });

  it("students take tests but never manage content or users", () => {
    expect(can(student, "exam.take")).toBe(true);
    expect(can(student, "content.manage")).toBe(false);
    expect(can(student, "users.list")).toBe(false);
  });

  it("admins manage content but not users or platform analytics", () => {
    expect(can(admin, "content.manage")).toBe(true);
    expect(can(admin, "users.manage_admins")).toBe(false);
    expect(can(admin, "analytics.platform")).toBe(false);
  });

  it("superadmins manage users and audit, and content is not a routine duty", () => {
    expect(can(superadmin, "users.manage_superadmins")).toBe(true);
    expect(can(superadmin, "audit.view")).toBe(true);
    expect(can(superadmin, "content.manage")).toBe(false);
    expect(can(superadmin, "content.preview")).toBe(true);
  });

  it("lands each role on its own home page", () => {
    expect(homeFor(student)).toBe("/dashboard");
    expect(homeFor(admin)).toBe("/admin");
    expect(homeFor(superadmin)).toBe("/superadmin");
  });
});

describe("escalation safeguards", () => {
  const check = (
    actor: typeof student,
    target: typeof student,
    change: Parameters<typeof checkRoleChange>[0]["change"],
    n = 2,
  ) => checkRoleChange({ actor, target, change, activeSuperadmins: n });

  it("an admin cannot grant superadmin, or any role", () => {
    expect(check(admin, student, { kind: "grant", role: "superadmin" })).toBe("not_allowed");
    expect(check(admin, student, { kind: "grant", role: "admin" })).toBe("not_allowed");
  });

  it("nobody can change their own role or status", () => {
    expect(check(superadmin, superadmin, { kind: "revoke", role: "superadmin" })).toBe("self_change");
    expect(check(superadmin, superadmin, { kind: "status", status: "suspended" })).toBe("self_change");
  });

  it("the last active superadmin cannot be demoted or suspended", () => {
    const lone = user("y", ["student", "superadmin"]);
    expect(check(superadmin, lone, { kind: "revoke", role: "superadmin" }, 1)).toBe("last_superadmin");
    expect(check(superadmin, lone, { kind: "status", status: "suspended" }, 1)).toBe("last_superadmin");
    expect(check(superadmin, otherSuper, { kind: "revoke", role: "superadmin" }, 2)).toBeNull();
  });

  it("the student role is fixed and repeated changes are no-ops", () => {
    expect(check(superadmin, student, { kind: "revoke", role: "student" })).toBe("student_role_fixed");
    expect(check(superadmin, admin, { kind: "grant", role: "admin" })).toBe("no_change");
    expect(check(superadmin, student, { kind: "status", status: "active" })).toBe("no_change");
  });

  it("a superadmin can promote, demote and suspend other users", () => {
    expect(check(superadmin, student, { kind: "grant", role: "admin" })).toBeNull();
    expect(check(superadmin, admin, { kind: "revoke", role: "admin" })).toBeNull();
    expect(check(superadmin, student, { kind: "status", status: "suspended" })).toBeNull();
    expect(check(superadmin, student, { kind: "grant", role: "superadmin" })).toBeNull();
  });

  it("a suspended superadmin cannot act", () => {
    expect(check(user("x", ["superadmin"], "suspended"), student, { kind: "grant", role: "admin" })).toBe(
      "not_allowed",
    );
  });
});
