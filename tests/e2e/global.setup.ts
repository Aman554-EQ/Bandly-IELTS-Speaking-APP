import { createClerkClient } from "@clerk/backend";
import { clerkSetup } from "@clerk/testing/playwright";
import { closeDb, getDb } from "../../src/server/db/client";
import { grantRoleRow, upsertUserFromClerk } from "../../src/server/auth/users";
import { loadEnv } from "../../scripts/lib/load-env";

/** Test superadmin and admin ("+clerk_test" addresses, development only). */
export const E2E_SUPERADMIN_EMAIL = "bandly-e2e-super+clerk_test@example.com";
export const E2E_ADMIN_EMAIL = "bandly-e2e-admin+clerk_test@example.com";

/**
 * Runs once before the browser tests:
 * 1. Gets a Clerk testing token (lets automated browsers past bot protection).
 * 2. Makes sure the test student exists in Clerk. E2E_CLERK_USER_EMAIL is a
 *    "+clerk_test" address, so Clerk never sends it an email.
 * Needs the Development keys in .env.local; refuses live keys.
 */
export default async function globalSetup() {
  loadEnv();
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!publishableKey || !secretKey) {
    throw new Error("Browser tests need NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY in .env.local.");
  }
  if (secretKey.startsWith("sk_live_")) throw new Error("Refusing to run browser tests against a live Clerk instance.");
  process.env.CLERK_PUBLISHABLE_KEY = publishableKey;
  await clerkSetup({ publishableKey });

  const email = process.env.E2E_CLERK_USER_EMAIL ?? "bandly-e2e+clerk_test@example.com";
  const clerk = createClerkClient({ secretKey });
  const { data } = await clerk.users.getUserList({ emailAddress: [email], limit: 1 });
  if (!data[0])
    await clerk.users.createUser({ emailAddress: [email], skipPasswordRequirement: true, firstName: "Test" });
  process.env.E2E_CLERK_USER_EMAIL = email;

  // Test superadmin and admin: Clerk account + role in the dev database.
  for (const [address, role, firstName] of [
    [E2E_SUPERADMIN_EMAIL, "superadmin", "Super"],
    [E2E_ADMIN_EMAIL, "admin", "Admin"],
  ] as const) {
    const found = (await clerk.users.getUserList({ emailAddress: [address], limit: 1 })).data[0];
    const u =
      found ?? (await clerk.users.createUser({ emailAddress: [address], skipPasswordRequirement: true, firstName }));
    const { id } = await upsertUserFromClerk(
      getDb(),
      { id: u.id, email: address, firstName, lastName: null, imageUrl: null },
      "bootstrap",
    );
    await grantRoleRow(getDb(), id, role, null);
  }
  await closeDb();
}
