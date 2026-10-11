import type { Clock } from "@/engine/types";

/** Real clock based on performance.now() (monotonic; no drift from Date changes). */
export const browserClock: Clock = {
  now: () => performance.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const id = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(id);
        reject(abortError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    }),
};

export function abortError(): Error {
  const e = new Error("Aborted");
  e.name = "AbortError";
  return e;
}
