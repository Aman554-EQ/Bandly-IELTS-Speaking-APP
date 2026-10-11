import { z } from "zod";
import { overallBand } from "@/engine/bands";
import { isAnswerContent } from "@/engine/interaction";
import type { ExamMode, Part } from "@/engine/types";
import type { Adjustment, Conduct, CriterionKey, CriterionResult, PartReport, TurnRecord } from "./db/types";
import type { SpeechFeatures } from "./features";

/**
 * Scoring v2 (per part):
 *
 *   turns ──group──► answers per question ──LLM──► 4 criterion bands + feedback
 *                                                      │
 *                     conduct (live listening) ──rules──► adjustments
 *                                                      │
 *                                     part band = IELTS rounding of 4 criteria
 *
 * Full test: each part is scored separately (as soon as it ends), then the
 * criteria are combined across parts (weighted by part) and a short overall
 * summary is written. The overall band is always computed in code.
 */

export const PROMPT_VERSION = "score-v2-part";
export const CRITERIA: CriterionKey[] = ["fluency", "lexical", "grammar", "pronunciation"];

// ---------------------------------------------------------------- answers

export interface ScoredAnswer {
  questionId: string;
  question: string;
  kind: TurnRecord["kind"];
  transcript: string;
  speechMs: number;
  interrupted: boolean;
  noResponse: boolean;
  features: SpeechFeatures | null;
  notes: string[];
}

/** Groups a part's takes into one answer per question (continuations merged, requests excluded). */
export function answersForPart(turns: TurnRecord[], part: Part): ScoredAnswer[] {
  const byQ = new Map<string, TurnRecord[]>();
  for (const t of turns.filter((x) => x.part === part && x.scored).sort((a, b) => a.seq - b.seq)) {
    const list = byQ.get(t.questionId) ?? [];
    list.push(t);
    byQ.set(t.questionId, list);
  }
  const out: ScoredAnswer[] = [];
  for (const [questionId, takes] of byQ) {
    const content = takes.filter((t) => isAnswerContent(t.analysis.intent) && t.transcript.trim());
    const notes: string[] = [];
    const count = (intent: string) => takes.filter((t) => t.analysis.intent === intent).length;
    if (count("repeat_request")) notes.push(`asked for a repeat ×${count("repeat_request")}`);
    if (count("clarification_request")) notes.push("asked what the question meant");
    if (count("question_to_examiner")) notes.push("asked the examiner a question");
    if (count("dont_know")) notes.push("said they did not know");
    if (count("off_topic")) notes.push("answer judged off-topic");
    out.push({
      questionId,
      question: takes[0].question,
      kind: takes[0].kind,
      transcript: content.map((t) => t.transcript.trim()).join(" … "),
      speechMs: content.reduce((a, t) => a + t.speechMs, 0),
      interrupted: content.some((t) => t.outcome === "interrupted"),
      noResponse: content.length === 0,
      features: mergeFeatures(content.map((t) => t.features).filter((f): f is SpeechFeatures => f !== null)),
      notes,
    });
  }
  return out;
}

function mergeFeatures(list: SpeechFeatures[]): SpeechFeatures | null {
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  const sum = (k: keyof SpeechFeatures) => list.reduce((a, f) => a + ((f[k] as number) ?? 0), 0);
  const words = sum("wordCount");
  const avg = (k: keyof SpeechFeatures) =>
    list.reduce((a, f) => a + ((f[k] as number) ?? 0) * f.wordCount, 0) / Math.max(1, words);
  const r = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
  const logprobs = list.map((f) => f.meanLogprob).filter((x): x is number => x !== null);
  return {
    durationSec: r(sum("durationSec")),
    wordCount: words,
    articulationWpm: r(avg("articulationWpm")),
    speechRateWpm: r(avg("speechRateWpm")),
    pausesOver1s: sum("pausesOver1s"),
    longestPauseSec: Math.max(...list.map((f) => f.longestPauseSec)),
    meanLengthOfRun: r(avg("meanLengthOfRun")),
    fillerCount: sum("fillerCount"),
    fillersPer100Words: r(words ? (sum("fillerCount") / words) * 100 : 0),
    repetitions: sum("repetitions"),
    lexicalDiversity: r(avg("lexicalDiversity"), 3),
    meanLogprob: logprobs.length ? r(logprobs.reduce((a, b) => a + b, 0) / logprobs.length, 3) : null,
  };
}

// ---------------------------------------------------------------- conduct

