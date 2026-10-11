"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { browserClock } from "@/audio/browser-clock";
import type { BrowserMic } from "@/audio/browser-mic";
import { ClipSpeaker } from "@/audio/clip-speaker";
import { createCues } from "@/audio/tones";
import { compileBlueprint } from "@/engine/compiler";
import { DEFAULT_EXAMINER, EXAMINERS, type ExaminerId } from "@/engine/examiners";
import { ExamRuntime } from "@/engine/runtime";
import type { ExamContent, ExamMode, Fidelity, Part } from "@/engine/types";
import { Button, ButtonLink } from "@/components/ui/button";
import { ExamRoom } from "./exam-room";
import { MicCheck } from "./mic-check";
import { MODES, StartOverview } from "./setup-step";
import { SessionTurnClient } from "./turn-client";

type Stage =
  { name: "setup" } | { name: "check" } | { name: "exam" } | { name: "finishing" } | { name: "error"; message: string };

interface Prepared {
  sessionId: string;
  content: ExamContent;
}

interface Live {
  ctx: AudioContext;
  mic: BrowserMic;
  speaker: ClipSpeaker;
  runtime: ExamRuntime;
  turns: SessionTurnClient;
  cueCard: ExamContent["cueCard"] | null;
}

type StepState = "todo" | "doing" | "done" | "failed";

const HIDDEN_PAUSE_MS = 30_000;
const FINISH_STEPS = ["Saving your answers", "Scoring each part against the IELTS criteria", "Preparing your report"];

/** What is being practiced: one part of a test, or a Makkar cue card (always Part 2). */
export type PracticeTarget =
  | { kind: "test"; id: string; title: string; subtitle: string | null; preview?: boolean }
  | { kind: "card"; id: string; title: string; subtitle: string | null; preview?: boolean };

