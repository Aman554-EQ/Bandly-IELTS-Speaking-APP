// Dumps the local database (Docker container bandly-db) to backups/bandly-<time>.sql.
//   pnpm db:backup
// Restore: docker exec -i bandly-db psql -U bandly -d bandly < backups/<file>.sql  (into an empty database)
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";

const dir = path.resolve("backups");
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `bandly-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`);
const out = createWriteStream(file);
const p = spawn("docker", ["exec", "bandly-db", "pg_dump", "-U", "bandly", "-d", "bandly", "--no-owner"], {
  stdio: ["ignore", "pipe", "inherit"],
});
p.stdout.pipe(out);
p.on("close", (code) => {
  if (code === 0) console.log(`Backup written: ${path.relative(process.cwd(), file)}`);
  else {
    console.error(`pg_dump failed (exit ${code}). Is the container running? pnpm db:up`);
    process.exitCode = 1;
  }
});