export function conductForPart(turns: TurnRecord[], part: Part): Conduct {
  const t = turns.filter((x) => x.part === part);
  const n = (intent: string) => t.filter((x) => x.analysis.intent === intent).length;
  /** Questions (not takes) where this happened, e.g. one off-topic question re-asked once counts once. */
  const q = (intent: string) => new Set(t.filter((x) => x.analysis.intent === intent).map((x) => x.questionId)).size;
  return {
    repeatRequests: n("repeat_request"),
    clarifications: n("clarification_request"),
    examinerQuestions: n("question_to_examiner"),
    metaQuestions: n("meta"),
    stopRequests: n("stop_request"),
    dontKnow: q("dont_know"),
    noResponses: answersForPart(turns, part).filter((a) => a.noResponse).length,
    offTopic: q("off_topic"),
  };
}

/** Allowances per part before a deduction applies. */
export const CONDUCT_RULES = {
  repeatAllowance: 2,
  clarificationAllowance: 1,
  /** Questions to the examiner, test questions and stop requests combined. */
  interruptionAllowance: 1,
  /** "I don't know" + no response combined. */
  nonAnswerAllowance: 2,
};

/**
 * Transparent, rule-based deductions (max one band per criterion per part).
 * IELTS assesses the ability to keep going without prompting under
 * Fluency & Coherence; failing to attempt answers limits the evidence for
 * vocabulary range (Lexical Resource).
 */
export function conductAdjustments(c: Conduct): Adjustment[] {
  const out: Adjustment[] = [];
  const reasons: string[] = [];
  if (c.repeatRequests > CONDUCT_RULES.repeatAllowance)
    reasons.push(`${c.repeatRequests} repeat requests (allowance ${CONDUCT_RULES.repeatAllowance})`);
  if (c.clarifications > CONDUCT_RULES.clarificationAllowance)
    reasons.push(
      `${c.clarifications} requests to explain the question (allowance ${CONDUCT_RULES.clarificationAllowance})`,
    );
  const interruptions = c.examinerQuestions + c.metaQuestions + c.stopRequests;
  if (interruptions > CONDUCT_RULES.interruptionAllowance)
    reasons.push(
      `${interruptions} off-task questions to the examiner (allowance ${CONDUCT_RULES.interruptionAllowance})`,
    );
  if (reasons.length)
    out.push({ criterion: "fluency", delta: -1, reason: `Needed frequent prompting: ${reasons.join("; ")}.` });

  const nonAnswers = c.dontKnow + c.noResponses;
  if (nonAnswers > CONDUCT_RULES.nonAnswerAllowance) {
    out.push({
      criterion: "lexical",
      delta: -1,
      reason: `${nonAnswers} questions were not answered (allowance ${CONDUCT_RULES.nonAnswerAllowance}), so there was little evidence of vocabulary range.`,
    });
  }
  return out;
}

// ------------------------------------------------------------- LLM output

const criterionSchema = z.object({
  band: z.coerce.number().int().min(0).max(9),
  summary: z.string(),
  evidence: z.array(z.string()).max(8).catch([]),
  improvements: z.array(z.string()).max(8).catch([]),
});

export const partLlmSchema = z.object({
  criteria: z.object({
    fluency: criterionSchema,
    lexical: criterionSchema,
    grammar: criterionSchema,
    pronunciation: criterionSchema,
  }),
  feedback: z.string(),
  improvedAnswers: z
    .array(z.object({ question: z.string(), original: z.string(), improved: z.string() }))
    .max(5)
    .catch([]),
  priorities: z.array(z.string()).max(6).catch([]),
  vocabularyUpgrades: z
    .array(z.object({ instead: z.string(), try: z.string() }))
    .max(10)
    .catch([]),
});

export type PartLlm = z.infer<typeof partLlmSchema>;

const criterionJson = {
  type: "object",
  additionalProperties: false,
  required: ["band", "summary", "evidence", "improvements"],
  properties: {
    band: { type: "integer" },
    summary: { type: "string" },
    evidence: { type: "array", items: { type: "string" } },
    improvements: { type: "array", items: { type: "string" } },
  },
} as const;

