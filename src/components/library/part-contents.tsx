import type { ExamMode } from "@/engine/types";
import type { TestParts } from "@/server/db/assemble";
import { CueCardView } from "./cue-card-view";

/** Topics and questions (or the cue card) of one part of a test, for students. Archived questions are hidden. */
export function PartContents({ parts, mode }: { parts: TestParts; mode: ExamMode }) {
  const show = mode === "full" ? (["part1", "part2", "part3"] as const) : ([mode] as const);
  return (
    <div className="mt-6 space-y-6">
      {show.map((p) => {
        if (p === "part2") {
          const card = parts.part2?.card?.card;
          return card ? (
            <section key={p} aria-label="Part 2">
              {mode === "full" && <h2 className="mb-3 text-lg font-semibold">Part 2</h2>}
              <CueCardView prompt={card.prompt} bullets={card.bullets} explain={card.explain} />
            </section>
          ) : null;
        }
        const groups = parts[p]?.groups ?? [];
        return (
          <section key={p} aria-label={p === "part1" ? "Part 1" : "Part 3"}>
            {mode === "full" && <h2 className="mb-3 text-lg font-semibold">{p === "part1" ? "Part 1" : "Part 3"}</h2>}
            <ol className="space-y-3">
              {groups.map((g) => (
                <li key={g.id} className="card p-5">
                  <p className="font-semibold">{g.title}</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
                    {g.questions
                      .filter((q) => q.status !== "archived")
                      .map((q) => (
                        <li key={q.id}>{q.question.text}</li>
                      ))}
                  </ul>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
