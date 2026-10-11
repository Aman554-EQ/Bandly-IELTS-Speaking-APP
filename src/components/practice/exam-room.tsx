"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { ExaminerProfile } from "@/engine/examiners";
import type { ExamRuntime } from "@/engine/runtime";
import type { CueCard, Part, Snapshot, TimerInfo } from "@/engine/types";
import { Button, Kbd } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { LevelBars } from "./level-meter";

const MODE_LABEL = { part1: "Part 1", part2: "Part 2", part3: "Part 3", full: "Full test" } as const;

function banner(phase: Snapshot["phase"], name: string): { text: string; tone: string } {
  const first = name.split(" ")[0];
  switch (phase) {
    case "speaking":
      return { text: `${first} is speaking. Please listen.`, tone: "bg-primary-soft text-primary border-primary/30" };
    case "listening":
      return { text: "Your turn: speak now", tone: "bg-danger-soft text-recording border-recording/40" };
    case "considering":
      return { text: `${first} is listening to your answer…`, tone: "bg-surface-2 text-ink border-line-strong" };
    case "preparing":
      return { text: "Preparation time: make notes", tone: "bg-accent-soft text-accent border-accent/40" };
    case "paused":
      return { text: "Test paused", tone: "bg-surface-2 text-ink border-line-strong" };
    case "ended":
      return { text: "The test has finished", tone: "bg-success-soft text-success border-success/40" };
    default:
      return { text: "…", tone: "bg-surface-2 text-muted border-line" };
  }
}

