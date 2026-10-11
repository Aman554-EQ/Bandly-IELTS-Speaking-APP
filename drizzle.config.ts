import { defineConfig } from "drizzle-kit";
import { loadEnv } from "./scripts/lib/load-env";

loadEnv();

// Migrations use the direct (unpooled) connection; the app uses the pooled one.
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is missing. Add it to .env.local (see .env.example).");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
