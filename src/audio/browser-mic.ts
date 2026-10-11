import type { Microphone, Recording, VoiceEvent } from "@/engine/types";

/**
 * Browser microphone: MediaRecorder for the answer audio plus an
 * energy-based voice-activity detector (VAD) with an adaptive noise floor
 * and hysteresis. The VAD runs continuously (it also drives the level
 * meter) but only emits events while a take is open and not paused.
 *
 * The VAD sits behind the `Microphone` port, so it can later be swapped for
 * Silero VAD (plan-2 §3.2) without touching the engine.
 *
 * If the device disappears (unplugged, Bluetooth drop), `onLost` pauses the
 * exam. The next take asks the browser for the microphone again, so the exam
 * continues on the reconnected device instead of a dead stream.
 */

const CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
};
const RECONNECT_MESSAGE = "The microphone isn't available. Reconnect it, then press Continue.";

const FRAME_MS = 30;
const START_FRAMES = 4; // ~120 ms above threshold → speech start
const END_FRAMES = 12; // ~360 ms below threshold → speech end
const MARGIN_DB = 12; // threshold above the noise floor
const HYSTERESIS_DB = 4;
const MIN_THRESHOLD_DB = -55;
const MAX_THRESHOLD_DB = -28;

export function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

export class MicPermissionError extends Error {}

function micError(e: unknown): MicPermissionError {
  const name = e instanceof Error ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return new MicPermissionError(
      "Microphone access was blocked. Allow the microphone in your browser's site settings, then try again.",
    );
  }
  if (name === "NotFoundError")
    return new MicPermissionError("No microphone was found. Connect a microphone and try again.");
  return new MicPermissionError("The microphone could not be started. Close other apps using it and try again.");
}

export class BrowserMic implements Microphone {
  private readonly listeners = new Set<(e: VoiceEvent) => void>();
  private readonly analyser: AnalyserNode;
  private readonly samples: Float32Array<ArrayBuffer>;
  private readonly timer: ReturnType<typeof setInterval>;
  private stream: MediaStream;
  private source: MediaStreamAudioSourceNode;
  private disposed = false;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private takeStartedAt = 0;
  private pausedMs = 0;
  private pausedAt: number | null = null;
  private takeOpen = false;
  private muted = false;

  // VAD state
  private noiseFloorDb = -60;
  private currentDb = -100;
  private speaking = false;
  private aboveCount = 0;
  private belowCount = 0;
  private firstAboveAt = 0;
  private firstBelowAt = 0;

  /** Called when the microphone disappears (unplugged / permission revoked). */
  onLost: (() => void) | null = null;
  readonly mimeType: string;

  private constructor(
    private readonly ctx: AudioContext,
    stream: MediaStream,
  ) {
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.stream = stream;
    this.source = this.attach(stream);
    this.samples = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
    this.mimeType = pickMimeType();
    this.timer = setInterval(() => this.frame(), FRAME_MS);
  }

  /** Feeds a stream into the level meter / VAD and watches it for loss. */
  private attach(stream: MediaStream): MediaStreamAudioSourceNode {
    const source = this.ctx.createMediaStreamSource(stream);
    source.connect(this.analyser);
    for (const track of stream.getAudioTracks()) {
      track.addEventListener("ended", () => {
        if (stream === this.stream && !this.disposed) this.onLost?.();
      });
    }
    return source;
  }

  private get isLive(): boolean {
    return this.stream.getAudioTracks().some((t) => t.readyState === "live");
  }