export const partLlmJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["criteria", "feedback", "improvedAnswers", "priorities", "vocabularyUpgrades"],
  properties: {
    criteria: {
      type: "object",
      additionalProperties: false,
      required: ["fluency", "lexical", "grammar", "pronunciation"],
      properties: {
        fluency: criterionJson,
        lexical: criterionJson,
        grammar: criterionJson,
        pronunciation: criterionJson,
      },
    },
    feedback: { type: "string" },
    improvedAnswers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "original", "improved"],
        properties: { question: { type: "string" }, original: { type: "string" }, improved: { type: "string" } },
      },
    },
    priorities: { type: "array", items: { type: "string" } },
    vocabularyUpgrades: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["instead", "try"],
        properties: { instead: { type: "string" }, try: { type: "string" } },
      },
    },
  },
} as const;

export const summaryLlmSchema = z.object({
  summary: z.string(),
  strengths: z.array(z.string()).max(5).catch([]),
  priorities: z.array(z.string()).max(5).catch([]),
});

export const summaryLlmJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "strengths", "priorities"],
  properties: {
    summary: { type: "string" },
    strengths: { type: "array", items: { type: "string" } },
    priorities: { type: "array", items: { type: "string" } },
  },
} as const;

export function parseJson<T>(schema: z.ZodType<T>, content: string): T {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model reply contained no JSON object");
  return schema.parse(JSON.parse(content.slice(start, end + 1)));
}

// ----------------------------------------------------------------- prompts

const BAND_DESCRIPTORS = `IELTS SPEAKING BAND DESCRIPTORS (paraphrased summary; whole bands only)

FLUENCY AND COHERENCE (fluency)
9: Fluent with only rare repetition or self-correction; hesitation is about ideas, not language; fully coherent; topics fully developed.
8: Fluent with only occasional repetition or self-correction; hesitation mostly content-related; develops topics coherently and appropriately.
7: Speaks at length without noticeable effort or loss of coherence; some language-related hesitation, repetition or self-correction; uses a range of connectives and discourse markers with some flexibility.
6: Willing to speak at length, though may lose coherence at times because of repetition, self-correction or hesitation; uses a range of connectives but not always appropriately.
5: Usually keeps going but relies on repetition, self-correction and/or slow speech; may over-use certain connectives; simple speech is fluent, more complex communication causes fluency problems.
4: Cannot respond without noticeable pauses; may speak slowly with frequent repetition and self-correction; links basic sentences with repetitious simple connectives; some breakdowns in coherence.
3: Long pauses; limited ability to link simple sentences; gives only simple responses and is frequently unable to convey a basic message.

LEXICAL RESOURCE (lexical)
9: Full flexibility and precision on all topics; idiomatic language used naturally and accurately.
8: Wide resource used readily and flexibly to convey precise meaning; skilful use of less common and idiomatic vocabulary with occasional inaccuracies; effective paraphrase.
7: Flexible vocabulary across a variety of topics; some less common and idiomatic items; awareness of style and collocation with some inappropriate choices; effective paraphrase.
6: Vocabulary wide enough to discuss topics at length and make meaning clear despite inappropriacies; generally paraphrases successfully.
5: Manages familiar and unfamiliar topics but with limited flexibility; attempts paraphrase with mixed success.
4: Conveys basic meaning on familiar topics; frequent errors in word choice; rarely attempts paraphrase.
3: Simple vocabulary for personal information only; insufficient vocabulary for less familiar topics.

GRAMMATICAL RANGE AND ACCURACY (grammar)
9: Full range of structures used naturally and appropriately; consistently accurate apart from native-speaker-like slips.
8: Wide range of structures used flexibly; most sentences error-free; occasional inappropriacies or non-systematic errors.
7: Range of complex structures with some flexibility; frequently produces error-free sentences, though some grammatical mistakes persist.
6: Mix of simple and complex structures but limited flexibility; frequent mistakes with complex structures that rarely cause comprehension problems.
5: Basic sentence forms with reasonable accuracy; limited range of complex structures, which usually contain errors.
4: Basic sentence forms and some correct simple sentences; subordinate structures are rare; errors are frequent.
3: Attempts basic sentence forms with limited success; numerous errors except in memorised utterances.

PRONUNCIATION (pronunciation): ESTIMATE ONLY
You cannot hear the audio. Estimate conservatively from transcription confidence (meanLogprob: closer to 0 = clearer), how intelligible the transcript is, speech rate and pausing. Default to band 6 when evidence is neutral. Use 7+ only with clean, high-confidence transcripts and natural rate (articulation 120–190 wpm). Use 5 or below when the transcript is fragmented, confidence is low (meanLogprob < -0.6) or the rate is very slow. Never exceed fluency band + 1. Say in the summary that it is an estimate from text and timing.`;

