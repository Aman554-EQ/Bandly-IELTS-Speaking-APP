import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

/**
 * Loads .env.local then .env (like Next.js) for CLI scripts and drizzle-kit.
 * Variables already set in the shell win.
 */
export function loadEnv(root = process.cwd()): void {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(root, name);
    if (!existsSync(file)) continue;
    for (const [k, v] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
  }
}
