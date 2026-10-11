import type { TurnOutcome, TurnPolicy, VoiceEvent } from "./types";

/**
 * Decides when a student's turn is over (plan-2 §4.5 and §4.6).
 *
 * Pure and synchronous: it receives voice-activity events and clock ticks
 * with explicit timestamps and returns a decision. No timers inside, so it
 * can be tested exhaustively with plain numbers.
 */

export type TurnDecision = { outcome: Exclude<TurnOutcome, "repeat_requested" | "manual_finish">; at: number } | null;

export class TurnController {
  private speaking = false;
  private speechStartedAt: number | null = null;
  private firstSpeechAt: number | null = null;
  private lastSpeechEndAt: number | null = null;
  private accumulatedSpeechMs = 0;
  private capReachedAt: number | null = null;
  /** Start of the current no-response window (reset after a nudge). */
  private noResponseBase: number;
  private noResponseFired = false;
  private earlyStopFired = false;

  constructor(
    private readonly policy: TurnPolicy,
    private readonly openedAt: number,
    private readonly graceMs: number,
  ) {
    this.noResponseBase = openedAt;
  }

  /**
   * Continue the same turn after the examiner spoke briefly (Part 2 nudge or
   * "Can you tell me anything more?"). The turn's clock keeps running, but
   * silence and no-response windows restart from `now`. A second
   * no-response is allowed to fire after a resume.
   */
  resume(now: number): void {
    if (this.speaking) this.onVoice({ type: "speech_end", at: now });
    this.capReachedAt = null;
    if (this.hasSpoken) this.lastSpeechEndAt = now;
    this.noResponseBase = now;
    this.noResponseFired = false;
  }

  get startedAt(): number {
    return this.openedAt;
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  get hasSpoken(): boolean {
    return this.firstSpeechAt !== null;
  }

  speechMs(now: number): number {
    return this.accumulatedSpeechMs + (this.speaking && this.speechStartedAt !== null ? now - this.speechStartedAt : 0);
  }

  firstSpeechLatencyMs(): number | null {
    return this.firstSpeechAt === null ? null : this.firstSpeechAt - this.openedAt;
  }

  /** Feed a VAD event. Returns a decision if the event ends the turn. */
  onVoice(e: VoiceEvent): TurnDecision {
    if (e.type === "speech_start" && !this.speaking) {
      this.speaking = true;
      this.speechStartedAt = e.at;
      if (this.firstSpeechAt === null) this.firstSpeechAt = e.at;
    } else if (e.type === "speech_end" && this.speaking) {
      this.speaking = false;
      this.accumulatedSpeechMs += e.at - (this.speechStartedAt ?? e.at);
      this.speechStartedAt = null;
      this.lastSpeechEndAt = e.at;
      // Graceful interruption: the student paused after the hard cap.
      if (this.capReachedAt !== null) return { outcome: "interrupted", at: e.at };
    }
    return null;
  }

  /** Evaluate timers at `now`. Returns a decision or null to keep listening. */
  tick(now: number): TurnDecision {
    const p = this.policy;
    const elapsed = now - this.openedAt;

    // 1. Hard cap, with a grace window to wait for a natural pause.
    if (elapsed >= p.hardCapMs) {
      if (!this.speaking) return { outcome: this.hasSpoken ? "interrupted" : "no_response", at: now };
      if (this.capReachedAt === null) this.capReachedAt = now;
      if (now - this.capReachedAt >= this.graceMs) return { outcome: "interrupted", at: now };
      return null;
    }

    // 2. No response: mic open and no speech yet.
    if (!this.hasSpoken) {
      if (p.noResponseMs !== null && !this.noResponseFired && now - this.noResponseBase >= p.noResponseMs) {
        this.noResponseFired = true;
        return { outcome: "no_response", at: now };
      }
      return null;
    }

    // 3. Student is silent after speaking: end of turn?
    if (!this.speaking && this.lastSpeechEndAt !== null) {
      const silence = now - this.lastSpeechEndAt;

      if (elapsed < p.minElapsedMs) {
        // Part 2: stopped before the 1-minute mark → let the examiner encourage once.
        if (p.earlyStopSilenceMs !== null && !this.earlyStopFired && silence >= p.earlyStopSilenceMs) {
          this.earlyStopFired = true;
          return { outcome: "early_stop", at: now };
        }
        return null;
      }

      const enoughSpeech = this.speechMs(now) >= p.minSpeechMs;
      const needed = enoughSpeech ? p.endSilenceMs : p.extendedSilenceMs;
      if (silence >= needed) return { outcome: "end_of_turn", at: now };
    }
    return null;
  }

  /** Whether the "Repeat question" button is allowed right now. */
  canRepeat(now: number): boolean {
    return !this.hasSpoken || this.speechMs(now) < 1_000;
  }
}
