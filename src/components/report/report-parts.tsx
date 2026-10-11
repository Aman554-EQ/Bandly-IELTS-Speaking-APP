import type { TurnIntent } from "@/engine/interaction";
import type { Conduct, CriterionKey, ExamSession, PartReport, TurnRecord } from "@/server/db/types";

export const CRITERIA_LABEL: Record<CriterionKey, string> = {
  fluency: "Fluency & Coherence",
  lexical: "Lexical Resource",
  grammar: "Grammatical Range & Accuracy",
  pronunciation: "Pronunciation",
};

export const MODE_LABEL = { part1: "Part 1", part2: "Part 2", part3: "Part 3", full: "Full test" } as const;

const PART_NAME: Record<number, string> = { 1: "Interview", 2: "Long turn (cue card)", 3: "Discussion" };

export function bandTone(band: number | null): string {
  if (band === null) return "bg-surface-2 text-muted";
  if (band >= 7) return "bg-success-soft text-success";
  if (band >= 5.5) return "bg-primary-soft text-primary";
  return "bg-accent-soft text-accent";
}

export function BandPill({ band, size = "md" }: { band: number | null; size?: "md" | "lg" }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-xl font-display font-semibold tabular-nums ${bandTone(band)} ${
        size === "lg" ? "min-w-16 px-3 py-1 text-3xl" : "min-w-11 px-2 py-0.5 text-xl"
      }`}
    >
      {band === null ? "–" : band.toFixed(band % 1 ? 1 : 0)}
    </span>
  );
}

/** Part report: band, criteria with evidence, feedback, improved answers, vocabulary. */
export function PartReportSection({ report, showHeading = true }: { report: PartReport; showHeading?: boolean }) {
  return (
    <section id={`part-${report.part}`} className="scroll-mt-28">
      {showHeading && (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="font-display text-3xl font-semibold">
            Part {report.part} <span className="text-muted">· {PART_NAME[report.part]}</span>
          </h2>
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-muted">Part band</span>
            <BandPill band={report.band} size="lg" />
          </div>
        </div>
      )}

      {report.sampleNote && (
        <p className="mt-4 rounded-xl border border-accent/40 bg-accent-soft p-4 text-[15px] text-accent">
          {report.sampleNote}
        </p>
      )}

      <div className="card mt-5 p-6">
        <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-muted">Examiner&rsquo;s feedback</h3>
        <p className="mt-2 text-[17px] leading-relaxed">{report.feedback}</p>
        <p className="mt-4 font-mono text-sm text-muted">
          {report.questionsAnswered} answers · {report.speechSeconds}s of speech
        </p>
      </div>

      {report.criteria && (
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {(Object.keys(CRITERIA_LABEL) as CriterionKey[]).map((k) => {
            const c = report.criteria![k];
            const adjusted = c.band !== c.assessedBand;
            return (
              <article key={k} className="card p-5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-lg font-semibold">{CRITERIA_LABEL[k]}</h3>
                  <BandPill band={c.band} />
                </div>
                {k === "pronunciation" && (
                  <p className="mt-1 text-sm font-medium text-warning">
                    Estimated from transcription clarity and timing
                  </p>
                )}
                {adjusted && (
                  <p className="mt-1 text-sm font-medium text-danger">
                    Assessed {c.assessedBand}, adjusted to {c.band} (see “How the examiner handled your answers”)
                  </p>
                )}
                <p className="mt-3">{c.summary}</p>
                {c.evidence.length > 0 && (
                  <>
                    <p className="mt-4 text-xs font-bold uppercase tracking-[0.12em] text-muted">
                      Evidence from your answers
                    </p>
                    <ul className="mt-1.5 space-y-1 text-[15px] text-muted">
                      {c.evidence.map((e, i) => (
                        <li key={i}>&ldquo;{e}&rdquo;</li>
                      ))}
                    </ul>
                  </>
                )}
                {c.improvements.length > 0 && (
                  <>
                    <p className="mt-4 text-xs font-bold uppercase tracking-[0.12em] text-muted">How to improve</p>
                    <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[15px]">
                      {c.improvements.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}

      {report.improvedAnswers.length > 0 && (
        <div className="mt-6">
          <h3 className="text-xl font-semibold">Stronger versions of your answers</h3>
          <div className="mt-3 space-y-3">
            {report.improvedAnswers.map((a, i) => (
              <article key={i} className="card p-5">
                <p className="font-semibold">{a.question}</p>
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <div className="rounded-xl bg-surface-2 p-4">
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted">You said</p>
                    <p className="mt-1 text-[15px]">{a.original}</p>
                  </div>
                  <div className="rounded-xl bg-success-soft p-4">
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-success">Stronger version</p>
                    <p className="mt-1 text-[15px]">{a.improved}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {report.vocabularyUpgrades.length > 0 && (
        <div className="mt-6">
          <h3 className="text-xl font-semibold">Vocabulary upgrades</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {report.vocabularyUpgrades.map((v, i) => (
              <div key={i} className="card flex items-center gap-3 px-4 py-3">
                <span className="text-muted line-through decoration-muted/60">{v.instead}</span>
                <span aria-hidden="true" className="text-muted">
                  →
                </span>
                <span className="font-semibold">{v.try}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {report.priorities.length > 0 && (
        <div className="mt-6">
          <h3 className="text-xl font-semibold">What to work on for Part {report.part}</h3>
          <ol className="mt-3 space-y-2">
            {report.priorities.map((p, i) => (
              <li key={i} className="card flex gap-3 p-4">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft font-bold text-accent">
                  {i + 1}
                </span>
                <span>{p}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

const CONDUCT_LABEL: { key: keyof Conduct; label: string }[] = [
  { key: "repeatRequests", label: "Asked for a repeat" },
  { key: "clarifications", label: "Asked what the question meant" },
  { key: "examinerQuestions", label: "Asked the examiner a question" },
  { key: "metaQuestions", label: "Asked about the test" },
  { key: "stopRequests", label: "Asked to stop" },
  { key: "dontKnow", label: "Said “I don’t know”" },
  { key: "noResponses", label: "Did not answer" },
  { key: "offTopic", label: "Answer judged off-topic" },
];

export function ConductPanel({ parts }: { parts: PartReport[] }) {
  return (
    <section id="conduct" className="scroll-mt-28">
      <h2 className="font-display text-3xl font-semibold">How the examiner handled your answers</h2>
      <p className="mt-2 max-w-3xl text-muted">
        The examiner listens to everything you say. Asking for a repeat is normal, but needing frequent prompting
        affects Fluency &amp; Coherence, and unanswered questions leave little evidence of your vocabulary. Allowances
        per part: 2 repeats, 1 request to explain, 1 off-task question, 2 unanswered questions. Each criterion loses at
        most one band per part.
      </p>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {parts.map((p) => (
          <div key={p.part} className="card p-5">
            <p className="font-semibold">Part {p.part}</p>
            <ul className="mt-3 space-y-1.5 text-[15px]">
              {CONDUCT_LABEL.map(({ key, label }) => (
                <li key={key} className="flex justify-between gap-3">
                  <span className={p.conduct[key] ? "" : "text-muted"}>{label}</span>
                  <span className={`font-mono font-semibold ${p.conduct[key] ? "" : "text-muted"}`}>
                    {p.conduct[key]}
                  </span>
                </li>
              ))}
            </ul>
            {p.adjustments.length > 0 ? (
              <div className="mt-4 space-y-2">
                {p.adjustments.map((a, i) => (
                  <p key={i} className="rounded-lg bg-danger-soft p-3 text-sm text-danger">
                    <strong>
                      {CRITERIA_LABEL[a.criterion]} {a.delta}
                    </strong>
                    : {a.reason}
                  </p>
                ))}
              </div>
            ) : (
              <p className="mt-4 rounded-lg bg-success-soft p-3 text-sm font-medium text-success">No deductions</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

const INTENT_LABEL: Record<TurnIntent, string> = {
  answer: "Answer",
  repeat_request: "Asked for a repeat",
  clarification_request: "Asked what it means",
  incomplete: "Paused mid-thought",
  off_topic: "Off-topic",
  dont_know: "Didn’t know",
  question_to_examiner: "Asked the examiner",
  meta: "Asked about the test",
  stop_request: "Asked to stop",
  no_answer: "No answer",
};

/** Every take in order: the question, what was said and how the examiner understood it. */
export function Transcript({ session }: { session: ExamSession }) {
  const turns = [...session.turns].sort((a, b) => a.seq - b.seq);
  if (turns.length === 0) return <p className="text-muted">No answers were recorded.</p>;
  return (
    <section id="transcript" className="scroll-mt-28">
      <h2 className="font-display text-3xl font-semibold">Your answers, word for word</h2>
      <ol className="mt-5 space-y-3">
        {turns.map((t: TurnRecord, i) => {
          const showQ = i === 0 || turns[i - 1].questionId !== t.questionId;
          const isAnswer = t.analysis.intent === "answer";
          return (
            <li key={t.takeId} className="card p-5">
              {showQ && (
                <p className="mb-2 font-semibold">
                  <span className="mr-2 rounded-md bg-surface-2 px-2 py-0.5 font-mono text-xs text-muted">
                    {t.part === 0 ? "Intro" : `P${t.part}`}
                  </span>
                  {t.question}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span
                  className={`rounded-full px-2.5 py-0.5 font-semibold ${isAnswer ? "bg-primary-soft text-primary" : "bg-accent-soft text-accent"}`}
                >
                  {INTENT_LABEL[t.analysis.intent] ?? t.analysis.intent}
                </span>
                {t.outcome === "interrupted" && <span className="text-muted">stopped at the time limit</span>}
                <span className="font-mono text-muted">{Math.round(t.speechMs / 1000)}s speech</span>
                {t.features && (
                  <span className="font-mono text-muted">
                    · {t.features.wordCount} words · {t.features.articulationWpm} wpm · {t.features.pausesOver1s} long
                    pauses · {t.features.fillerCount} fillers
                  </span>
                )}
              </div>
              <p className="mt-2 text-[17px]">
                {t.transcript || (
                  <span className="text-muted">
                    {t.outcome === "no_response" ? "(silence)" : "(nothing transcribed)"}
                  </span>
                )}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
