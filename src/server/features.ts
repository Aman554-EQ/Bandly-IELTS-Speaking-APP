/**
 * Deterministic speech features (plan-2 §5.2 step 1).
 *
 * These are computed in code, not by the LLM, and passed to the scorer as
 * objective evidence. Pure functions: easy to unit-test with fixtures.
 */
import type { WhisperSegment, WhisperVerbose, WhisperWord } from "./groq";

export interface SpeechFeatures {
  durationSec: number;
  wordCount: number;
  /** Words per minute of speaking time (pauses > 1 s excluded). */
  articulationWpm: number;
  /** Words per minute over the whole answer. */
  speechRateWpm: number;
  pausesOver1s: number;
  longestPauseSec: number;
  /** Mean words between pauses > 0.5 s. */
  meanLengthOfRun: number;
  fillerCount: number;
  fillersPer100Words: number;
  repetitions: number;
  /** Moving-average type-token ratio (window 25); higher = more varied vocabulary. */
  lexicalDiversity: number;
  /** Mean Whisper confidence (avg_logprob); closer to 0 = clearer speech. */
  meanLogprob: number | null;
}

const FILLERS = new Set(["um", "umm", "uh", "uhh", "er", "erm", "hmm", "mm", "ah", "eh"]);
const FILLER_PHRASES = [/\byou know\b/g, /\bi mean\b/g, /\bkind of\b/g, /\bsort of\b/g];

/** Phrases Whisper is known to invent on silence or noise. */
const HALLUCINATIONS = [
  /thank(s| you) for watching/i,
  /please subscribe/i,
  /subtitles? by/i,
  /^\s*(thank you\.?|bye\.?|you\.?)\s*$/i,
  /amara\.org/i,
];

export function normaliseWord(w: string): string {
  return w.toLowerCase().replace(/[^a-z']/g, "");
}

export function tokenize(text: string): string[] {
  return text.split(/\s+/).map(normaliseWord).filter(Boolean);
}

/** Removes segments that are most likely silence/noise hallucinations. */
export function cleanTranscript(r: WhisperVerbose): { text: string; removed: number } {
  const segs = r.segments ?? [];
  if (segs.length === 0) {
    const t = r.text.trim();
    return HALLUCINATIONS.some((h) => h.test(t)) ? { text: "", removed: 1 } : { text: t, removed: 0 };
  }
  const kept: WhisperSegment[] = [];
  let removed = 0;
  for (const s of segs) {
    const likelySilence = s.no_speech_prob > 0.6 && s.avg_logprob < -0.7;
    const known = HALLUCINATIONS.some((h) => h.test(s.text));
    const looping = s.compression_ratio > 2.6;
    if (likelySilence || known || looping) removed++;
    else kept.push(s);
  }
  return {
    text: kept
      .map((s) => s.text.trim())
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
    removed,
  };
}

export function mattr(tokens: string[], window = 25): number {
  if (tokens.length === 0) return 0;
  if (tokens.length <= window) return new Set(tokens).size / tokens.length;
  let sum = 0;
  let n = 0;
  for (let i = 0; i + window <= tokens.length; i++) {
    sum += new Set(tokens.slice(i, i + window)).size / window;
    n++;
  }
  return sum / n;
}

export function countFillers(text: string): number {
  const lower = text.toLowerCase();
  let n = tokenize(lower).filter((t) => FILLERS.has(t)).length;
  for (const re of FILLER_PHRASES) n += (lower.match(re) ?? []).length;
  return n;
}

/** Immediate word repetitions ("I I think", "the the"), ignoring fillers. */
export function countRepetitions(tokens: string[]): number {
  let n = 0;
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] === tokens[i - 1] && !FILLERS.has(tokens[i])) n++;
  }
  return n;
}

function pauses(words: WhisperWord[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < words.length; i++) out.push(Math.max(0, words[i].start - words[i - 1].end));
  return out;
}

export function extractFeatures(r: WhisperVerbose, text: string): SpeechFeatures {
  const tokens = tokenize(text);
  const words = (r.words ?? []).filter((w) => normaliseWord(w.word));
  const gaps = pauses(words);
  const longGaps = gaps.filter((g) => g > 1);
  const span = words.length ? words[words.length - 1].end - words[0].start : r.duration;
  const speakingSec = Math.max(0.001, span - longGaps.reduce((a, b) => a + b, 0));

  // Runs: sequences of words separated by pauses > 0.5 s.
  const runs: number[] = [];
  let run = words.length ? 1 : 0;
  for (const g of gaps) {
    if (g > 0.5) {
      runs.push(run);
      run = 1;
    } else run++;
  }
  if (run) runs.push(run);

  const segs = (r.segments ?? []).filter((s) => s.text.trim());
  const fillerCount = countFillers(text);
  const round = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

  return {
    durationSec: round(r.duration ?? span),
    wordCount: tokens.length,
    articulationWpm: round(tokens.length && words.length ? (words.length / speakingSec) * 60 : 0),
    speechRateWpm: round(r.duration ? (tokens.length / r.duration) * 60 : 0),
    pausesOver1s: longGaps.length,
    longestPauseSec: round(gaps.length ? Math.max(...gaps) : 0),
    meanLengthOfRun: round(runs.length ? runs.reduce((a, b) => a + b, 0) / runs.length : 0),
    fillerCount,
    fillersPer100Words: round(tokens.length ? (fillerCount / tokens.length) * 100 : 0),
    repetitions: countRepetitions(tokens),
    lexicalDiversity: round(mattr(tokens.filter((t) => !FILLERS.has(t))), 3),
    meanLogprob: segs.length ? round(segs.reduce((a, s) => a + s.avg_logprob, 0) / segs.length, 3) : null,
  };
}
