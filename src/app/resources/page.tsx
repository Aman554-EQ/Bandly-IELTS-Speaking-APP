import type { Metadata } from "next";
import { ResourceBrowser } from "@/components/tools/resource-browser";
import { ButtonLink } from "@/components/ui/button";
import { RESOURCE_COUNT, RESOURCE_SECTIONS } from "@/content/resources";

export const metadata: Metadata = {
  title: "IELTS resources",
  description:
    "Hand-picked IELTS materials in one place: band scores, Listening, Reading, Writing, Speaking, mock tests and official preparation.",
};

const HELPS = [
  "Find IELTS study materials in one place",
  "Practice each skill separately",
  "Understand the question types",
  "Prepare for Writing Task 1 and Task 2",
  "Prepare for Speaking Parts 1, 2 and 3",
  "Take mock tests to measure progress",
  "Academic and General Training",
];

export default function ResourcesPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10">
      <div className="grid gap-8 lg:grid-cols-[1fr_minmax(0,360px)] lg:items-end">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">IELTS resources</p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            Everything for IELTS preparation, in one place
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-muted">
            {RESOURCE_COUNT} hand-picked lessons, strategies, practice tests and tools for Listening, Reading, Writing
            and Speaking. You don&apos;t need all of them: pick the ones that match your level, your target band and
            your weakest skill.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <ButtonLink href="/practice">Practice Speaking now</ButtonLink>
            <ButtonLink href="/band-calculator" variant="secondary">
              Band score calculator
            </ButtonLink>
          </div>
        </div>
        <div className="card p-5">
          <p className="font-semibold">This collection helps you</p>
          <ul className="mt-3 space-y-1.5 text-[15px]">
            {HELPS.map((h) => (
              <li key={h} className="flex gap-2">
                <span className="text-success" aria-hidden="true">
                  ✓
                </span>
                {h}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7" aria-label="Sections">
        {RESOURCE_SECTIONS.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              className="card flex h-full flex-col gap-1 p-3 transition-colors hover:border-line-strong"
              style={{ borderTop: `3px solid ${s.color}` }}
            >
              <span className="text-sm font-semibold">{s.short}</span>
              <span className="text-xs text-muted">
                {s.items.length} link{s.items.length === 1 ? "" : "s"}
              </span>
            </a>
          </li>
        ))}
      </ul>

      <ResourceBrowser />

      <section className="card mt-14 grid gap-6 p-6 md:grid-cols-[1fr_auto] md:items-center">
        <div>
          <h2 className="text-xl font-semibold">Know a great IELTS resource?</h2>
          <p className="mt-1 text-muted">
            This list is based on the open <strong>awesome-IELTS</strong> collection. Suggest a website, practice test
            or tool, or report a broken link.
          </p>
          <p className="mt-2 text-sm text-muted">
            Collected by{" "}
            <a
              href="https://github.com/Aman554-EQ"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-primary underline"
            >
              Aman554-EQ
            </a>
            . External sites are run by their owners; Bandly is not affiliated with them.
          </p>
        </div>
        <ButtonLink href="https://github.com/Aman554-EQ" target="_blank" rel="noopener noreferrer" variant="secondary">
          Contribute on GitHub
        </ButtonLink>
      </section>
    </main>
  );
}
