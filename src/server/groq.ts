import "server-only";
import { serverEnv } from "./env";

/**
 * Minimal Groq client (OpenAI-compatible REST) with the resilience rules from
 * plan-2 §7.3: per-call timeout, retries on 429/5xx honouring `retry-after`,
 * exponential backoff with jitter, then the next model in the chain.
 *
 * All Groq traffic goes through this file.
 */

const BASE = "https://api.groq.com/openai/v1";
const MAX_RETRIES = 2;

export class GroqError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffMs(attempt: number, retryAfter: string | null): number {
  const header = retryAfter ? Number.parseFloat(retryAfter) : Number.NaN;
  if (Number.isFinite(header)) return Math.min(header * 1000, 20_000);
  return Math.min(1000 * 2 ** attempt, 8_000) + Math.random() * 300;
}

async function request(
  path: string,
  init: RequestInit,
  opts: { retries?: number; timeoutMs?: number } = {},
): Promise<Response> {
  const env = serverEnv();
  const retries = opts.retries ?? MAX_RETRIES;
  let lastErr: GroqError | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? env.GROQ_TIMEOUT_MS);
    try {
      const res = await fetch(`${BASE}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, ...(init.headers ?? {}) },
        signal: ctrl.signal,
      });
      if (res.ok) return res;
      const body = await res.text().catch(() => "");
      const retryable = res.status === 429 || res.status >= 500;
      lastErr = new GroqError(`Groq ${res.status}: ${body.slice(0, 300)}`, res.status, retryable);
      if (!retryable || attempt === retries) throw lastErr;
      await sleep(backoffMs(attempt, res.headers.get("retry-after")));
    } catch (e) {
      if (e instanceof GroqError) throw e;
      lastErr = new GroqError(
        e instanceof Error && e.name === "AbortError" ? "Groq request timed out" : String(e),
        0,
        true,
      );
      if (attempt === retries) throw lastErr;
      await sleep(backoffMs(attempt, null));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new GroqError("Groq request failed", 0, true);
}

/** Runs `fn` for each model in turn until one succeeds (retryable errors only). */
async function withFallback<T>(
  models: string[],
  fn: (model: string) => Promise<T>,
): Promise<{ value: T; model: string }> {
  let last: unknown;
  for (const model of models) {
    try {
      return { value: await fn(model), model };
    } catch (e) {
      last = e;
      if (e instanceof GroqError && !e.retryable && e.status !== 404 && e.status !== 400) throw e;
    }
  }
  throw last;
}

// ------------------------------------------------------------------ speech

export interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

export interface WhisperSegment {
  start: number;
  end: number;
  text: string;
  avg_logprob: number;
  no_speech_prob: number;
  compression_ratio: number;
}

export interface WhisperVerbose {
  text: string;
  duration: number;
  language?: string;
  segments?: WhisperSegment[];
  words?: WhisperWord[];
}

/**
 * Whisper is told this is a verbatim transcript with hesitations, so it
 * keeps fillers ("um", "uh") that matter for fluency scoring.
 */
const DISFLUENCY_PROMPT = "Um, well, I think, uh, it's like... hmm, let me think. Yeah, so, er, basically I mean...";

export async function transcribe(audio: Blob, filename: string): Promise<{ result: WhisperVerbose; model: string }> {
  const env = serverEnv();
  const models = [env.GROQ_STT_MODEL, env.GROQ_STT_FALLBACK_MODEL];
  const { value, model } = await withFallback(models, async (m) => {
    const form = new FormData();
    form.append("file", audio, filename);
    form.append("model", m);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    form.append("timestamp_granularities[]", "segment");
    form.append("language", "en");
    form.append("temperature", "0");
    form.append("prompt", DISFLUENCY_PROMPT);
    const res = await request("/audio/transcriptions", { method: "POST", body: form });
    return (await res.json()) as WhisperVerbose;
  });
  return { result: value, model };
}

// --------------------------------------------------------------------- chat

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface JsonSchemaFormat {
  name: string;
  schema: Record<string, unknown>;
}

/**
 * Per-model request options. Groq models differ: gpt-oss supports strict
 * JSON-schema outputs and `reasoning_effort`; Qwen 3 can switch its
 * reasoning off (fast) or hide it (deep).
 */
function modelOptions(model: string, profile: "fast" | "deep", format: JsonSchemaFormat) {
  if (model.startsWith("openai/gpt-oss")) {
    return {
      reasoning_effort: "low",
      response_format: { type: "json_schema", json_schema: { name: format.name, schema: format.schema, strict: true } },
    };
  }
  if (model.startsWith("qwen/")) {
    return {
      ...(profile === "fast" ? { reasoning_effort: "none" } : { reasoning_format: "hidden" }),
      response_format: { type: "json_object" },
    };
  }
  return { response_format: { type: "json_object" } };
}

/**
 * Chat completion that must return JSON, trying each model of the chosen
 * chain in turn:
 *  - "deep" (scoring): GROQ_LLM_MODELS, e.g. qwen/qwen3.8-27b → gpt-oss-120b → gpt-oss-20b
 *  - "fast" (live listening): GROQ_FAST_MODELS, no retries, short timeout
 */
export async function chatJson(
  messages: ChatMessage[],
  format: JsonSchemaFormat,
  opts: { maxTokens?: number; profile?: "fast" | "deep"; timeoutMs?: number } = {},
): Promise<{ content: string; model: string; usage?: { total_tokens?: number } }> {
  const env = serverEnv();
  const profile = opts.profile ?? "deep";
  const models = profile === "fast" ? env.fastModels : env.llmModels;
  const { value, model } = await withFallback(models, async (m) => {
    const body: Record<string, unknown> = {
      model: m,
      messages,
      temperature: 0,
      max_completion_tokens: opts.maxTokens ?? 4_000,
      ...modelOptions(m, profile, format),
    };
    const res = await request(
      "/chat/completions",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      profile === "fast" ? { retries: 0, timeoutMs: opts.timeoutMs ?? 3_500 } : { timeoutMs: opts.timeoutMs },
    );
    const json = (await res.json()) as {
      choices: { message: { content: string } }[];
      usage?: { total_tokens?: number };
    };
    return { content: stripThinking(json.choices[0]?.message?.content ?? ""), usage: json.usage };
  });
  return { ...value, model };
}

/** Removes any <think>…</think> block a reasoning model may still emit. */
export function stripThinking(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}
