/**
 * IELTS overall band rounding: the mean of the criteria is rounded to the
 * nearest half band, where .25 rounds up to .5 and .75 rounds up to the next
 * whole band (e.g. 6.125 → 6.0, 6.25 → 6.5, 6.75 → 7.0).
 */
export function roundIeltsBand(mean: number): number {
  const clamped = Math.min(9, Math.max(0, mean));
  const whole = Math.floor(clamped);
  const frac = Math.round((clamped - whole) * 1000) / 1000; // avoid float noise
  if (frac < 0.25) return whole;
  if (frac < 0.75) return whole + 0.5;
  return whole + 1;
}

export function overallBand(criteria: number[]): number {
  if (criteria.length === 0) throw new Error("No criteria");
  return roundIeltsBand(criteria.reduce((a, b) => a + b, 0) / criteria.length);
}