const PART_FOCUS: Record<Part, string> = {
  1: "Part 1 (interview on familiar topics). Expect direct, natural answers of 2–4 sentences with a reason or example. Very short or one-word answers are a weakness.",
  2: "Part 2 (long turn). The candidate should speak for 1–2 minutes, cover the cue card points and organise the talk coherently. Stopping well before one minute is a weakness. Round-off answers can be short.",
  3: "Part 3 (discussion). Expect abstract, extended answers with opinions, reasons, examples, comparison and speculation. Simple or very short answers are a weakness.",
};

const PART_JSON_SHAPE = `{
  "criteria": {
    "fluency":       { "band": 6, "summary": "…", "evidence": ["exact short quote", "…"], "improvements": ["…"] },
    "lexical":       { "band": 6, "summary": "…", "evidence": ["…"], "improvements": ["…"] },
    "grammar":       { "band": 6, "summary": "…", "evidence": ["…"], "improvements": ["…"] },
    "pronunciation": { "band": 6, "summary": "…", "evidence": ["…"], "improvements": ["…"] }
  },
  "feedback": "one paragraph",
  "improvedAnswers": [{ "question": "…", "original": "…", "improved": "…" }],
  "priorities": ["…", "…", "…"],
  "vocabularyUpgrades": [{ "instead": "…", "try": "…" }]
}`;

export function partSystemPrompt(part: Part): string {
  return `You are a certified IELTS Speaking examiner producing a practice assessment of ONE part of the test.
${PART_FOCUS[part]}
Rules:
- Assess ONLY the candidate's speech in this part (transcripts from speech recognition: ignore punctuation and capitalisation).
- Give each of the four criteria a WHOLE band from 0 to 9 using the descriptors. Do not compute an overall band.
- Quote short exact phrases from the transcripts in "evidence" for every criterion.
- Use the measured speech features as objective facts for fluency (pauses, runs, fillers, repetitions, rate).
- Answers marked (no response) or very short answers must lower fluency and lexical bands; do not reward what was not demonstrated.
- (interrupted at time limit) is normal examiner behaviour and not a weakness.
- Notes like "asked for a repeat" are context; deductions for them are applied separately, so do not double-penalise.
- "feedback": one paragraph (3–5 sentences) on this part only, written to the candidate ("you").
- "improvements" and "priorities": specific and actionable (what to do, with a short example).
- "improvedAnswers": 1–3 of the weaker answers rewritten about one band higher, keeping the candidate's ideas, natural for speech.
- "vocabularyUpgrades": up to 6 words or phrases the candidate actually used, each with a more precise or natural alternative.
- Be honest, professional and encouraging. Clear, simple English.

Return ONLY a JSON object with exactly this shape (every criterion is an OBJECT, not a number):
${PART_JSON_SHAPE}

${BAND_DESCRIPTORS}`;
}

function featureLine(f: SpeechFeatures | null): string {
  if (!f) return "";
  return `   features: words=${f.wordCount}, articulation=${f.articulationWpm}wpm, pauses>1s=${f.pausesOver1s}, longestPause=${f.longestPauseSec}s, meanRun=${f.meanLengthOfRun}w, fillers=${f.fillerCount}, repetitions=${f.repetitions}, diversity=${f.lexicalDiversity}, meanLogprob=${f.meanLogprob ?? "n/a"}`;
}