  /** Asks the browser for the microphone again and switches to the new stream. */
  private async reconnect(): Promise<void> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
    } catch (e) {
      const err = micError(e);
      if (err.message.startsWith("No microphone")) throw new MicPermissionError(RECONNECT_MESSAGE);
      throw err;
    }
    if (this.disposed) {
      for (const t of stream.getTracks()) t.stop();
      return;
    }
    const old = this.stream;
    this.source.disconnect();
    this.stream = stream;
    this.source = this.attach(stream);
    for (const t of old.getTracks()) t.stop();
    this.noiseFloorDb = -60;
    this.resetVad();
  }

  private startRecorder(): MediaRecorder {
    const rec = new MediaRecorder(this.stream, {
      ...(this.mimeType ? { mimeType: this.mimeType } : {}),
      audioBitsPerSecond: 32_000,
    });
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    rec.start(500);
    return rec;
  }

  static async create(ctx: AudioContext): Promise<BrowserMic> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new MicPermissionError(
        "This browser cannot record audio. Please use a recent version of Chrome, Edge, Firefox or Safari.",
      );
    }
    try {
      return new BrowserMic(ctx, await navigator.mediaDevices.getUserMedia(CONSTRAINTS));
    } catch (e) {
      throw micError(e);
    }
  }

  /** Input level 0..1 for the meter. */
  level = (): number => Math.max(0, Math.min(1, (this.currentDb + 60) / 50));

  get isSpeaking(): boolean {
    return this.speaking;
  }

  async open(): Promise<void> {
    if (this.takeOpen) await this.close(false);
    this.chunks = [];
    this.pausedMs = 0;
    this.pausedAt = null;
    this.resetVad();
    // After a disconnect the old stream is dead: get the microphone again first.
    if (!this.isLive) await this.reconnect();
    if (typeof MediaRecorder !== "undefined") {
      try {
        this.recorder = this.startRecorder();
      } catch {
        // The device changed under us (e.g. reconnected): one fresh attempt.
        await this.reconnect();
        try {
          this.recorder = this.startRecorder();
        } catch {
          throw new MicPermissionError(RECONNECT_MESSAGE);
        }
      }
    }
    this.takeStartedAt = performance.now();
    this.muted = false;
    this.takeOpen = true;
  }

  pause(): void {
    this.muted = true;
    if (this.recorder?.state === "recording") this.recorder.pause();
    this.pausedAt = performance.now();
    this.endSpeechIfNeeded(performance.now());
  }

  resume(): void {
    if (this.pausedAt !== null) this.pausedMs += performance.now() - this.pausedAt;
    this.pausedAt = null;
    if (this.recorder?.state === "paused") this.recorder.resume();
    this.resetVad();
    this.muted = false;
  }

  async close(keep: boolean): Promise<Recording | null> {
    this.takeOpen = false;
    const rec = this.recorder;
    this.recorder = null;
    const durationMs = performance.now() - this.takeStartedAt - this.pausedMs;
    if (!rec) return null;
    if (rec.state !== "inactive") {
      // A recorder on a lost device may never fire "stop": don't wait forever.
      await new Promise<void>((resolve) => {
        const done = setTimeout(resolve, 1_500);
        rec.onstop = () => {
          clearTimeout(done);
          resolve();
        };
        try {
          rec.stop();
        } catch {
          clearTimeout(done);
          resolve();
        }
      });
    }
    if (!keep) return null;
    const type = rec.mimeType || this.mimeType || "audio/webm";
    return { blob: new Blob(this.chunks, { type }), mimeType: type, durationMs };
  }

  onVoice(cb: (e: VoiceEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    this.disposed = true;
    clearInterval(this.timer);
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    for (const t of this.stream.getTracks()) t.stop();
    this.listeners.clear();
  }

  // ------------------------------------------------------------------- VAD

  private resetVad() {
    this.speaking = false;
    this.aboveCount = 0;
    this.belowCount = 0;
  }

  private frame() {
    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (const s of this.samples) sum += s * s;
    const rms = Math.sqrt(sum / this.samples.length);
    const db = 20 * Math.log10(rms + 1e-9);
    this.currentDb = db;
    const now = performance.now();

    // Adaptive noise floor: falls quickly, rises slowly, frozen while speaking.
    if (!this.speaking) {
      if (db < this.noiseFloorDb) this.noiseFloorDb = 0.7 * this.noiseFloorDb + 0.3 * db;
      else if (db < this.noiseFloorDb + 6) this.noiseFloorDb = 0.98 * this.noiseFloorDb + 0.02 * db;
    }
    const threshold = Math.min(MAX_THRESHOLD_DB, Math.max(MIN_THRESHOLD_DB, this.noiseFloorDb + MARGIN_DB));

    if (!this.speaking) {
      if (db > threshold) {
        if (this.aboveCount === 0) this.firstAboveAt = now;
        if (++this.aboveCount >= START_FRAMES) {
          this.speaking = true;
          this.belowCount = 0;
          this.emit({ type: "speech_start", at: this.firstAboveAt });
        }
      } else this.aboveCount = 0;
    } else {
      if (db < threshold - HYSTERESIS_DB) {
        if (this.belowCount === 0) this.firstBelowAt = now;
        if (++this.belowCount >= END_FRAMES) {
          this.speaking = false;
          this.aboveCount = 0;
          this.emit({ type: "speech_end", at: this.firstBelowAt });
        }
      } else this.belowCount = 0;
    }
  }

  private endSpeechIfNeeded(at: number) {
    if (this.speaking) {
      this.speaking = false;
      this.emit({ type: "speech_end", at });
    }
  }

  private emit(e: VoiceEvent) {
    if (!this.takeOpen || this.muted) return;
    for (const l of this.listeners) l(e);
  }
}
