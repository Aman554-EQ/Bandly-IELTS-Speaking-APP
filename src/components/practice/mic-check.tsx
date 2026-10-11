"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMic, MicPermissionError } from "@/audio/browser-mic";
import { Button } from "@/components/ui/button";
import { LevelBars } from "./level-meter";

/**
 * Microphone check: permission, live level meter and a voice-detection test.
 * The AudioContext is created from the user's click (required by iOS Safari).
 */
export function MicCheck({
  summary,
  onReady,
  onBack,
}: {
  summary: string;
  onReady: (ctx: AudioContext, mic: BrowserMic) => void;
  onBack: () => void;
}) {
  const [state, setState] = useState<"idle" | "requesting" | "live" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [heard, setHeard] = useState(false);
  const [audio, setAudio] = useState<{ ctx: AudioContext; mic: BrowserMic } | null>(null);
  const audioRef = useRef<{ ctx: AudioContext; mic: BrowserMic } | null>(null);
  const handedOver = useRef(false);

  useEffect(
    () => () => {
      const a = audioRef.current;
      if (!handedOver.current && a) {
        a.mic.dispose();
        void a.ctx.close();
      }
    },
    [],
  );

  async function enable() {
    setState("requesting");
    setError(null);
    try {
      const ctx = new AudioContext();
      await ctx.resume();
      const mic = await BrowserMic.create(ctx);
      audioRef.current = { ctx, mic };
      setAudio({ ctx, mic });
      await mic.open(); // listen only; this take is discarded
      mic.onVoice((e) => {
        if (e.type === "speech_start") setHeard(true);
      });
      setState("live");
    } catch (e) {
      setError(e instanceof MicPermissionError ? e.message : "The microphone could not be started.");
      setState("error");
    }
  }

  async function start() {
    const a = audioRef.current;
    if (!a) return;
    await a.mic.close(false);
    handedOver.current = true;
    onReady(a.ctx, a.mic);
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">{summary}</p>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Microphone check</h1>
      <p className="mt-3 text-lg text-muted">
        Allow microphone access, then say a sentence such as <em>&ldquo;My name is … and I&rsquo;m ready.&rdquo;</em>
      </p>

      <div className="card mt-8 p-6 sm:p-8">
        {(state === "idle" || state === "requesting") && (
          <Button size="xl" onClick={enable} disabled={state === "requesting"} className="w-full">
            {state === "requesting" ? "Waiting for permission…" : "🎙  Enable microphone"}
          </Button>
        )}

        {state === "error" && (
          <div role="alert" className="space-y-4">
            <p className="rounded-xl bg-danger-soft p-4 font-medium text-danger">{error}</p>
            <Button variant="secondary" size="lg" onClick={enable}>
              Try again
            </Button>
          </div>
        )}

        {state === "live" && audio && (
          <div className="space-y-6">
            <div className="flex items-center gap-5 rounded-xl bg-surface-2 p-5">
              <LevelBars level={audio.mic.level} bars={11} color="var(--success)" />
              <p className="text-lg" aria-live="polite">
                {heard ? (
                  <span className="font-semibold text-success">✓ We can hear you clearly.</span>
                ) : (
                  <span className="text-muted">Speak now…</span>
                )}
              </p>
            </div>
            <ul className="space-y-2 text-[15px]">
              <li>• The examiner speaks first. Your microphone opens after a short tone.</li>
              <li>• Stop talking when you have finished; the examiner listens and then continues.</li>
              <li>• You can ask the examiner to repeat a question, just like in the real test.</li>
            </ul>
            <Button size="xl" className="w-full" onClick={start} disabled={!heard}>
              Start the test
            </Button>
            {!heard && <p className="text-center text-sm text-muted">The button unlocks once we hear your voice.</p>}
          </div>
        )}
      </div>

      <Button variant="ghost" className="mt-6" onClick={onBack}>
        ← Back to setup
      </Button>
    </div>
  );
}
