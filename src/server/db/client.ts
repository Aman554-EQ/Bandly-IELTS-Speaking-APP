import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { z } from "zod";
import * as schema from "./schema";

/**
 * One connection pool per process, reused across requests and dev hot reloads.
 * node-postgres works with local Postgres and with Neon's pooled URL (ADR-0007).
 * No "server-only" here so CLI scripts can use it; repo.ts is the server boundary.
 */

export type Db = NodePgDatabase<typeof schema>;

const urlSchema = z
  .string({ error: "DATABASE_URL is missing. Add it to .env.local (see .env.example) and run `pnpm db:up`." })
  .regex(/^postgres(ql)?:\/\//, "DATABASE_URL must start with postgres:// or postgresql://");

interface Holder {
  pool: Pool;
  db: Db;
  url: string;
}

const g = globalThis as unknown as { __bandlyDb?: Holder };

export function createDb(url: string, max = 5): { pool: Pool; db: Db } {
  const pool = new Pool({ connectionString: url, max, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
  return { pool, db: drizzle(pool, { schema }) };
}

/** The app's database (from DATABASE_URL). Throws a clear error if it is not configured. */
export function getDb(): Db {
  const url = urlSchema.parse(process.env.DATABASE_URL);
  if (g.__bandlyDb?.url !== url) {
    void g.__bandlyDb?.pool.end().catch(() => undefined);
    g.__bandlyDb = { ...createDb(url), url };
  }
  return g.__bandlyDb.db;
}

/** For scripts and tests: close the shared pool so the process can exit. */
export async function closeDb(): Promise<void> {
  const h = g.__bandlyDb;
  g.__bandlyDb = undefined;
  await h?.pool.end();
}
