import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/server/db/client";
import { listCategories } from "@/server/db/library";

export const metadata: Metadata = {
  title: "Library",
  description: "Cambridge tests, practice tests, recent real questions and Makkar cue cards for IELTS Speaking.",
};

const HINT = {
  cambridge: "Part 1 · Part 2 · Part 3 · Full Test",
  practice_test: "Part 1 · Part 2 · Part 3 · Full Test",
  recent_real: "Part 1 · Part 2 · Part 3 · Full Test",
  cue_cards: "Browse cue cards by topic",
} as const;

async function Categories() {
  await connection();
  const categories = await listCategories(getDb());
  return (
    <ul className="mt-8 grid gap-4 sm:grid-cols-2">
      {categories.map((c) => (
        <li key={c.id}>
          <Link
            href={`/library/${c.slug}`}
            className="card flex h-full flex-col p-6 transition-colors hover:border-line-strong focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className="font-display text-2xl font-semibold">{c.title}</span>
            {c.description && <span className="mt-2 text-muted">{c.description}</span>}
            <span className="mt-4 text-sm font-semibold text-primary">{HINT[c.kind]} →</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function LibraryPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">Library</p>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Choose a category</h1>
      <p className="mt-2 max-w-2xl text-muted">
        Browse the tests by part, or the cue cards by topic. To set up a test with your examiner and style first, use{" "}
        <Link href="/practice" className="font-semibold text-primary underline">
          Practice
        </Link>
        .
      </p>
      <Suspense fallback={<p className="mt-8 text-muted">Loading the library…</p>}>
        <Categories />
      </Suspense>
    </div>
  );
}
