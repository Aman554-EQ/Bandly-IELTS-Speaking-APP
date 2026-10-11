/**
 * Copies the old JSON store (data/question-bank.json and data/sessions/*.json)
 * into PostgreSQL. Idempotent: sessions already imported are skipped.
 *   pnpm db:import-json            import
 *   pnpm db:import-json --dry-run  only report what would be imported
 * The JSON files are left untouched.
 */
import path from "node:path";
import { closeDb, getDb } from "../src/server/db/client";
import { importJsonStore } from "../src/server/db/import-json";
import { loadEnv } from "./lib/load-env";

async function main() {
  loadEnv();
  const dataDir = path.resolve(process.env.DATA_DIR ?? "data");
  await importJsonStore(getDb(), dataDir, { dryRun: process.argv.includes("--dry-run") });
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(closeDb);