export function ExamRoom({
  runtime,
  examiner,
  cueCard,
  examinerLevel,
  micLevel,
  now,
  forceText = false,
}: {
  runtime: ExamRuntime;
  examiner: ExaminerProfile;
  cueCard: CueCard | null;
  examinerLevel: () => number;
  micLevel: () => number;
  now: () => number;
  /** A line couldn't be spoken in the examiner's voice: show the examiner's words, whatever the style. */
  forceText?: boolean;
}) {
  const snap = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [showTextChoice, setShowText] = useState(snap.fidelity === "guided");
  const showText = showTextChoice || forceText;
  const [notes, setNotes] = useState("");

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
      if (e.code === "Space" && snap.canFinish) {
        e.preventDefault();
        runtime.finishAnswer();
      } else if (e.key.toLowerCase() === "r" && snap.canRepeat) {
        runtime.requestRepeat();
      } else if (e.key.toLowerCase() === "p" && snap.canPause) {
        if (snap.phase === "paused") runtime.resume();
        else runtime.pause();
      }
    },
    [runtime, snap.canFinish, snap.canRepeat, snap.canPause, snap.phase],
  );
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  if (snap.phase === "loading" || snap.phase === "idle") {
    const p = snap.loadProgress;
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-4 py-20 text-center">
        <p className="font-display text-3xl font-semibold">Preparing your exam room</p>
        <p className="mt-2 text-muted">Loading {examiner.name}&rsquo;s voice…</p>
        <div
          className="mt-6 h-2 w-full overflow-hidden rounded-full bg-surface-2"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={p?.total ?? 1}
          aria-valuenow={p?.done ?? 0}
        >
          <div
            className="h-full bg-primary transition-[width]"
            style={{ width: `${p ? (p.done / Math.max(1, p.total)) * 100 : 5}%` }}
          />
        </div>
        <p className="mt-2 font-mono text-sm text-muted">{p ? `${p.done}/${p.total}` : ""}</p>
      </div>
    );
  }

  const b = banner(snap.phase, examiner.name);
  const listening = snap.phase === "listening";
  const textToShow = snap.caption ?? snap.question;

  return (
    <div className="flex flex-1 flex-col">
      {/* Exam bar */}
      <div className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 [@media(max-height:520px)]:py-2">
          <div className="flex items-center gap-3">
            <span className="rounded-lg bg-primary-soft px-3 py-1 text-sm font-semibold text-primary">
              {MODE_LABEL[snap.mode]}
            </span>
            <span className="text-sm text-muted">{snap.fidelity === "exam" ? "Exam style" : "Guided style"}</span>
          </div>
          <PartProgress parts={snap.partsInMode} current={snap.part} />
          <Button variant="danger" size="sm" onClick={() => setConfirmEnd(true)} disabled={snap.phase === "ended"}>
            End test
          </Button>
        </div>
      </div>

      <main className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:py-8 [@media(min-width:640px)_and_(max-height:520px)]:grid-cols-2 [@media(min-width:640px)_and_(max-height:520px)]:gap-4 [@media(min-width:640px)_and_(max-height:520px)]:py-3">
        <section className="flex flex-col gap-5" aria-label="Examiner and question">
          {/* Status banner */}
          <div
            className={`flex items-center justify-between gap-4 rounded-2xl border-2 px-5 py-4 [@media(max-height:520px)]:py-2.5 ${b.tone}`}
            aria-live="polite"
          >
            <p className="text-lg font-semibold sm:text-xl">{b.text}</p>
            {snap.phase === "considering" && (
              <span className="flex gap-1" aria-hidden="true">
                <span className="thinking-dot h-2.5 w-2.5 rounded-full bg-current" />
                <span className="thinking-dot h-2.5 w-2.5 rounded-full bg-current" />
                <span className="thinking-dot h-2.5 w-2.5 rounded-full bg-current" />
              </span>
            )}
          </div>

          {/* Examiner + question */}
          <div className="card p-4 sm:p-6">
            <div className="flex items-center gap-3 sm:gap-4">
              <span className="grid h-12 w-12 shrink-0 sm:h-14 sm:w-14 place-items-center rounded-full bg-primary font-display text-xl font-semibold text-primary-ink">
                {examiner.initials}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-semibold">{examiner.name}</p>
                <p className="truncate text-sm text-muted">IELTS Speaking examiner</p>
              </div>
              <LevelBars level={examinerLevel} active={snap.phase === "speaking"} bars={7} />
            </div>

            <div className="mt-4 rounded-xl bg-surface-2 p-4 sm:mt-6 sm:p-5">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">
                  {snap.caption ? "Examiner says" : "Current question"}
                </p>
                {snap.fidelity === "exam" && !forceText && (
                  <button
                    type="button"
                    onClick={() => setShowText((v) => !v)}
                    className="text-sm font-semibold text-primary hover:underline"
                  >
                    {showText ? "Hide text" : "Show text"}
                  </button>
                )}
              </div>
              <p
                className="min-h-[4.5rem] font-display text-xl leading-snug sm:text-2xl [@media(max-height:520px)]:min-h-0 [@media(max-height:520px)]:text-lg"
                aria-live="polite"
              >
                {showText ? (
                  (textToShow ?? <span className="text-muted">…</span>)
                ) : (
                  <span className="text-muted">Listen to the examiner. Text is hidden in exam style.</span>
                )}
              </p>
            </div>
          </div>

          {snap.error && (
            <div role="alert" className="rounded-2xl border-2 border-danger/40 bg-danger-soft p-5">
              <p className="font-semibold text-danger">{snap.error}</p>
              <Button className="mt-3" onClick={() => runtime.resume()}>
                Continue the test
              </Button>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-5" aria-label="Your answer">
          {snap.cueCardVisible && cueCard && <CueCardView card={cueCard} />}

          {snap.phase === "preparing" && snap.timer && (
            <div className="card p-6">
              <div className="flex items-center justify-between">
                <p className="text-lg font-semibold">Prepare your talk</p>
                <Countdown timer={snap.timer} now={now} />
              </div>
              <label htmlFor="notes" className="mt-4 block text-sm text-muted">
                Notes (optional; pen and paper is fine too)
              </label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={5}
                className="mt-2 w-full resize-none rounded-xl border border-line-strong bg-bg p-3 text-base outline-none focus:border-primary"
                placeholder="Key words, examples, the order of your ideas…"
              />
              {snap.canSkipPrep && (
                <Button variant="secondary" className="mt-3" onClick={() => runtime.skipPrep()}>
                  I&rsquo;m ready to start
                </Button>
              )}
            </div>
          )}

          {snap.phase !== "preparing" && snap.cueCardVisible && notes && (
            <details className="card p-4 text-sm" open>
              <summary className="cursor-pointer font-semibold">Your notes</summary>
              <p className="mt-2 whitespace-pre-wrap">{notes}</p>
            </details>
          )}

          {/* Answer panel */}
          <div
            className={`card flex flex-1 flex-col items-center justify-center p-5 text-center sm:p-8 [@media(max-height:520px)]:p-4 ${listening ? "ring-2 ring-recording/60" : ""}`}
          >
            {listening ? (
              <>
                <div
                  className={`relative grid h-24 w-24 place-items-center rounded-full bg-danger-soft ${snap.speechDetected ? "recording-ring" : ""}`}
                >
                  <MicIcon />
                </div>
                <p className="mt-4 text-xl font-semibold">{snap.speechDetected ? "Listening…" : "Speak now"}</p>
                <LevelBars level={micLevel} bars={13} color="var(--recording)" className="mt-3" />
                {snap.timer && <AnswerTimer timer={snap.timer} now={now} guided={snap.fidelity === "guided"} />}
              </>
            ) : snap.phase === "paused" ? (
              <>
                <p className="font-display text-2xl font-semibold">Test paused</p>
                <Button size="lg" className="mt-4" onClick={() => runtime.resume()}>
                  Resume
                </Button>
              </>
            ) : snap.phase === "considering" ? (
              <p className="text-lg text-muted">Thinking about what you said…</p>
            ) : snap.phase === "ended" ? (
              <p className="font-display text-2xl font-semibold">The test has ended</p>
            ) : (
              <p className="text-lg text-muted">
                {snap.phase === "speaking" ? "Your microphone opens after the examiner finishes." : "Get ready…"}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
            <Button size="lg" onClick={() => runtime.finishAnswer()} disabled={!snap.canFinish}>
              Finish answer <Kbd>Space</Kbd>
            </Button>
            <Button size="lg" variant="secondary" onClick={() => runtime.requestRepeat()} disabled={!snap.canRepeat}>
              Repeat question <Kbd>R</Kbd>
            </Button>
            {snap.canPause && (
              <Button
                size="lg"
                variant="secondary"
                className="min-[400px]:col-span-2"
                onClick={() => (snap.phase === "paused" ? runtime.resume() : runtime.pause())}
              >
                {snap.phase === "paused" ? "Resume" : "Pause"} <Kbd>P</Kbd>
              </Button>
            )}
          </div>
          <p className="text-sm text-muted">
            Tip: you can also just <strong>say</strong> &ldquo;Could you repeat the question?&rdquo;. The examiner is
            listening.
          </p>
        </section>
      </main>

      <ConfirmDialog
        open={confirmEnd}
        title="End the test now?"
        description="The examiner will close the test. Answers you have already given will still be scored."
        confirmLabel="End test"
        cancelLabel="Keep going"
        destructive
        onCancel={() => setConfirmEnd(false)}
        onConfirm={() => {
          setConfirmEnd(false);
          runtime.endTest();
        }}
      />
    </div>
  );
}

function PartProgress({ parts, current }: { parts: Part[]; current: Part | 0 }) {
  if (parts.length < 2) return null;
  return (
    <ol className="flex items-center gap-2 text-sm" aria-label="Test progress">
      {parts.map((p) => {
        const state = current === p ? "current" : current > p ? "done" : "todo";
        return (
          <li
            key={p}
            aria-current={state === "current" ? "step" : undefined}
            className={`rounded-full px-3 py-1 font-semibold ${
              state === "current"
                ? "bg-primary text-primary-ink"
                : state === "done"
                  ? "bg-success-soft text-success"
                  : "bg-surface-2 text-muted"
            }`}
          >
            {state === "done" ? "✓ " : ""}Part {p}
          </li>
        );
      })}
    </ol>
  );
}

function CueCardView({ card }: { card: CueCard }) {
  return (
    <article className="rounded-2xl border-2 border-accent/50 bg-accent-soft p-6" aria-label="Cue card">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-accent">Part 2 · Topic card</p>
      <p className="mt-2 font-display text-xl font-semibold leading-snug">{card.prompt}</p>
      <p className="mt-3 font-semibold">You should say:</p>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {card.bullets.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
      <p className="mt-2">{card.explain}</p>
    </article>
  );
}

function useNow(now: () => number, active: boolean) {
  const [t, setT] = useState(now);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setT(now()), 250);
    return () => clearInterval(id);
  }, [now, active]);
  return t;
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function Countdown({ timer, now }: { timer: TimerInfo; now: () => number }) {
  const t = useNow(now, true);
  const left = timer.limitMs - (t - timer.startedAt);
  return (
    <span className={`font-mono text-4xl font-medium tabular-nums ${left <= 10_000 ? "text-danger" : ""}`} role="timer">
      {mmss(left)}
    </span>
  );
}

function AnswerTimer({ timer, now, guided }: { timer: TimerInfo; now: () => number; guided: boolean }) {
  const t = useNow(now, true);
  const elapsed = Math.max(0, t - timer.startedAt);
  const pct = Math.min(100, (elapsed / timer.limitMs) * 100);
  const longTurn = timer.kind === "long_turn";
  const minPct = timer.minMs ? (timer.minMs / timer.limitMs) * 100 : null;
  return (
    <div className="mt-6 w-full max-w-md">
      <div className="flex items-center justify-between font-mono text-sm">
        <span className="text-2xl font-medium tabular-nums">{mmss(elapsed)}</span>
        <span className="text-muted">
          {longTurn
            ? "Speak for 1–2 minutes"
            : guided && timer.targetMs
              ? `Aim for ${Math.round(timer.targetMs[0] / 1000)}–${Math.round(timer.targetMs[1] / 1000)} s`
              : `max ${mmss(timer.limitMs)}`}
        </span>
      </div>
      <div className="relative mt-2 h-2.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full bg-recording/80" style={{ width: `${pct}%` }} />
        {minPct !== null && (
          <div className="absolute top-0 h-full w-1 bg-ink/50" style={{ left: `${minPct}%` }} title="1 minute" />
        )}
      </div>
      {longTurn && elapsed >= (timer.minMs ?? 60_000) && (
        <p className="mt-2 text-sm font-semibold text-success">
          One minute reached. Keep going until the examiner stops you.
        </p>
      )}
    </div>
  );
}

function MicIcon() {
  return (
    <svg
      width="38"
      height="38"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--recording)"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 17v4" />
    </svg>
  );
}
