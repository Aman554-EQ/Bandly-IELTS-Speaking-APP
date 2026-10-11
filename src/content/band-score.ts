/**
 * IELTS band score arithmetic (pure, no React): raw → band conversion for
 * Listening and Reading, and the overall band with official rounding.
 *
 * The conversion tables are the commonly published guidance (IELTS partners,
 * Cambridge books). Official conversions vary slightly from test to test.
 */

export type Module = "listening" | "reading" | "writing" | "speaking";
export type ReadingType = "academic" | "general";

/** [minimum raw score out of 40, band], highest first. */
type Table = readonly (readonly [number, number])[];

export const LISTENING_TABLE: Table = [
  [39, 9],
  [37, 8.5],
  [35, 8],
  [32, 7.5],
  [30, 7],
  [26, 6.5],
  [23, 6],
  [18, 5.5],
  [16, 5],
  [13, 4.5],
  [10, 4],
  [8, 3.5],
  [6, 3],
  [4, 2.5],
  [3, 2],
  [1, 1],
  [0, 0],
];

export const ACADEMIC_READING_TABLE: Table = [
  [39, 9],
  [37, 8.5],
  [35, 8],
  [33, 7.5],
  [30, 7],
  [27, 6.5],
  [23, 6],
  [19, 5.5],
  [15, 5],
  [13, 4.5],
  [10, 4],
  [8, 3.5],
  [6, 3],
  [4, 2.5],
  [3, 2],
  [1, 1],
  [0, 0],
];

export const GENERAL_READING_TABLE: Table = [
  [40, 9],
  [39, 8.5],
  [37, 8],
  [36, 7.5],
  [34, 7],
  [32, 6.5],
  [30, 6],
  [27, 5.5],
  [23, 5],
  [19, 4.5],
  [15, 4],
  [12, 3.5],
  [9, 3],
  [6, 2.5],
  [4, 2],
  [1, 1],
  [0, 0],
];

export const tableFor = (module: "listening" | "reading", type: ReadingType = "academic"): Table =>
  module === "listening" ? LISTENING_TABLE : type === "general" ? GENERAL_READING_TABLE : ACADEMIC_READING_TABLE;

/** Raw score (0–40, whole number) → band. Out-of-range input is clamped. */
export function rawToBand(raw: number, table: Table): number {
  const r = Math.max(0, Math.min(40, Math.floor(Number.isFinite(raw) ? raw : 0)));
  return table.find(([min]) => r >= min)?.[1] ?? 0;
}

/** Raw-score range for each band of a table, for display: "35–36 → 8.0". */
export function bandRanges(table: Table): { band: number; from: number; to: number }[] {
  return table.map(([min, band], i) => ({ band, from: min, to: i === 0 ? 40 : table[i - 1][0] - 1 }));
}

/** Fewest correct answers that reach `band` (null if the table can't reach it). */
export function rawNeededFor(band: number, table: Table): number | null {
  const hits = table.filter(([, b]) => b >= band);
  return hits.length ? hits[hits.length - 1][0] : null;
}

/**
 * Overall band: the mean of the four module bands, rounded to the nearest
 * half band, with .25 rounding up to .5 and .75 up to the next whole band.
 */
export function overallBand(bands: readonly number[]): number {
  if (bands.length === 0) return 0;
  const mean = bands.reduce((a, b) => a + b, 0) / bands.length;
  // Module bands are halves, so the mean is a multiple of 1/8: exact in binary.
  return Math.floor(mean * 2 + 0.5) / 2;
}

/** The unrounded mean, for "Average 7.75 → 8.0". */
export const averageBand = (bands: readonly number[]) =>
  bands.length ? bands.reduce((a, b) => a + b, 0) / bands.length : 0;

/** 0, 0.5, … 9. */
export const BAND_STEPS: number[] = Array.from({ length: 19 }, (_, i) => i / 2);

export const formatBand = (b: number) => b.toFixed(1);

/** Short official-style descriptor for a band. */
export function bandLabel(b: number): string {
  if (b >= 9) return "Expert user";
  if (b >= 8) return "Very good user";
  if (b >= 7) return "Good user";
  if (b >= 6) return "Competent user";
  if (b >= 5) return "Modest user";
  if (b >= 4) return "Limited user";
  if (b >= 3) return "Extremely limited user";
  if (b >= 2) return "Intermittent user";
  if (b >= 1) return "Non-user";
  return "Did not attempt";
}
