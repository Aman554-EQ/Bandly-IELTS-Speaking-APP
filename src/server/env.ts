import "server-only";
import { z } from "zod";

/**
 * Server environment, validated lazily on first use so a missing key gives a
 * clear error instead of a confusing failure deep inside a request.
 */
const schema = z.object({
  GROQ_API_KEY: z
    .string({ error: "GROQ_API_KEY is missing. Add it to .env.local (see .env.example)." })
    .refine(
      (v) => v.length >= 20 && !v.startsWith("gsk_your"),
      "GROQ_API_KEY is not set. Add your key from https://console.groq.com/keys to .env.local.",
    ),
  GROQ_STT_MODEL: z.string().default("whisper-large-v3-turbo"),
  GROQ_STT_FALLBACK_MODEL: z.string().default("whisper-large-v3"),
  /** Comma-separated LLM fallback chain for scoring, strongest first. */
  GROQ_LLM_MODELS: z.string().default("qwen/qwen3.8-27b,openai/gpt-oss-120b,openai/gpt-oss-20b"),
  /** Fast chain for live listening (intent analysis after every answer). */
  GROQ_FAST_MODELS: z.string().default("qwen/qwen3.8-27b,openai/gpt-oss-20b"),
  GROQ_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
});

export type ServerEnv = z.infer<typeof schema> & { llmModels: string[]; fastModels: string[] };

let cached: ServerEnv | null = null;

export class ConfigError extends Error {}

const splitList = (v: string) =>
  v
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => i.message).join("; "));
  }
  cached = {
    ...parsed.data,
    llmModels: splitList(parsed.data.GROQ_LLM_MODELS),
    fastModels: splitList(parsed.data.GROQ_FAST_MODELS),
  };
  return cached;
}
