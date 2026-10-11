import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import type { ExamMode } from "@/engine/types";
import { PART_LABEL, PART_SLUG } from "@/server/db/assemble";
import { getDb } from "@/server/db/client";
import { getCategory, listCueCards, listCueTopics, partCounts } from "@/server/db/library";
import { LiveSearchForm } from "@/components/ui/live-search-form";

export const metadata: Metadata = { title: "Library" };

const PART_HINT: Record<ExamMode, string> = {
  part1: "Interview: familiar topics",
  part2: "Cue card and long turn",
  part3: "Discussion",
  full: "All three parts in order",
};

async function CategoryBody({ params, searchParams }: PageProps<"/library/[category]">) {
  await connection();
  const [{ category: slug }, sp] = await Promise.all([params, searchParams]);
  const db = getDb();
  const found = await getCategory(db, slug);
  if (!found) notFound();
  if ("redirectTo" in found) redirect(`/library/${found.redirectTo}`);
  const c = found.category;

  const header = (
    <>
      <Breadcrumbs items={[{ href: "/library", label: "Library" }, { label: c.title }]} />
      <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight">{c.title}</h1>
      {c.description && <p className="mt-2 max-w-2xl text-muted">{c.description}</p>}
    </>
  );

  if (c.kind !== "cue_cards") {
    const counts = await partCounts(db, c.id);
    return (
      <>
        {header}
        <h2 className="mt-8 text-lg font-semibold">Choose a part</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {(["part1", "part2", "part3", "full"] as const).map((m) => (
            <li key={m}>
              <Link
                href={`/library/${c.slug}/${PART_SLUG[m]}`}
                className="card flex h-full items-center justify-between gap-4 p-5 hover:border-line-strong focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span>
                  <span className="block text-xl font-semibold">{PART_LABEL[m]}</span>
                  <span className="block text-sm text-muted">{PART_HINT[m]}</span>
                </span>
                <span className="text-sm font-semibold whitespace-nowrap text-primary">
                  {counts[m]} {counts[m] === 1 ? "test" : "tests"} →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </>
    );
  }

  // Makkar Cue Cards: topics, plus search across all cards.
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const [topics, found2] = await Promise.all([
    listCueTopics(db),
    q ? listCueCards(db, { q, limit: 50 }) : Promise.resolve(null),
  ]);
  return (
    <>
      {header}
      <LiveSearchForm className="mt-6 flex max-w-xl gap-3" action={`/library/${c.slug}`} label="Search cue cards">
        <label htmlFor="q" className="sr-only">
          Search cue cards
        </label>
        <input
          id="q"
          name="q"
          defaultValue={q}
          type="search"
          placeholder="Search all cue cards (type to search)"
          className="h-11 flex-1 rounded-xl border border-line-strong bg-surface px-4"
        />
      </LiveSearchForm>
      {found2 ? (
        <>
          <p className="mt-4 text-sm text-muted" aria-live="polite">
            {found2.total} {found2.total === 1 ? "card" : "cards"} matching “{q}” ·{" "}
            <Link href={`/library/${c.slug}`} className="font-semibold text-primary underline">
              Clear
            </Link>
          </p>
          <ul className="mt-4 space-y-2">
            {found2.items.map((card) => (
              <li key={card.id}>
                <Link
                  href={`/library/${c.slug}/${card.topicSlug}/${card.id}`}
                  className="card block p-4 hover:border-line-strong"
                >
                  <span className="font-semibold">{card.prompt}</span>
                  <span className="ml-2 text-sm text-muted">{card.topicTitle}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : topics.length === 0 ? (
        <p className="card mt-8 p-8 text-center text-muted">No cue cards are available yet.</p>
      ) : (
        <>
          <h2 className="mt-8 text-lg font-semibold">Choose a topic</h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {topics.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/library/${c.slug}/${t.slug}`}
                  className="card flex h-full items-center justify-between gap-4 p-5 hover:border-line-strong focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="text-lg font-semibold">{t.title}</span>
                  <span className="text-sm text-muted">
                    {t.cardCount} {t.cardCount === 1 ? "card" : "cards"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

export default function CategoryPage(props: PageProps<"/library/[category]">) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <CategoryBody {...props} />
      </Suspense>
    </div>
  );
}
