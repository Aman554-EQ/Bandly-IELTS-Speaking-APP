/**
 * Creates (or repairs) the first superadmin and the default admin.
 *   pnpm bootstrap:admins
 *   pnpm bootstrap:admins --confirm-production   (required for a live Clerk key or NODE_ENV=production)
 *
 * Reads BOOTSTRAP_SUPERADMIN_EMAIL and BOOTSTRAP_ADMIN_EMAIL. Accounts are created
 * in Clerk without a password: the owner signs in with "Forgot password?" (or an
 * email code) and sets their own. Safe to re-run; it changes nothing the second time.
 * Recovery of a lost superadmin: set BOOTSTRAP_SUPERADMIN_EMAIL to a verified email
 * you control and run it again (a suspended bootstrap account is reactivated).
 */
import { createClerkClient, type User } from "@clerk/backend";
import { closeDb, getDb } from "../src/server/db/client";
import { BootstrapError, bootstrapAdmins, type ClerkAdminApi, isProductionTarget } from "../src/server/auth/bootstrap";
import type { ClerkUserLite } from "../src/server/auth/users";
import { loadEnv } from "./lib/load-env";

function lite(u: User): ClerkUserLite {
  const email = u.primaryEmailAddress?.emailAddress ?? u.emailAddresses[0]?.emailAddress ?? "";
  return { id: u.id, email, firstName: u.firstName, lastName: u.lastName, imageUrl: u.imageUrl || null };
}

async function main() {
  loadEnv();
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new BootstrapError("CLERK_SECRET_KEY is missing. Add your Clerk keys to .env.local first.");
  const clerk = createClerkClient({ secretKey });
  const api: ClerkAdminApi = {
    async findUserByEmail(email) {
      const { data } = await clerk.users.getUserList({ emailAddress: [email], limit: 1 });
      return data[0] ? lite(data[0]) : null;
    },
    async createUser(email) {
      return lite(await clerk.users.createUser({ emailAddress: [email], skipPasswordRequirement: true }));
    },
  };

  const results = await bootstrapAdmins(getDb(), api, {
    superadminEmail: process.env.BOOTSTRAP_SUPERADMIN_EMAIL,
    adminEmail: process.env.BOOTSTRAP_ADMIN_EMAIL,
    production: isProductionTarget(process.env),
    confirmProduction: process.argv.includes("--confirm-production"),
  });
  for (const r of results) {
    const what = [
      r.clerk === "created" ? "Clerk account created" : "Clerk account found",
      r.roleGranted ? `${r.role} role granted` : `already ${r.role}`,
      r.reactivated ? "reactivated" : null,
    ].filter(Boolean);
    console.log(`${r.role.padEnd(10)} ${r.email}: ${what.join(", ")}`);
  }
  if (results.some((r) => r.clerk === "created")) {
    console.log('\nNew accounts have no password yet: on /sign-in, enter the email and use "Forgot password?".');
  }
}

main()
  .catch((e) => {
    console.error(e instanceof BootstrapError ? e.message : e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(closeDb);