export function partUserMessage(part: Part, mode: ExamMode, answers: ScoredAnswer[]): string {
  const lines = [
    `Test taken: ${mode === "full" ? "Full Speaking test (this is one of its parts)" : `Part ${part} only`}.`,
    `=== PART ${part} ===`,
    "",
  ];
  for (const a of answers) {
    const label =
      a.kind === "long_turn"
        ? "CUE CARD"
        : a.kind === "probe"
          ? "FOLLOW-UP"
          : a.kind === "round_off"
            ? "ROUND-OFF"
            : "Q";
    lines.push(`${label}: ${a.question}`);
    if (a.noResponse) lines.push("A: (no response)");
    else {
      lines.push(
        `A${a.interrupted ? " (interrupted at time limit)" : ""} [${Math.round(a.speechMs / 1000)}s speech]: ${a.transcript}`,
      );
      const f = featureLine(a.features);
      if (f) lines.push(f);
    }
    if (a.notes.length) lines.push(`   notes: ${a.notes.join("; ")}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function summarySystemPrompt(): string {
  return `You are an IELTS Speaking examiner writing the overall summary of a full practice test, based on the separate assessments of Parts 1, 2 and 3.
Return ONLY a JSON object with exactly this shape:
{"summary": "one paragraph (4–6 sentences) to the candidate (\"you\") comparing the parts and explaining the overall level", "strengths": ["2–3 short points"], "priorities": ["the 3 most important, specific next steps across the whole test"]}
Do not invent new band scores. Clear, simple, encouraging English.`;
}

export function summaryUserMessage(
  parts: PartReport[],
  overall: number | null,
  criteria: Record<CriterionKey, number> | null,
): string {
  const lines = [
    `Overall estimated band: ${overall ?? "n/a"}`,
    `Combined criteria: ${criteria ? JSON.stringify(criteria) : "n/a"}`,
    "",
  ];
  for (const p of parts) {
    lines.push(`PART ${p.part}: band ${p.band ?? "n/a"}`);
    if (p.criteria) for (const k of CRITERIA) lines.push(`  ${k}: ${p.criteria[k].band}: ${p.criteria[k].summary}`);
    lines.push(`  feedback: ${p.feedback}`);
    if (p.priorities.length) lines.push(`  priorities: ${p.priorities.join(" | ")}`);
    lines.push("");
  }
  return lines.join("\n");
}

// --------------------------------------------------------------- assembly

export function sampleNoteFor(part: Part, answers: ScoredAnswer[]): string | null {
  const speech = answers.reduce((a, x) => a + x.speechMs, 0);
  const answered = answers.filter((a) => !a.noResponse).length;
  if (answered === 0) return "No speech was captured in this part, so it could not be scored.";
  const min = part === 2 ? 45_000 : 60_000;
  if (speech < min) return "This estimate is based on very little speech, so it is less reliable.";
  return null;
}

export function buildPartReport(input: {
  part: Part;
  answers: ScoredAnswer[];
  conduct: Conduct;
  llm: PartLlm | null;
  model: string | null;
}): PartReport {
  const { part, answers, conduct, llm, model } = input;
  const adjustments = llm ? conductAdjustments(conduct) : [];
  let criteria: PartReport["criteria"] = null;
  if (llm) {
    const c = llm.criteria;
    const pron = Math.min(c.pronunciation.band, c.fluency.band + 1);
    const result = (k: CriterionKey, assessed: number): CriterionResult => {
      const delta = adjustments.filter((a) => a.criterion === k).reduce((s, a) => s + a.delta, 0);
      return { ...c[k], assessedBand: assessed, band: Math.max(0, Math.min(9, assessed + delta)) };
    };
    criteria = {
      fluency: result("fluency", c.fluency.band),
      lexical: result("lexical", c.lexical.band),
      grammar: result("grammar", c.grammar.band),
      pronunciation: result("pronunciation", pron),
    };
  }
  return {
    part,
    band: criteria ? overallBand(CRITERIA.map((k) => criteria![k].band)) : null,
    criteria,
    feedback: llm?.feedback ?? "Not enough speech was captured in this part to give feedback.",
    improvedAnswers: llm?.improvedAnswers ?? [],
    vocabularyUpgrades: llm?.vocabularyUpgrades ?? [],
    priorities: llm?.priorities ?? [],
    conduct,
    adjustments,
    sampleNote: sampleNoteFor(part, answers),
    speechSeconds: Math.round(answers.reduce((a, x) => a + x.speechMs, 0) / 1000),
    questionsAnswered: answers.filter((a) => !a.noResponse).length,
    model,
    promptVersion: PROMPT_VERSION,
    scoredAt: new Date().toISOString(),
  };
}

/** Part weights for combining a full test (Part 3 shows the widest range). */
export const PART_WEIGHTS: Record<Part, number> = { 1: 0.3, 2: 0.3, 3: 0.4 };

/** Combines part criteria into whole-band test criteria, then the overall band. */
export function combineParts(parts: PartReport[]): {
  criteria: Record<CriterionKey, number> | null;
  overall: number | null;
} {
  const scored = parts.filter((p) => p.criteria);
  if (scored.length === 0) return { criteria: null, overall: null };
  const wSum = scored.reduce((a, p) => a + PART_WEIGHTS[p.part], 0);
  const criteria = Object.fromEntries(
    CRITERIA.map((k) => {
      const mean = scored.reduce((a, p) => a + p.criteria![k].band * PART_WEIGHTS[p.part], 0) / wSum;
      return [k, Math.round(mean)];
    }),
  ) as Record<CriterionKey, number>;
  return { criteria, overall: overallBand(CRITERIA.map((k) => criteria[k])) };
}
