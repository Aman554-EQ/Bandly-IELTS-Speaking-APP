import Link from "next/link";
import { P3_KIND_LABEL, type P3Kind } from "@/content/question-kinds";
import { compileBlueprint } from "@/engine/compiler";
import type { ExamContent, ExamMode, Step } from "@/engine/types";
import { PART_LABEL } from "@/server/db/assemble";

/**
 * The examiner's plan for one part of a test, compiled by the real engine from
 * the database content: the same steps a candidate gets, in the same order.
 * (While the exam runs, the engine may still repeat, probe or skip for time.)
 */
export function ExamOrder({
  testId,
  available,
  mode,
  content,
}: {
  testId: string;
  available: ExamMode[];
  mode: ExamMode | null;
  content: ExamContent | null;
}) {
  if (!mode || !content) {
    return (
      <p className="card p-6 text-muted">
        No part is complete yet, so there is nothing for the examiner to run. Finish a part to see its order here.
      </p>
    );
  }
  const kindOf = new Map<string, string>();
  for (const s of content.cueCard.part3) for (const q of s.questions) if (q.kind) kindOf.set(q.id, q.kind);
  const bp = compileBlueprint({ mode, fidelity: "exam", content, localHour: 10 });
  let n = 0;
  return (
    <div className="space-y-4">
      <nav aria-label="Choose a part" className="flex flex-wrap gap-2">
        {available.map((m) => (
          <Link
            key={m}
            href={`/admin/tests/${testId}?tab=order&mode=${m}`}
            aria-current={m === mode ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm font-semibold ${m === mode ? "border-primary bg-primary-soft text-primary" : "border-line text-muted hover:text-ink"}`}
          >
            {PART_LABEL[m]}
          </Link>
        ))}
      </nav>
      <p className="text-sm text-muted">
        Compiled by the exam engine from this test&apos;s published questions (archived ones are left out). The examiner
        follows this order; during the exam it may repeat, rephrase, probe or skip a question when time runs short.
      </p>
      <ol className="card divide-y divide-line p-0" aria-label={`Examiner order: ${PART_LABEL[mode]}`}>
        {bp.steps.map((s, i) => {
          const row = describe(s, kindOf, () => ++n, content);
          return row ? (
            <li key={i} className={`flex gap-3 px-5 py-3 ${row.tone === "muted" ? "text-muted" : ""}`}>
              <span className="w-28 shrink-0 text-xs font-semibold uppercase tracking-wide text-muted">
                {row.label}
              </span>
              <div className="min-w-0 flex-1">{row.body}</div>
            </li>
          ) : null;
        })}
      </ol>
    </div>
  );
}

function describe(
  s: Step,
  kindOf: Map<string, string>,
  next: () => number,
  content: ExamContent,
): { label: string; body: React.ReactNode; tone?: "muted" } | null {
  switch (s.kind) {
    case "part_start":
      return { label: `Part ${s.part}`, body: <strong>Part {s.part} begins</strong> };
    case "part_end":
      return null;
    case "say":
      return { label: "Examiner", body: s.clip.text, tone: "muted" };
    case "ask_name":
      return { label: "Examiner", body: s.clip.text, tone: "muted" };
    case "group_intro":
      return { label: "Topic", body: <em>“{s.clip.text}”</em> };
    case "ask": {
      const kind = kindOf.get(s.questionId);
      return {
        label: `Question ${next()}`,
        body: (
          <>
            <p className="font-medium">
              {s.clip.text}
              {kind && kind in P3_KIND_LABEL && (
                <span className="ml-2 rounded bg-primary-soft px-1.5 py-0.5 text-xs font-semibold text-primary">
                  {P3_KIND_LABEL[kind as P3Kind]}
                </span>
              )}
            </p>
            {s.allowWhyProbe && <p className="text-sm text-muted">May ask “Why?” after a short answer.</p>}
            {s.rephrase && <p className="text-sm text-muted">If not understood: “{s.rephrase.text}”</p>}
            {s.followUps?.length ? (
              <p className="text-sm text-muted">Follow-ups: {s.followUps.map((f) => `“${f.text}”`).join(" · ")}</p>
            ) : null}
          </>
        ),
      };
    }
    case "cuecard_show": {
      const c = content.cueCard;
      return {
        label: "Cue card",
        body: (
          <div className="rounded-lg border border-line p-3">
            <p className="font-semibold">{c.prompt}</p>
            <p className="mt-1 text-sm">You should say:</p>
            <ul className="list-disc pl-5 text-sm">
              {c.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
            <p className="text-sm">{c.explain}</p>
          </div>
        ),
      };
    }
    case "cuecard_hide":
      return null;
    case "prep":
      return { label: "Preparation", body: "1 minute to prepare (pencil and paper).", tone: "muted" };
    case "long_turn":
      return { label: "Long turn", body: "The candidate speaks for 1–2 minutes.", tone: "muted" };
    case "round_off":
      return { label: `Follow-up ${s.index + 1}`, body: <span className="font-medium">{s.clip.text}</span> };
    case "close":
      return { label: "Examiner", body: s.clip.text, tone: "muted" };
  }
}
