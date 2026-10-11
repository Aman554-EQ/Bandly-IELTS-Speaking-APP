import { FALLBACK_ANALYSIS, type TurnAnalysis } from "../interaction";
import type {
  AnswerRecord,
  Clip,
  Cues,
  Microphone,
  Recording,
  Speaker,
  TakeMeta,
  TurnAnalyzer,
  VoiceEvent,
} from "../types";
import type { VirtualClock } from "./virtual-clock";

/**
 * Scripted live-analysis port: decides what the candidate "said" for each
 * take, optionally after a delay (to test timeouts).
 */
export class FakeAnalyzer implements TurnAnalyzer {
  readonly takes: TakeMeta[] = [];

  constructor(
    private readonly clock: VirtualClock,
    private readonly script: (take: TakeMeta) => Partial<TurnAnalysis> | undefined,
    private readonly delayMs = 800,
  ) {}

  async analyze(take: TakeMeta): Promise<TurnAnalysis> {
    this.takes.push(take);
    await this.clock.sleep(this.delayMs);
    return { ...FALLBACK_ANALYSIS, source: "llm", transcript: "answer", ...(this.script(take) ?? {}) };
  }
}

/** Examiner speaks at ~150 words per minute (400 ms per word, min 600 ms). */
export function clipDurationMs(clip: Clip): number {
  return Math.max(600, clip.text.split(/\s+/).length * 400);
}

export class FakeSpeaker implements Speaker {
  readonly spoken: string[] = [];
  lastKey: string | null = null;

  constructor(private readonly clock: VirtualClock) {}

  async prepare(clips: Clip[], onProgress?: (d: number, t: number) => void): Promise<void> {
    onProgress?.(clips.length, clips.length);
  }

  async say(clip: Clip, signal: AbortSignal): Promise<void> {
    this.spoken.push(clip.key);
    this.lastKey = clip.key;
    await this.clock.sleep(clipDurationMs(clip), signal);
  }
}

/** Speech segments relative to the moment the mic opens: [startMs, endMs][]. */
export type Segments = [number, number][];

/**
 * Decides how the simulated student responds, based on the examiner's last
 * line (`lastKey`) and how many times the mic has opened after that line.
 */
export type StudentScript = (lastKey: string, attempt: number) => Segments;

export class FakeMic implements Microphone {
  private listeners = new Set<(e: VoiceEvent) => void>();
  private take = 0;
  private active = false;
  private attempts = new Map<string, number>();
  readonly opened: string[] = [];

  constructor(
    private readonly clock: VirtualClock,
    private readonly speaker: FakeSpeaker,
    private readonly student: StudentScript,
  ) {}

  async open(): Promise<void> {
    this.active = true;
    this.take++;
    this.schedule();
  }

  pause(): void {
    this.take++; // cancel pending events of this segment
  }

  resume(): void {
    this.schedule();
  }

  async close(keep: boolean): Promise<Recording | null> {
    this.active = false;
    this.take++;
    return keep ? { blob: null, mimeType: "audio/test", durationMs: 0 } : null;
  }

  onVoice(cb: (e: VoiceEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private schedule() {
    const key = this.speaker.lastKey ?? "";
    const attempt = this.attempts.get(key) ?? 0;
    this.attempts.set(key, attempt + 1);
    this.opened.push(key);
    const take = this.take;
    const base = this.clock.now();
    for (const [start, end] of this.student(key, attempt)) {
      this.clock.at(base + start, () => this.fire(take, { type: "speech_start", at: base + start }));
      this.clock.at(base + end, () => this.fire(take, { type: "speech_end", at: base + end }));
    }
  }

  private fire(take: number, e: VoiceEvent) {
    if (!this.active || take !== this.take) return;
    for (const l of this.listeners) l(e);
  }
}

export const silentCues: Cues = {
  listen: async () => {},
  timeUp: async () => {},
};

/** One continuous utterance starting after `delay` ms and lasting `len` ms. */
export const speech = (len: number, delay = 800): Segments => [[delay, delay + len]];

export function collectAnswers() {
  const answers: AnswerRecord[] = [];
  const sink = async (a: AnswerRecord) => {
    answers.push(a);
  };
  return { answers, sink };
}
