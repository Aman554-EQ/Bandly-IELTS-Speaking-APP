import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { EXAMINERS } from "@/engine/examiners";
import { requirePagePermission } from "@/server/auth/session";
import { listSessions } from "@/server/db/repo";
import type { SessionStatus } from "@/server/db/types";
import { ButtonLink } from "@/components/ui/button";
import { BandPill, MODE_LABEL } from "@/components/report/report-parts";

export const metadata: Metadata = { title: "My results" };

const STATUS: Record<SessionStatus, { label: string; tone: string }> = {
  in_progress: { label: "Not finished", tone: "bg-surface-2 text-muted" },
  completed: { label: "Not scored", tone: "bg-accent-soft text-accent" },
  ended_early: { label: "Ended early", tone: "bg-accent-soft text-accent" },
  scoring: { label: "Scoring…", tone: "bg-primary-soft text-primary" },
  scored: { label: "Scored", tone: "bg-success-soft text-success" },
  score_failed: { label: "Scoring failed", tone: "bg-danger-soft text-danger" },
};

async function ResultsList() {
  await connection();
  const user = await requirePagePermission("result.view_own", "/results");
  const sessions = await listSessions(user.id);
  if (sessions.length === 0) {
    return (
      <div className="card mt-8 p-10 text-center">
        <p className="font-display text-2xl font-semibold">No tests yet</p>
        <p className="mt-2 text-muted">Take your first practice test and your results will appear here.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/practice?part=part1" size="lg">
            Start with Part 1
          </ButtonLink>
          <ButtonLink href="/practice?part=full" variant="secondary" size="lg">
            Take the full test
          </ButtonLink>
        </div>
      </div>
    );
  }
  return (
    <ul className="mt-8 space-y-3">
      {sessions.map((s) => {
        const st = STATUS[s.status];
        const date = new Date(s.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
        return (
          <li key={s.id} className="card flex flex-wrap items-center gap-4 p-5">
            <BandPill band={s.overall} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="text-lg font-semibold">
                {MODE_LABEL[s.mode]} <span className="font-normal text-muted">· {date}</span>
              </p>
              <p className="text-sm text-muted">
                {EXAMINERS[s.examinerId]?.name ?? s.examinerId} · {s.fidelity === "exam" ? "Exam style" : "Guided"} ·{" "}
                {s.turns} answers
                {Object.keys(s.partBands).length > 1 &&
                  ` · ${Object.entries(s.partBands)
                    .map(([p, b]) => `P${p} ${b ?? "–"}`)
                    .join(" · ")}`}
              </p>
            </div>
            <span className={`rounded-full px-3 py-1 text-sm font-semibold ${st.tone}`}>{st.label}</span>
            <div className="flex gap-2">
              <ButtonLink href={`/results/${s.id}`}>{s.status === "scored" ? "View report" : "Open"}</ButtonLink>
              <ButtonLink href={`/results/${s.id}#transcript`} variant="secondary">
                Transcript
              </ButtonLink>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function ResultsPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">History</p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">My results</h1>
          <p className="mt-2 text-muted">
            Every test you take is saved with your answers, scores and feedback.{" "}
            <Link className="font-semibold text-primary underline" href="/guide">
              How scoring works
            </Link>
          </p>
        </div>
        <ButtonLink href="/practice" size="lg">
          New test
        </ButtonLink>
      </div>
      <Suspense fallback={<p className="mt-8 text-muted">Loading your results…</p>}>
        <ResultsList />
      </Suspense>
    </div>
  );
}
