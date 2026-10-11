import type { TurnAnalysis } from "@/engine/interaction";
import type { Recording, TakeMeta, TurnAnalyzer } from "@/engine/types";

/**
 * Browser implementation of the engine's live-listening port: sends each
 * take to /api/sessions/:id/turns, which transcribes it, works out what the
 * candidate meant and stores it in the session.
 *
 * Requests keep running even if the engine stops waiting (timeout), so every
 * take is still stored for scoring. `waitAll()` is called before scoring.
 */
export class SessionTurnClient implements TurnAnalyzer {
  private readonly pending = new Set<Promise<unknown>>();
  private listeners = new Set<() => void>();
  private stats = { sent: 0, done: 0, failed: 0 };
  private version = 0;

  constructor(private readonly sessionId: string) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getVersion = () => this.version;

  counts() {
    return { ...this.stats, pending: this.pending.size };
  }

  analyze(take: TakeMeta, recording: Recording | null): Promise<TurnAnalysis> {
    this.stats.sent++;
    this.changed();
    const p = this.send(take, recording).then(
      (r) => {
        this.stats.done++;
        return r;
      },
      (e) => {
        this.stats.failed++;
        throw e;
      },
    );
    const tracked = p.finally(() => {
      this.pending.delete(tracked);
      this.changed();
    });
    this.pending.add(tracked);
    tracked.catch(() => undefined);
    return p;
  }

  /** Waits for every take to be stored (or until `timeoutMs`). */
  async waitAll(timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.pending.size > 0 && Date.now() < deadline) {
      await Promise.race([Promise.allSettled([...this.pending]), new Promise((r) => setTimeout(r, 500))]);
    }
  }

  private async send(take: TakeMeta, recording: Recording | null, attempt = 1): Promise<TurnAnalysis> {
    const form = new FormData();
    form.append("meta", JSON.stringify(take));
    const blob = recording?.blob;
    if (blob && blob.size > 1_000) {
      const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
      form.append("audio", blob, `${take.takeId}.${ext}`);
    }
    const res = await fetch(`/api/sessions/${this.sessionId}/turns`, { method: "POST", body: form });
    if (res.ok) return ((await res.json()) as { analysis: TurnAnalysis }).analysis;
    // Retry transient failures in the background (the engine may already have moved on).
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const ra = Number(res.headers.get("retry-after"));
      await new Promise((r) => setTimeout(r, Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1_500 * attempt));
      return this.send(take, recording, attempt + 1);
    }
    throw new Error(`Turn upload failed (${res.status})`);
  }

  private changed() {
    this.version++;
    for (const l of this.listeners) l();
  }
}
