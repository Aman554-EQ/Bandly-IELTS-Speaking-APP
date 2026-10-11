/**
 * Moves existing content to the v2 shape (step3-redesign-plan.md §6.2).
 *   pnpm db:backup                  first, always
 *   pnpm db:content-v2 --dry-run    report only (rolls back)
 *   pnpm db:content-v2              apply (one transaction; running it again changes nothing)
 */
import { closeDb, getDb } from "../src/server/db/client";
import { migrateContentV2 } from "../src/server/db/content-v2";
import { loadEnv } from "./lib/load-env";

async function main() {
  loadEnv();
  const dryRun = process.argv.includes("--dry-run");
  console.log(dryRun ? "Dry run (nothing will be saved):" : "Migrating content to v2:");
  await migrateContentV2(getDb(), { dryRun, log: (m) => console.log(`  ${m}`) });
  console.log(dryRun ? "Dry run finished. Nothing was changed." : "Done.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(closeDb);
