/**
 * Seeds the database (idempotent: run it as often as you like).
 *   pnpm db:seed
 * Roles, the four modules, Cambridge 10–21, the built-in question set (Test Exam › Test 1)
 * and the local guest user that owns attempts until sign-in exists.
 */
import { count } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { SAMPLE_SET } from "../src/content/sample-set";
import { closeDb, getDb } from "../src/server/db/client";
import { collections, examQuestions, exams, modules, questions, roles, users } from "../src/server/db/schema";
import { seedAll } from "../src/server/db/seed";
import { loadEnv } from "./lib/load-env";

async function main() {
  loadEnv();
  const db = getDb();
  const r = await seedAll(db, SAMPLE_SET);
  const n = async (t: PgTable) => (await db.select({ n: count() }).from(t))[0].n;
  console.log(`Seed complete${r.sampleCreated ? " (sample exam created)" : " (sample exam already present)"}.`);
  console.table({
    roles: await n(roles),
    modules: await n(modules),
    collections: await n(collections),
    exams: await n(exams),
    questions: await n(questions),
    exam_questions: await n(examQuestions),
    users: await n(users),
  });
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(closeDb);
