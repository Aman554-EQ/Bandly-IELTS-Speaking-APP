"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { EXAMINERS, type ExaminerId } from "@/engine/examiners";
import type { ExamMode, Fidelity } from "@/engine/types";
import { Button, ButtonLink } from "@/components/ui/button";

/**
 * Practice configuration (step3.md §5): part, examiner voice, style.
 * - `PracticeWizard`: the /practice page; choices live in the URL.
 * - `StartOverview`: the confirmation screen before the microphone check.
 */

export const MODES: { id: ExamMode; title: string; time: string; body: string }[] = [
  {
    id: "part1",
    title: "Part 1",
    time: "4–5 min",
    body: "Interview: questions about you and familiar, everyday topics.",
  },
  {
    id: "part2",
    title: "Part 2",
    time: "3–4 min",
    body: "Cue card: 1 minute to prepare, then speak for up to 2 minutes.",
  },
  {
    id: "part3",
    title: "Part 3",
    time: "4–5 min",
    body: "Discussion: deeper, more abstract questions on the Part 2 theme.",
  },
  {
    id: "full",
    title: "Full Test",
    time: "11–15 min",
    body: "All three parts in order, exactly like the real Speaking test.",
  },
];

export const STYLES: { id: Fidelity; title: string; body: string }[] = [
  {
    id: "exam",
    title: "Exam style",
    body: "Like the real test: no captions, no pause, the examiner repeats a question at most twice. No help during the test.",
  },
  {
    id: "guided",
    title: "Guided style",
    body: "Same questions in the same order, with captions, a pause button, time reminders and more repeats.",
  },
];

/** URL value ⇄ examiner (step3.md: "Male voice / Female voice"). */
export const VOICE_TO_EXAMINER: Record<"female" | "male", ExaminerId> = { female: "emma", male: "james" };
export const EXAMINER_TO_VOICE: Record<ExaminerId, "female" | "male"> = { emma: "female", james: "male" };

export function practiceQuery(p: { part: ExamMode; examinerId: ExaminerId; fidelity: Fidelity }) {
  return new URLSearchParams({ part: p.part, voice: EXAMINER_TO_VOICE[p.examinerId], style: p.fidelity }).toString();
}