export function PracticeApp({
  target,
  mode,
  initialExaminer = null,
  initialFidelity = null,
  backHref,
  children,
}: {
  target: PracticeTarget;
  mode: ExamMode;
  /** From the URL (or the profile defaults). */
  initialExaminer?: ExaminerId | null;
  initialFidelity?: Fidelity | null;
  /** Where "Back to the tests" goes (keeps the student's choices). */
  backHref: string;
  /** Server-rendered summary of the test (topics, cue card). */
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ name: "setup" });
  const [fidelity, setFidelity] = useState<Fidelity>(initialFidelity ?? "exam");
  const [examinerId, setExaminerId] = useState<ExaminerId>(initialExaminer ?? DEFAULT_EXAMINER);
  const [busy, setBusy] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [step, setStep] = useState(0);
  /** The browser has no voice of the examiner's gender: show the examiner's words instead. */
  const [forceText, setForceText] = useState(false);
  const liveRef = useRef<Live | null>(null);
  const partJobs = useRef<Promise<unknown>[]>([]);
  /**
   * Attempt generation. Every new attempt (and every reset) bumps it, and async
   * work started for an older attempt checks it before touching state or
   * navigating, so nothing leaks from one attempt into the next.
   */
  const attemptRef = useRef(0);
  /** Latest stage, for the hide cleanup below (which must not depend on render-time values). */
  const stageRef = useRef<Stage["name"]>("setup");
  useLayoutEffect(() => {
    stageRef.current = stage.name;
  }, [stage.name]);

  const teardown = useCallback(() => {
    const l = liveRef.current;
    if (!l) return;
    l.runtime.abort();
    l.mic.dispose();
    void l.ctx.close().catch(() => undefined);
    liveRef.current = null;
    setLive(null);
  }, []);

  /** Ends the current attempt (if any) and returns to a fresh setup. Keeps the chosen options. */
  const resetAttempt = useCallback(() => {
    attemptRef.current += 1;
    stageRef.current = "setup";
    teardown();
    partJobs.current = [];
    setPrepared(null);
    setStep(0);
    setForceText(false);
    setBusy(false);
    setStage({ name: "setup" });
  }, [teardown]);

  // With Cache Components, Next.js hides this page (React <Activity>) instead of
  // unmounting it when the user navigates away. Layout-effect cleanup runs on hide
  // and on unmount, so leaving the page stops the examiner and the page comes
  // back as a fresh setup instead of a stale "Preparing your report" or a dead exam.
  // Only resets when an attempt has moved past setup: a re-mount on the setup screen
  // (React Strict Mode in development, or a click replayed during hydration) must
  // not cancel a test that is just being created.
  useLayoutEffect(
    () => () => {
      if (stageRef.current !== "setup" || liveRef.current) resetAttempt();
    },
    [resetAttempt],
  );

  /** Step 1: create the session on the server (stored in data/sessions). */
  async function prepare() {
    const gen = ++attemptRef.current;
    setBusy(true);
    setSetupError(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          fidelity,
          examinerId,
          ...(target.kind === "card" ? { cueCardId: target.id } : { setId: target.id }),
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Could not start the test.");
      if (attemptRef.current !== gen) return;
      setPrepared({ sessionId: j.id, content: j.content });
      setStage({ name: "check" });
    } catch (e) {
      if (attemptRef.current === gen) setSetupError(e instanceof Error ? e.message : "Could not start the test.");
    } finally {
      if (attemptRef.current === gen) setBusy(false);
    }
  }

  /** Step 3: after the examiner closes the test, save, score and open the report. */
  const finish = useCallback(
    async (gen: number, sessionId: string, runtime: ExamRuntime, turns: SessionTurnClient) => {
      // The server keeps saving and scoring even if the user has left; only the UI steps are skipped.
      const current = () => attemptRef.current === gen;
      setStage({ name: "finishing" });
      try {
        setStep(0);
        await turns.waitAll(60_000);
        const events = [...runtime.events];
        const startT = events.find((e) => e.type === "session_start")?.t ?? 0;
        const endT = events.at(-1)?.t ?? startT;
        await fetch(`/api/sessions/${sessionId}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endReason: runtime.getSnapshot().endReason ?? "completed",
            durationMs: Math.max(0, endT - startT),
            events,
          }),
        });
        if (current()) setStep(1);
        await Promise.allSettled(partJobs.current);
        const res = await fetch(`/api/sessions/${sessionId}/score`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Scoring failed.");
        if (!current()) return;
        setStep(2);
        teardown();
        router.push(`/results/${sessionId}`);
      } catch (e) {
        if (!current()) return;
        setStage({
          name: "error",
          message: `${e instanceof Error ? e.message : "Scoring failed."} Your answers are saved, so you can score them again from the result page.`,
        });
      }
    },
    [router, teardown],
  );

  /** Step 2: the mic is ready, so build the exam and start. */
  const startExam = useCallback(
    (ctx: AudioContext, mic: BrowserMic) => {
      if (!prepared) return;
      const gen = attemptRef.current;
      const examiner = EXAMINERS[examinerId];
      const speaker = new ClipSpeaker(ctx, examiner);
      speaker.onTextFallback = () => {
        if (attemptRef.current === gen) setForceText(true);
      };
      const turns = new SessionTurnClient(prepared.sessionId);
      const blueprint = compileBlueprint({
        mode,
        fidelity,
        content: prepared.content,
        localHour: new Date().getHours(),
        examiner: examinerId,
      });
      partJobs.current = [];
      const runtime = new ExamRuntime(blueprint, {
        clock: browserClock,
        speaker,
        mic,
        cues: createCues(ctx),
        analyzer: turns,
        onAnswer: async () => {},
        onEvent: (e) => {
          // Full test: score each part as soon as it ends, while the exam continues.
          if (e.type === "part_end" && mode === "full") {
            const part = e.data?.part as Part;
            partJobs.current.push(
              turns.waitAll(30_000).then(() =>
                fetch(`/api/sessions/${prepared.sessionId}/score`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ part }),
                }).catch(() => undefined),
              ),
            );
          }
        },
      });
      mic.onLost = () => runtime.pause("system", "Your microphone was disconnected. Reconnect it, then continue.");
      const l: Live = { ctx, mic, speaker, runtime, turns, cueCard: blueprint.cueCard };
      liveRef.current = l;
      setLive(l);
      setStage({ name: "exam" });
      runtime
        .start()
        .then(() => {
          if (attemptRef.current === gen && !runtime.wasAborted) return finish(gen, prepared.sessionId, runtime, turns);
          // The page was left mid-exam: record how it ended, but do not score or navigate.
          void fetch(`/api/sessions/${prepared.sessionId}/complete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endReason: "ended_early", durationMs: null, events: [...runtime.events] }),
          }).catch(() => undefined);
        })
        .catch((e) => {
          if (attemptRef.current === gen) setStage({ name: "error", message: String(e) });
        });
    },
    [prepared, examinerId, mode, fidelity, finish],
  );

  // Exam-only browser behaviour: wake lock, leave warning, pause when hidden.
  useEffect(() => {
    if (stage.name !== "exam") return;
    const l = liveRef.current;
    let lock: WakeLockSentinel | null = null;
    navigator.wakeLock
      ?.request("screen")
      .then((x) => (lock = x))
      .catch(() => undefined);
    const beforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
    const onVisibility = () => {
      if (document.hidden) {
        hiddenTimer = setTimeout(
          () => l?.runtime.pause("system", "The test was paused because you left the exam tab."),
          HIDDEN_PAUSE_MS,
        );
      } else if (hiddenTimer) {
        clearTimeout(hiddenTimer);
        hiddenTimer = null;
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      void lock?.release().catch(() => undefined);
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("visibilitychange", onVisibility);
      if (hiddenTimer) clearTimeout(hiddenTimer);
    };
  }, [stage.name]);

  const modeTitle = MODES.find((m) => m.id === mode)?.title ?? "";
  const summary = `${modeTitle} · ${EXAMINERS[examinerId].name} · ${fidelity === "exam" ? "Exam style" : "Guided style"}`;

  return (
    <>
      {stage.name === "setup" && (
        <StartOverview
          title={target.title}
          subtitle={target.subtitle}
          mode={mode}
          examinerId={examinerId}
          fidelity={fidelity}
          onExaminer={setExaminerId}
          onFidelity={setFidelity}
          onStart={prepare}
          busy={busy}
          error={setupError}
          backHref={backHref}
          preview={target.preview}
        >
          {children}
        </StartOverview>
      )}

      {stage.name === "check" && (
        <MicCheck summary={summary} onReady={startExam} onBack={() => setStage({ name: "setup" })} />
      )}

      {stage.name === "exam" && live && (
        <ExamRoom
          runtime={live.runtime}
          examiner={EXAMINERS[examinerId]}
          cueCard={live.cueCard}
          examinerLevel={live.speaker.level}
          micLevel={live.mic.level}
          now={browserClock.now}
          forceText={forceText}
        />
      )}

      {stage.name === "finishing" && (
        <FinishingView step={step} turns={live?.turns ?? null} sessionId={prepared?.sessionId ?? null} />
      )}

      {stage.name === "error" && (
        <div className="mx-auto w-full max-w-lg px-4 py-20 text-center" role="alert">
          <p className="font-display text-3xl font-semibold">Something went wrong</p>
          <p className="mt-3 text-lg text-muted">{stage.message}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {prepared && (
              <ButtonLink href={`/results/${prepared.sessionId}`} size="lg">
                Open this result
              </ButtonLink>
            )}
            <Button variant="secondary" size="lg" onClick={resetAttempt}>
              Start a new test
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

const noopSubscribe = () => () => {};
const zero = () => 0;

function FinishingView({
  step,
  turns,
  sessionId,
}: {
  step: number;
  turns: SessionTurnClient | null;
  sessionId: string | null;
}) {
  useSyncExternalStore(turns?.subscribe ?? noopSubscribe, turns?.getVersion ?? zero, zero);
  const c = turns?.counts();
  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-16" aria-live="polite">
      <p className="font-display text-3xl font-semibold">Preparing your report</p>
      <p className="mt-2 text-muted">This usually takes 10–30 seconds.</p>
      <ol className="card mt-8 space-y-4 p-6">
        {FINISH_STEPS.map((label, i) => {
          const state: StepState = i < step ? "done" : i === step ? "doing" : "todo";
          return (
            <li key={label} className="flex items-center gap-3 text-lg">
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold ${
                  state === "done"
                    ? "bg-success text-white"
                    : state === "doing"
                      ? "animate-spin border-[3px] border-primary border-t-transparent"
                      : "border-2 border-line-strong"
                }`}
                aria-hidden="true"
              >
                {state === "done" ? "✓" : ""}
              </span>
              <span className={state === "todo" ? "text-muted" : "font-medium"}>{label}</span>
            </li>
          );
        })}
      </ol>
      {c && (
        <p className="mt-3 font-mono text-sm text-muted">
          {c.done}/{c.sent} answers processed{c.failed ? ` · ${c.failed} could not be processed` : ""}
        </p>
      )}
      {sessionId && (
        <ButtonLink href={`/results/${sessionId}`} variant="ghost" className="mt-6 self-start">
          Skip waiting: open the result page
        </ButtonLink>
      )}
    </div>
  );
}
