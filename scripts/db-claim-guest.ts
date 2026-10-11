/**
 * Moves every attempt owned by the local guest user (attempts from before sign-in
 * existed, and sessions imported with `pnpm db:import-json`) to a real account.
 *   pnpm db:claim-guest you@example.com
 * The account must have signed in at least once. Safe to re-run.
 */
import { closeDb, getDb } from "../src/server/db/client";
import { claimGuestAttempts } from "../src/server/db/seed";
import { loadEnv } from "./lib/load-env";

async function main() {
  loadEnv();
  const email = process.argv[2];
  if (!email) throw new Error("Usage: pnpm db:claim-guest <email of an account that has signed in>");
  const n = await claimGuestAttempts(getDb(), email);
  console.log(`Moved ${n.attempts} attempt(s) and ${n.results} result(s) to ${email}.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(closeDb);
