import type { ExaminerProfile } from "@/engine/examiners";
import type { Clip, Speaker } from "@/engine/types";
import { abortError } from "./browser-clock";
import { chooseVoice } from "./voice-select";

/**
 * Plays the examiner's pre-rendered clips (Kokoro, British voice) with the
 * fallback chain from plan-2 §4.9:
 *
 *   1. pre-rendered clip from /voice/manifest.json (only if its text matches)
 *   2. the browser's built-in voice (SpeechSynthesis), always of the examiner's
 *      gender: en-GB first, never the other gender (see voice-select.ts)
 *   3. silent wait for the reading time (captions are forced on by the UI)
 *
 * All clips of a session are downloaded and decoded before the exam starts,
 * so there is no loading delay between questions.
 */

interface ManifestEntry {
  file: string;
  text: string;
  durationMs: number;
}

interface Manifest {
  examiner?: { name: string; voice: string };
  clips: Record<string, ManifestEntry>;
}

export type VoiceSource = "clip" | "browser" | "text";

export class ClipSpeaker implements Speaker {
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly analyser: AnalyserNode;
  private readonly levelData: Uint8Array<ArrayBuffer>;
  private browserVoice: SpeechSynthesisVoice | null = null;
  private browserPitch = 1;
  /** Which source spoke the most recent line (for diagnostics / UI). */
  lastSource: VoiceSource = "clip";
  /** Called when a line can't be spoken in the examiner's voice and is shown as text instead. */
  onTextFallback: (() => void) | null = null;
  /** Count of clips that will use a fallback. */
  missing = 0;

  private readonly baseUrl: string;

  constructor(
    private readonly ctx: AudioContext,
    private readonly examiner: ExaminerProfile,
  ) {
    this.baseUrl = `/voice/${examiner.id}/`;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.connect(ctx.destination);
    this.levelData = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
  }

  /** 0..1 output level, used to animate the examiner's voice indicator. */
  level = (): number => {
    this.analyser.getByteTimeDomainData(this.levelData);
    let sum = 0;
    for (const v of this.levelData) {
      const x = (v - 128) / 128;
      sum += x * x;
    }
    return Math.min(1, Math.sqrt(sum / this.levelData.length) * 4);
  };

  async prepare(clips: Clip[], onProgress?: (done: number, total: number) => void): Promise<void> {
    const choice = chooseVoice(await loadVoices(), this.examiner.gender, this.examiner.browserVoiceHints);
    this.browserVoice = choice.voice;
    this.browserPitch = choice.pitch;
    // A leftover utterance (e.g. from a previous attempt) must never speak over this examiner.
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    let manifest: Manifest = { clips: {} };
    try {
      const res = await fetch(`${this.baseUrl}manifest.json`, { cache: "no-cache" });
      if (res.ok) manifest = (await res.json()) as Manifest;
    } catch {
      /* no manifest: everything falls back to the browser voice */
    }

    let done = 0;
    this.missing = 0;
    onProgress?.(0, clips.length);
    const queue = [...clips];
    const worker = async () => {
      for (let clip = queue.shift(); clip; clip = queue.shift()) {
        const entry = manifest.clips[clip.key];
        if (entry && entry.text === clip.text && !this.buffers.has(clip.key)) {
          try {
            const res = await fetch(`${this.baseUrl}${entry.file}`);
            if (!res.ok) throw new Error(String(res.status));
            this.buffers.set(clip.key, await this.ctx.decodeAudioData(await res.arrayBuffer()));
          } catch {
            this.missing++;
          }
        } else if (!this.buffers.has(clip.key)) {
          this.missing++;
        }
        onProgress?.(++done, clips.length);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
  }

  async say(clip: Clip, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw abortError();
    if (this.ctx.state === "suspended") await this.ctx.resume().catch(() => undefined);

    const buffer = this.buffers.get(clip.key);
    if (buffer) {
      this.lastSource = "clip";
      return this.playBuffer(buffer, signal);
    }
    // Only with a voice of the examiner's gender; otherwise the line is shown as text.
    if (typeof window !== "undefined" && "speechSynthesis" in window && this.browserVoice) {
      this.lastSource = "browser";
      try {
        return await this.speakWithBrowser(clip.text, signal);
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") throw e;
      }
    }
    this.lastSource = "text";
    this.onTextFallback?.();
    return waitFor(readingTimeMs(clip.text), signal);
  }

  private playBuffer(buffer: AudioBuffer, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.analyser);
      const onAbort = () => {
        src.onended = null;
        try {
          src.stop();
        } catch {
          /* already stopped */
        }
        reject(abortError());
      };
      src.onended = () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      };
      signal.addEventListener("abort", onAbort, { once: true });
      src.start();
    });
  }

  /** Speaks sentence by sentence (avoids Chrome cutting off long utterances). */
  private async speakWithBrowser(text: string, signal: AbortSignal): Promise<void> {
    const synth = window.speechSynthesis;
    const sentences = text.split(/(?<=[.?!])\s+/).filter(Boolean);
    for (const sentence of sentences) {
      await new Promise<void>((resolve, reject) => {
        const u = new SpeechSynthesisUtterance(sentence);
        if (this.browserVoice) u.voice = this.browserVoice;
        u.lang = this.browserVoice?.lang ?? "en-GB";
        u.rate = 0.95;
        u.pitch = this.browserPitch;
        // Safety net: some browsers never fire `end`.
        const guard = setTimeout(() => resolve(), readingTimeMs(sentence) + 4_000);
        const onAbort = () => {
          clearTimeout(guard);
          synth.cancel();
          reject(abortError());
        };
        u.onend = () => {
          clearTimeout(guard);
          signal.removeEventListener("abort", onAbort);
          resolve();
        };
        u.onerror = (ev) => {
          clearTimeout(guard);
          signal.removeEventListener("abort", onAbort);
          if (ev.error === "interrupted" || ev.error === "canceled") reject(abortError());
          else reject(new Error(ev.error));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        synth.speak(u);
      });
    }
  }
}

/** ~150 words per minute, minimum 1 second. */
export function readingTimeMs(text: string): number {
  return Math.max(1_000, text.split(/\s+/).length * 400);
}

function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(id);
        reject(abortError());
      },
      { once: true },
    );
  });
}

/** The browser's voices (they may load asynchronously the first time). */
async function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length) return now;
  return new Promise<SpeechSynthesisVoice[]>((resolve) => {
    const t = setTimeout(() => resolve(synth.getVoices()), 1_500);
    synth.addEventListener(
      "voiceschanged",
      () => {
        clearTimeout(t);
        resolve(synth.getVoices());
      },
      { once: true },
    );
  });
}
