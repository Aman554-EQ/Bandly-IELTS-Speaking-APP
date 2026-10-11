import type { Clock } from "../types";

interface Timer {
  at: number;
  seq: number;
  resolve: () => void;
}

/**
 * Deterministic clock for tests: time only moves when `run()` advances it to
 * the next pending timer, after all promise callbacks have settled.
 */
export class VirtualClock implements Clock {
  private t = 0;
  private seq = 0;
  private timers: Timer[] = [];
  private holds = 0;

  /**
   * Freezes virtual time while `p` (real I/O, e.g. a network call) is in
   * flight, so timeouts do not fire before the real response arrives.
   */
  hold<T>(p: Promise<T>): Promise<T> {
    this.holds++;
    return p.finally(() => {
      this.holds--;
    });
  }

  now(): number {
    return this.t;
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      const timer: Timer = { at: this.t + Math.max(0, ms), seq: this.seq++, resolve };
      this.timers.push(timer);
      signal?.addEventListener(
        "abort",
        () => {
          this.timers = this.timers.filter((x) => x !== timer);
          reject(abortError());
        },
        { once: true },
      );
    });
  }

  /** Schedule a callback at an absolute virtual time. */
  at(time: number, fn: () => void): void {
    this.timers.push({ at: Math.max(time, this.t), seq: this.seq++, resolve: fn });
  }

  /**
   * Advance until `done` settles or no timers remain. `hook` is called after
   * each advance so tests can inject user actions at given times.
   */
  async run<T>(done: Promise<T>, opts: { limitMs?: number; hook?: (now: number) => void } = {}): Promise<T> {
    let settled = false;
    let value: T | undefined;
    let error: unknown;
    done.then(
      (v) => {
        settled = true;
        value = v;
      },
      (e) => {
        settled = true;
        error = e ?? new Error("rejected");
      },
    );
    const limit = opts.limitMs ?? 60 * 60 * 1000;
    for (;;) {
      await flush();
      while (this.holds > 0) {
        await new Promise((r) => setTimeout(r, 10));
        await flush();
      }
      if (settled) break;
      if (this.timers.length === 0) throw new Error(`VirtualClock: deadlock at t=${this.t}ms (no timers pending)`);
      this.timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = this.timers.shift()!;
      this.t = next.at;
      if (this.t > limit) throw new Error(`VirtualClock: exceeded ${limit}ms`);
      next.resolve();
      opts.hook?.(this.t);
    }
    if (error) throw error;
    return value as T;
  }
}

function abortError(): Error {
  const e = new Error("Aborted");
  e.name = "AbortError";
  return e;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise<void>((r) => setImmediate(r));
}
