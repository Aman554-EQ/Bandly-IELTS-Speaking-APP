import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { EXAMINERS } from "@/engine/examiners";
import { requirePagePermission } from "@/server/auth/session";
import { getSession } from "@/server/db/repo";
import type { CriterionKey } from "@/server/db/types";
import { ButtonLink } from "@/components/ui/button";
import {
  BandPill,
  ConductPanel,
  CRITERIA_LABEL,
  MODE_LABEL,
  PartReportSection,
  Transcript,
} from "@/components/report/report-parts";
import { ScoreButton } from "@/components/report/score-button";

export const metadata: Metadata = { title: "Your result" };

async function Report({ params }: { params: PageProps<"/results/[id]">["params"] }) {
  await connection();
  const { id } = await params;
  const user = await requirePagePermission("result.view_own", `/results/${id}`);
  const session = await getSession(id, user.id);
  if (!session) notFound();

  const r = session.report;
  const examiner = EXAMINERS[session.examinerId] ?? EXAMINERS.emma;
  const date = new Date(session.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  const parts = r?.parts ?? [];
  const isFull = session.mode === "full";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      {/* Title + actions */}
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">Your result</p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">
            {MODE_LABEL[session.mode]} <span className="text-muted">· {date}</span>
          </h1>
          <p className="mt-2 text-muted">
            Examiner {examiner.name} · {session.fidelity === "exam" ? "Exam style" : "Guided style"} ·{" "}
            {session.setTitle}
            {session.endReason === "ended_early" ? " · ended early" : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`/practice?part=${session.mode}`}>Practice {MODE_LABEL[session.mode]} again</ButtonLink>
          {!isFull && (
            <ButtonLink href="/practice?part=full" variant="secondary">
              Take the full test
            </ButtonLink>
          )}
          <ButtonLink href="/results" variant="secondary">
            All results
          </ButtonLink>
        </div>
      </div>

      {/* Not scored yet */}
      {!r && (
        <div className="card mt-8 p-8">
          <p className="font-display text-2xl font-semibold">
            {session.status === "score_failed" ? "Scoring did not finish" : "This test has not been scored yet"}
          </p>
          <p className="mt-2 text-muted">
            {session.error ??
              `${session.turns.length} answers are saved. Score them now to see your band and feedback.`}
          </p>
          <div className="mt-6">
            <ScoreButton sessionId={session.id} label="Get my band score" />
          </div>
        </div>
      )}

      {r && (
        <>
          {/* Jump buttons */}
          <nav
            aria-label="Report sections"
            className="sticky top-[62px] z-20 -mx-4 mt-8 overflow-x-auto border-y border-line bg-bg/95 px-4 py-3 backdrop-blur"
          >
            <div className="flex gap-2">
              {[
                { href: "#overview", label: "Overview" },
                ...parts.map((p) => ({ href: `#part-${p.part}`, label: `Part ${p.part}` })),
                { href: "#conduct", label: "How you were assessed" },
                { href: "#transcript", label: "Transcript" },
              ].map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  className="whitespace-nowrap rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:border-primary hover:text-primary"
                >
                  {l.label}
                </a>
              ))}
            </div>
          </nav>

          {/* Overview */}
          <section id="overview" className="mt-8 scroll-mt-28">
            <div className="card grid gap-8 p-6 sm:p-8 lg:grid-cols-[auto_1fr]">
              <div className="text-center lg:pr-8 lg:text-left">
                <p className="font-semibold text-muted">
                  {isFull ? "Estimated overall band" : `Estimated band for Part ${parts[0]?.part ?? ""}`}
                </p>
                <p className="mt-1 font-display text-8xl font-semibold leading-none tracking-tight text-primary">
                  {r.overall === null ? "–" : r.overall.toFixed(1)}
                </p>
              </div>
              <div>
                {r.criteria && (
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    {(Object.keys(CRITERIA_LABEL) as CriterionKey[]).map((k) => (
                      <div key={k} className="rounded-xl bg-surface-2 p-4 text-center">
                        <p className="font-display text-4xl font-semibold">{r.criteria![k]}</p>
                        <p className="mt-1 text-sm leading-tight text-muted">{CRITERIA_LABEL[k]}</p>
                      </div>
                    ))}
                  </div>
                )}
                {isFull && parts.length > 0 && (
                  <div className="mt-5 flex flex-wrap gap-3">
                    {parts.map((p) => (
                      <a
                        key={p.part}
                        href={`#part-${p.part}`}
                        className="card flex items-center gap-3 px-4 py-2 hover:border-primary"
                      >
                        <span className="font-semibold">Part {p.part}</span>
                        <BandPill band={p.band} />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <p className="mt-3 text-sm text-muted">
              This is an estimate from an AI examiner, not an official IELTS result.{" "}
              {isFull ? "Each part was scored separately and combined (Part 3 counts most). " : ""}
              Criterion bands are whole numbers; the overall band uses official IELTS rounding.
            </p>

            <div className="mt-6 grid gap-4 lg:grid-cols-3">
              <div className="card p-6 lg:col-span-2">
                <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-muted">Summary</h2>
                <p className="mt-2 text-[17px] leading-relaxed">{r.summary}</p>
                {r.strengths.length > 0 && (
                  <>
                    <h3 className="mt-5 text-sm font-bold uppercase tracking-[0.12em] text-success">Strengths</h3>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {r.strengths.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
              {r.priorities.length > 0 && (
                <div className="card p-6">
                  <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-muted">Your top priorities</h2>
                  <ol className="mt-3 space-y-3">
                    {r.priorities.map((p, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft font-bold text-accent">
                          {i + 1}
                        </span>
                        <span>{p}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </section>

          {/* Parts */}
          <div className="mt-14 space-y-16">
            {parts.map((p) => (
              <PartReportSection key={p.part} report={p} showHeading />
            ))}
          </div>

          <div className="mt-16">
            <ConductPanel parts={parts} />
          </div>
        </>
      )}

      <div className="mt-16">
        <Transcript session={session} />
      </div>

      {/* Footer actions */}
      <div className="mt-14 flex flex-wrap items-center gap-3 border-t border-line pt-8">
        <ButtonLink href={`/practice?part=${session.mode}`} size="lg">
          Practice again
        </ButtonLink>
        <ButtonLink href="/practice" variant="secondary" size="lg">
          Choose another test
        </ButtonLink>
        <ButtonLink href="/results" variant="secondary" size="lg">
          All results
        </ButtonLink>
        {r && <ScoreButton sessionId={session.id} force label="Re-score this test" />}
      </div>
    </div>
  );
}

export default function ResultPage(props: PageProps<"/results/[id]">) {
  return (
    <Suspense fallback={<div className="mx-auto w-full max-w-6xl px-4 py-16 text-muted">Loading your result…</div>}>
      <Report params={props.params} />
    </Suspense>
  );
}
