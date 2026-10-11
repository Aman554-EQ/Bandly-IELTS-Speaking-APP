/**
 * Role-based access control: the permission matrix (database-integration.md §6.2)
 * as data, plus pure checks. No I/O here, so every rule is unit-testable.
 * Server code decides with `can()`. Hiding UI is cosmetic only.
 */

export type RoleKey = "superadmin" | "admin" | "student";
export type UserStatus = "active" | "suspended" | "deleted";

export const ROLE_RANK: Record<RoleKey, number> = { superadmin: 100, admin: 50, student: 10 };

/** The signed-in user as the server sees it (roles always come from the database). */
export interface AppUser {
  id: string;
  clerkUserId: string;
  email: string;
  displayName: string | null;
  status: UserStatus;
  roles: RoleKey[];
}

export type Action =
  | "exam.take" // start/submit tests, save progress
  | "result.view_own"
  | "profile.edit_own"
  | "content.manage" // modules, collections, exams, sections, questions
  | "content.preview" // unpublished content
  | "analytics.content" // scoped content analytics
  | "analytics.platform"
  | "users.list"
  | "users.manage_admins" // create, promote, demote, deactivate admins
  | "users.manage_superadmins"
  | "audit.view";

/** Which roles may perform each action. Visitors (not signed in) may do none of these. */
export const PERMISSIONS: Record<Action, readonly RoleKey[]> = {
  "exam.take": ["student", "admin", "superadmin"],
  "result.view_own": ["student", "admin", "superadmin"],
  "profile.edit_own": ["student", "admin", "superadmin"],
  "content.manage": ["admin"],
  "content.preview": ["admin", "superadmin"],
  "analytics.content": ["admin", "superadmin"],
  "analytics.platform": ["superadmin"],
  "users.list": ["superadmin"],
  "users.manage_admins": ["superadmin"],
  "users.manage_superadmins": ["superadmin"],
  "audit.view": ["superadmin"],
};

export function hasRole(user: Pick<AppUser, "roles">, role: RoleKey): boolean {
  return user.roles.includes(role);
}

/** True if the (active) user may perform the action. Suspended or deleted users may do nothing. */
export function can(user: Pick<AppUser, "roles" | "status"> | null, action: Action): boolean {
  if (!user || user.status !== "active") return false;
  return PERMISSIONS[action].some((r) => user.roles.includes(r));
}

/** Highest role, used for the landing page after sign-in. */
export function primaryRole(user: Pick<AppUser, "roles">): RoleKey {
  return [...user.roles].sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a])[0] ?? "student";
}

export function homeFor(user: Pick<AppUser, "roles">): "/superadmin" | "/admin" | "/dashboard" {
  const r = primaryRole(user);
  return r === "superadmin" ? "/superadmin" : r === "admin" ? "/admin" : "/dashboard";
}

// ------------------------------------------------- escalation safeguards

export type RoleChange = { kind: "grant" | "revoke"; role: RoleKey } | { kind: "status"; status: UserStatus };

export type Denial =
  "not_allowed" | "self_change" | "student_role_fixed" | "last_superadmin" | "target_deleted" | "no_change";

export const DENIAL_MESSAGES: Record<Denial, string> = {
  not_allowed: "You do not have permission to make this change.",
  self_change: "You cannot change your own role or account status.",
  student_role_fixed: "Every account keeps the student role.",
  last_superadmin: "This is the last active superadmin. Make someone else a superadmin first.",
  target_deleted: "This account has been deleted.",
  no_change: "Nothing to change.",
};

/**
 * Decides whether `actor` may apply `change` to `target` (database-integration.md §6.3).
 * `activeSuperadmins` is the current number of active superadmin accounts.
 */
export function checkRoleChange(input: {
  actor: Pick<AppUser, "id" | "roles" | "status">;
  target: Pick<AppUser, "id" | "roles" | "status">;
  change: RoleChange;
  activeSuperadmins: number;
}): Denial | null {
  const { actor, target, change, activeSuperadmins } = input;
  const touchesSuperadmin =
    (change.kind !== "status" && change.role === "superadmin") ||
    (change.kind === "status" && hasRole(target, "superadmin"));
  const needed: Action = touchesSuperadmin ? "users.manage_superadmins" : "users.manage_admins";
  if (!can(actor, needed)) return "not_allowed";
  if (actor.id === target.id) return "self_change";
  if (target.status === "deleted") return "target_deleted";

  if (change.kind === "status") {
    if (change.status === target.status) return "no_change";
    const removesSuperadmin = hasRole(target, "superadmin") && target.status === "active" && change.status !== "active";
    if (removesSuperadmin && activeSuperadmins <= 1) return "last_superadmin";
    return null;
  }
  if (change.role === "student") return "student_role_fixed";
  const has = hasRole(target, change.role);
  if (change.kind === "grant" && has) return "no_change";
  if (change.kind === "revoke" && !has) return "no_change";
  if (
    change.kind === "revoke" &&
    change.role === "superadmin" &&
    target.status === "active" &&
    activeSuperadmins <= 1
  ) {
    return "last_superadmin";
  }
  return null;
}
