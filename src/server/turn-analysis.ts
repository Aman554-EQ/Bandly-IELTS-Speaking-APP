import "server-only";
import { z } from "zod";
import { classifyByRules, TURN_INTENTS, type TurnAnalysis } from "@/engine/interaction";
import { PROBE_IDS } from "@/engine/script";
import type { TakeMeta } from "@/engine/types";
import { cleanTranscript, extractFeatures, type SpeechFeatures } from "./features";
import { chatJson, transcribe } from "./groq";

/**
 * Live listening on the server: transcribe one take and work out what the
 * candidate meant, fast enough for the examiner to react naturally
 * (~1–2 s end to end).
 *
 *   audio ──Whisper──► transcript ──rules──► confident? ──yes──► analysis
 *                                              │no
 *                                              ▼
 *                                     fast LLM (≤ 3.5 s) ──► analysis
 *                                              │ fails/slow
 *                                              ▼
 *                                         rules fallback
 */

export const ANALYSIS_PROMPT_VERSION = "listen-v1";

const llmSchema = z.object({
  intent: z.enum(TURN_INTENTS as [string, ...string[]]),
  polarity: z.enum(["positive", "negative", "neutral"]).catch("neutral"),
  quality: z.enum(["developed", "short", "minimal"]).catch("short"),
  probe: z
    .enum(PROBE_IDS as [string, ...string[]])
    .nullable()
    .catch(null),
  reason: z.string().max(300).catch(""),
});

const jsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "polarity", "quality", "probe", "reason"],
  properties: {
    intent: { type: "string", enum: TURN_INTENTS },
    polarity: { type: "string", enum: ["positive", "negative", "neutral"] },
    quality: { type: "string", enum: ["developed", "short", "minimal"] },
    probe: { anyOf: [{ type: "string", enum: PROBE_IDS }, { type: "null" }] },
    reason: { type: "string" },
  },
} as const;

const SYSTEM = `You are the listening module of a formal IELTS Speaking examiner. After each turn you decide what the candidate meant, so the examiner can respond like a real one.
Return ONLY JSON: {"intent","polarity","quality","probe","reason"}.

intent (choose one):
- answer: any genuine attempt to answer the question, even short, imperfect, hesitant or with a small aside. Prefer this when in doubt.
- repeat_request: asks to hear the question again ("pardon?", "sorry, could you repeat?", "what was the question?").
- clarification_request: asks what a word or the question means, without answering.
- incomplete: clearly stopped mid-sentence or said they need a moment, and gave little content so far.
- off_topic: talks about something clearly unrelated to the question (not just a loose or creative answer).
- dont_know: says they don't know / have no idea / want to skip, without attempting an answer.
- question_to_examiner: asks the examiner's opinion or personal question ("what about you?").
- meta: asks about the test itself (time left, "is that enough?", "should I continue?").
- stop_request: says they want to stop or end the test.
- no_answer: noise, unintelligible, not English, or nothing meaningful.

polarity: does the answer begin as yes (positive), no (negative) or neither (neutral)?
quality: developed (extended, with reasons/examples), short (one or two simple sentences), minimal (a few words).
probe: Part 3 only (otherwise null). If the answer would naturally be extended by one follow-up, choose why | example | more | compare | future | agree; null if already well developed.
reason: under 15 words.`;

function userMessage(take: TakeMeta, transcript: string): string {
  const part = take.part === 0 ? "Opening" : `Part ${take.part}`;
  return `${part}, ${take.kind.replace("_", " ")}.
Examiner's question: "${take.question}"
Candidate (${(take.speechMs / 1000).toFixed(1)} s of speech): "${transcript}"`;
}

export interface TurnAnalysisResult {
  analysis: TurnAnalysis;
  features: SpeechFeatures | null;
  sttModel: string | null;
  analysisModel: string | null;
}

/** Full listening pipeline for one take. Never throws for LLM problems (falls back to rules). */
export async function analyzeTurn(take: TakeMeta, audio: Blob | null): Promise<TurnAnalysisResult> {
  // Takes decided locally by the engine (button repeat request, silence).
  if (take.outcome === "repeat_requested") {
    return {
      analysis: {
        intent: "repeat_request",
        transcript: "",
        polarity: "neutral",
        quality: "minimal",
        probe: null,
        source: "button",
      },
      features: null,
      sttModel: null,
      analysisModel: null,
    };
  }
  if (!audio || take.outcome === "no_response") {
    const { analysis } = classifyByRules("", 0);
    return { analysis: { ...analysis, intent: "no_answer" }, features: null, sttModel: null, analysisModel: null };
  }

  // 1. Speech to text (throws on failure: the caller reports it).
  const ext = audio.type.includes("mp4")
    ? "m4a"
    : audio.type.includes("ogg")
      ? "ogg"
      : audio.type.includes("wav")
        ? "wav"
        : "webm";
  const { result, model: sttModel } = await transcribe(audio, `${take.takeId}.${ext}`);
  const { text } = cleanTranscript(result);
  const features = text ? extractFeatures(result, text) : null;

  // 2. Rules first.
  const rules = classifyByRules(text, take.speechMs);
  const skipLlm =
    rules.confident ||
    take.kind === "name" ||
    take.outcome === "interrupted" ||
    (take.kind === "long_turn" && take.speechMs > 15_000);
  if (skipLlm) {
    // Speaking until the time limit means a real answer (except the short name question).
    const clearlyAnswer =
      take.kind !== "name" && (take.outcome === "interrupted" || (take.kind === "long_turn" && take.speechMs > 15_000));
    const analysis = clearlyAnswer ? { ...rules.analysis, intent: "answer" as const } : rules.analysis;
    return { analysis, features, sttModel, analysisModel: null };
  }

  // 3. Fast LLM for everything that needs judgement.
  try {
    const { content, model } = await chatJson(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: userMessage(take, text) },
      ],
      { name: "turn_analysis", schema: jsonSchema as unknown as Record<string, unknown> },
      { profile: "fast", maxTokens: 400, timeoutMs: 3_500 },
    );
    const start = content.indexOf("{");
    const parsed = llmSchema.parse(JSON.parse(content.slice(start, content.lastIndexOf("}") + 1)));
    const analysis: TurnAnalysis = {
      intent: parsed.intent as TurnAnalysis["intent"],
      transcript: text,
      polarity: parsed.polarity,
      quality: parsed.quality,
      probe: take.part === 3 ? (parsed.probe as TurnAnalysis["probe"]) : null,
      source: "llm",
      reason: parsed.reason,
    };
    return { analysis, features, sttModel, analysisModel: model };
  } catch {
    return { analysis: rules.analysis, features, sttModel, analysisModel: null };
  }
}
