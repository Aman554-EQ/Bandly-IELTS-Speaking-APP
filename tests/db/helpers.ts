/**
 * Shared setup for database tests. Each test file starts from an empty, freshly
 * migrated and seeded `bandly_test` database. Files run one at a time
 * (`pnpm test:db` uses --no-file-parallelism).
 */
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { SAMPLE_SET } from "@/content/sample-set";
import { getDb } from "@/server/db/client";
import { seedAll } from "@/server/db/seed";
import { loadEnv } from "../../scripts/lib/load-env";

export function pointAtTestDatabase(): void {
  loadEnv();
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error("DATABASE_URL_TEST is missing (see .env.example).");
  if (!/_test$/.test(new URL(url).pathname)) {
    throw new Error("DATABASE_URL_TEST must point at a database whose name ends in _test.");
  }
  process.env.DATABASE_URL = url; // getDb() and repo.ts read DATABASE_URL
}

export async function resetDatabase() {
  const db = getDb();
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await migrate(db, { migrationsFolder: "drizzle" });
  return { db, ...(await seedAll(db, SAMPLE_SET)) };
}
