import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { ButtonLink } from "@/components/ui/button";
import { practiceSearch, readPracticeSettings } from "@/content/practice-params";
import { EXAMINERS } from "@/engine/examiners";
import { requirePagePermission } from "@/server/auth/session";
import { PART_LABEL } from "@/server/db/assemble";
import { getDb } from "@/server/db/client";
import { listCategories, listTestsForPart } from "@/server/db/library";

export const metadata: Metadata = { title: "Choose a test" };

/** Step 2 of Practice: only the tests offering the chosen part (step3.md §5.2). */
async function TestsBody({ searchParams }: { searchParams: PageProps<"/practice/tests">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const s = readPracticeSettings(sp);
  await requirePagePermission("exam.take", `/practice/tests?${practiceSearch(s)}`);
  const db = getDb();
  const categories = (await listCategories(db)).filter((c) => c.kind !== "cue_cards");
  const cat = categories.find((c) => c.slug === sp.cat);
  const tests = await listTestsForPart(db, { mode: s.mode, categoryId: cat?.id });
  const cueCards = (await listCategories(db)).find((c) => c.kind === "cue_cards");
  const chip = (slug?: string) => `/practice/tests?${practiceSearch(s, slug ? { cat: slug } : {})}`;

  return (
    <>
      <Breadcrumbs
        items={[{ href: `/practice?${practiceSearch(s)}`, label: "Practice" }, { label: "Choose a test" }]}
      />
      <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight">{PART_LABEL[s.mode]} tests</h1>
      <p className="mt-2 text-muted">
        {EXAMINERS[s.examinerId].gender === "male" ? "Male" : "Female"} voice ({EXAMINERS[s.examinerId].name}) ·{" "}
        {s.fidelity === "exam" ? "Exam style" : "Guided style"} ·{" "}
        <Link href={`/practice?${practiceSearch(s)}`} className="font-semibold text-primary underline">
          Change settings
        </Link>
      </p>

      <nav aria-label="Filter by category" className="mt-6 flex flex-wrap gap-2">
        {[{ slug: undefined, title: "All" }, ...categories].map((c) => {
          const on = (c.slug ?? null) === (cat?.slug ?? null);
          return (
            <Link
              key={c.title}
              href={chip(c.slug)}
              aria-current={on ? "page" : undefined}
              className={`rounded-full border px-4 py-1.5 text-sm font-semibold ${on ? "border-primary bg-primary-soft text-primary" : "border-line-strong text-muted hover:text-ink"}`}
            >
              {c.title}
            </Link>
          );
        })}
      </nav>

      {tests.length === 0 ? (
        <div className="card mt-8 p-8 text-center">
          <p className="text-muted">
            No {PART_LABEL[s.mode]} tests {cat ? `in ${cat.title} ` : ""}yet.
          </p>
          <Link
            href={`/practice?${practiceSearch(s)}`}
            className="mt-3 inline-block font-semibold text-primary underline"
          >
            Choose another part
          </Link>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {tests.map((t) => (
            <li key={t.id} className="card flex flex-wrap items-center gap-4 p-5">
              <div className="min-w-0 flex-1">
                <p className="text-lg font-semibold">
                  {t.label}, {PART_LABEL[s.mode]}
                </p>
                <p className="text-sm text-muted">
                  {t.category.title}
                  {t.title ? ` · ${t.title}` : ""}
                </p>
              </div>
              <ButtonLink
                href={`/practice/start?${practiceSearch(s, { test: t.id })}`}
                aria-label={`Choose ${t.label}`}
              >
                Choose
              </ButtonLink>
            </li>
          ))}
        </ul>
      )}

      {s.mode === "part2" && cueCards && (
        <p className="card mt-8 p-5 text-muted">
          Want a single cue card instead of a test?{" "}
          <Link href={`/library/${cueCards.slug}`} className="font-semibold text-primary underline">
            Browse {cueCards.title} →
          </Link>
        </p>
      )}
    </>
  );
}

export default function PracticeTestsPage(props: PageProps<"/practice/tests">) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <Suspense fallback={<p className="text-muted">Loading tests…</p>}>
        <TestsBody searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