function Check({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${on ? "border-primary bg-primary text-primary-ink" : "border-line-strong"}`}
    >
      {on && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5">
          <path d="M5 12l5 5L20 7" />
        </svg>
      )}
    </span>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-9">
      <h2 className="flex items-center gap-3 text-lg font-semibold">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-primary-soft text-sm font-bold text-primary">
          {n}
        </span>
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function PartChoice({ mode, onMode }: { mode: ExamMode; onMode: (m: ExamMode) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Exam part">
      {MODES.map((m) => {
        const on = m.id === mode;
        return (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onMode(m.id)}
            className={`card flex items-start gap-4 p-5 text-left transition-all ${on ? "ring-2 ring-primary" : "hover:border-line-strong"}`}
          >
            <Check on={on} />
            <span className="min-w-0">
              <span className="flex flex-wrap items-baseline gap-x-3">
                <span className="text-xl font-semibold">{m.title}</span>
                <span className="font-mono text-sm text-muted">{m.time}</span>
              </span>
              <span className="mt-1 block text-[15px] text-muted">{m.body}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function VoiceChoice({
  examinerId,
  onExaminer,
}: {
  examinerId: ExaminerId;
  onExaminer: (e: ExaminerId) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Examiner voice">
      {Object.values(EXAMINERS).map((e) => {
        const on = e.id === examinerId;
        return (
          <div
            key={e.id}
            className={`card flex flex-wrap items-center gap-x-4 gap-y-3 p-4 ${on ? "ring-2 ring-primary" : ""}`}
          >
            <button
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onExaminer(e.id)}
              className="flex min-w-[12rem] flex-1 items-center gap-4 text-left"
            >
              <Check on={on} />
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary font-display text-lg font-semibold text-primary-ink">
                {e.initials}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold">{e.gender === "male" ? "Male voice" : "Female voice"}</span>
                <span className="block text-sm text-muted">{e.name}, British</span>
              </span>
            </button>
            <VoicePreview examinerId={e.id} />
          </div>
        );
      })}
    </div>
  );
}

export function StyleChoice({ fidelity, onFidelity }: { fidelity: Fidelity; onFidelity: (f: Fidelity) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Practice style">
      {STYLES.map((s) => {
        const on = s.id === fidelity;
        return (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onFidelity(s.id)}
            className={`card flex items-start gap-4 p-5 text-left ${on ? "ring-2 ring-primary" : "hover:border-line-strong"}`}
          >
            <Check on={on} />
            <span>
              <span className="block text-lg font-semibold">{s.title}</span>
              <span className="mt-1 block text-[15px] text-muted">{s.body}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** /practice: choose part, voice and style, then see the matching tests. Choices are kept in the URL. */
export function PracticeWizard({
  initialMode,
  initialExaminer,
  initialFidelity,
}: {
  initialMode: ExamMode;
  initialExaminer: ExaminerId;
  initialFidelity: Fidelity;
}) {
  const router = useRouter();
  const [mode, setMode] = useState(initialMode);
  const [examinerId, setExaminerId] = useState(initialExaminer);
  const [fidelity, setFidelity] = useState(initialFidelity);
  const query = practiceQuery({ part: mode, examinerId, fidelity });

  // Keep the URL in step, so Back and refresh return to the same choices.
  useEffect(() => {
    router.replace(`/practice?${query}`, { scroll: false });
  }, [query, router]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">Practice</p>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Set up your test</h1>
      <p className="mt-3 max-w-2xl text-lg text-muted">
        Choose the part, the examiner and the style. Next, you pick one of the tests that offer that part.
      </p>
      <Section n={1} title="Choose a part">
        <PartChoice mode={mode} onMode={setMode} />
      </Section>
      <Section n={2} title="Choose your examiner">
        <VoiceChoice examinerId={examinerId} onExaminer={setExaminerId} />
      </Section>
      <Section n={3} title="Choose a style">
        <StyleChoice fidelity={fidelity} onFidelity={setFidelity} />
      </Section>
      <div className="mt-10 flex flex-wrap items-center gap-4">
        <ButtonLink href={`/practice/tests?${query}`} size="xl">
          See available tests →
        </ButtonLink>
        <span className="text-sm text-muted">
          {MODES.find((m) => m.id === mode)!.title} · {EXAMINERS[examinerId].gender === "male" ? "Male" : "Female"}{" "}
          voice · {fidelity === "exam" ? "Exam style" : "Guided style"}
        </span>
      </div>
    </div>
  );
}

/** The confirmation screen before the microphone check (step3.md §5.1 step 8). */
export function StartOverview({
  title,
  subtitle,
  mode,
  examinerId,
  fidelity,
  onExaminer,
  onFidelity,
  onStart,
  busy,
  error,
  backHref,
  preview,
  children,
}: {
  title: string;
  subtitle: string | null;
  mode: ExamMode;
  examinerId: ExaminerId;
  fidelity: Fidelity;
  onExaminer: (e: ExaminerId) => void;
  onFidelity: (f: Fidelity) => void;
  onStart: () => void;
  busy: boolean;
  error: string | null;
  backHref: string;
  preview?: boolean;
  /** What the test contains (topics, cue card), rendered by the server page. */
  children?: React.ReactNode;
}) {
  const modeInfo = MODES.find((m) => m.id === mode)!;
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div>
        <Link href={backHref} className="text-sm font-semibold text-primary underline">
          ← Back to the tests
        </Link>
        <p className="mt-4 text-sm font-semibold uppercase tracking-[0.14em] text-accent">
          {preview ? "Preview (not published)" : "Ready to start"}
        </p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">
          {title}, {modeInfo.title}
        </h1>
        {subtitle && <p className="mt-2 text-lg text-muted">{subtitle}</p>}
        {children}
        <Section n={1} title="Examiner">
          <VoiceChoice examinerId={examinerId} onExaminer={onExaminer} />
        </Section>
        <Section n={2} title="Style">
          <StyleChoice fidelity={fidelity} onFidelity={onFidelity} />
        </Section>
      </div>
      <aside className="lg:pt-24">
        <div className="card sticky top-24 p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">Your test</p>
          <dl className="mt-3 space-y-2 text-[15px]">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Test</dt>
              <dd className="text-right font-semibold">{title}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Part</dt>
              <dd className="font-semibold">
                {modeInfo.title} <span className="font-normal text-muted">({modeInfo.time})</span>
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Examiner</dt>
              <dd className="font-semibold">{EXAMINERS[examinerId].name}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Style</dt>
              <dd className="font-semibold">{fidelity === "exam" ? "Exam" : "Guided"}</dd>
            </div>
          </dl>
          <Button
            size="xl"
            className="group mt-6 w-full gap-3"
            onClick={onStart}
            disabled={busy}
            aria-describedby="start-steps"
          >
            {busy ? (
              <>
                <span
                  className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
                  aria-hidden="true"
                />
                Getting ready…
              </>
            ) : (
              <>
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm6-3a6 6 0 0 1-12 0m6 6v3" />
                </svg>
                Begin test
                <span
                  className="transition-transform group-hover:translate-x-1 motion-reduce:transition-none"
                  aria-hidden="true"
                >
                  →
                </span>
              </>
            )}
          </Button>
          <ol
            id="start-steps"
            aria-label="A quick microphone check (about 10 seconds), then your test starts"
            className="mt-3 flex items-center justify-center gap-2 whitespace-nowrap text-sm text-muted"
          >
            <li className="flex items-center gap-1.5">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary">
                1
              </span>
              Mic check
            </li>
            <li aria-hidden="true">→</li>
            <li className="flex items-center gap-1.5">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary">
                2
              </span>
              Test starts
            </li>
          </ol>
          {error && (
            <p role="alert" className="mt-3 text-sm font-medium text-danger">
              {error}
            </p>
          )}
          <p className="mt-4 text-sm text-muted">
            You need a quiet room and a microphone. Headphones help the examiner hear only you.
          </p>
        </div>
      </aside>
    </div>
  );
}

/** Plays the examiner's greeting so the student can choose a voice. */
function VoicePreview({ examinerId }: { examinerId: ExaminerId }) {
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);

  async function play() {
    if (state === "playing") {
      audio.current?.pause();
      setState("idle");
      return;
    }
    setState("loading");
    try {
      const m = (await (await fetch(`/voice/${examinerId}/manifest.json`)).json()) as {
        clips: Record<string, { file: string }>;
      };
      const a = new Audio(`/voice/${examinerId}/${m.clips["open.greet.morning"].file}`);
      audio.current = a;
      a.onended = () => setState("idle");
      await a.play();
      setState("playing");
    } catch {
      setState("error");
    }
  }

  return (
    <Button variant="soft" size="sm" onClick={play} aria-label={`Play ${EXAMINERS[examinerId].name}'s voice`}>
      {state === "playing" ? "■ Stop" : state === "loading" ? "…" : state === "error" ? "Unavailable" : "▶ Play sample"}
    </Button>
  );
}
