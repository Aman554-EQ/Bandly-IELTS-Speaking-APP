import type { Cues } from "@/engine/types";

/** Soft cue tones generated with Web Audio (no files). */
export function createCues(ctx: AudioContext): Cues {
  const beep = (freq: number, startOffset: number, durationS: number, peak = 0.08) => {
    const t0 = ctx.currentTime + startOffset;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationS);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + durationS + 0.02);
  };
  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  return {
    // The mic opens after the tone has finished, so it is never recorded.
    listen: async () => {
      beep(660, 0, 0.12, 0.05);
      await wait(160);
    },
    timeUp: async () => {
      beep(880, 0, 0.18);
      beep(660, 0.2, 0.25);
      await wait(480);
    },
  };
}
