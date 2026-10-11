import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { NewTestForm } from "@/components/admin/test-editor";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { requirePagePermission } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listBooks, listCategories, listTestsAdmin } from "@/server/db/library";

export const metadata: Metadata = { title: "New test · Admin" };

async function NewTestBody() {
  await connection();
  await requirePagePermission("content.manage", "/admin/tests/new");
  const db = getDb();
  const [categories, tests] = await Promise.all([listCategories(db), listTestsAdmin(db)]);
  const testCats = categories.filter((c) => c.kind !== "cue_cards");
  const cambridge = categories.find((c) => c.kind === "cambridge");
  const books = cambridge ? await listBooks(db, cambridge.id) : [];
  const nextBook = Math.max(0, ...books.map((b) => b.number ?? 0)) + 1;
  // Numbers already used: per category, and per book for Cambridge (archived tests count too).
  const used = (pick: (t: (typeof tests)[number]) => boolean) =>
    tests
      .filter(pick)
      .map((t) => t.number)
      .filter((n): n is number => n !== null)
      .sort((a, b) => a - b);
  const nextOf = (taken: number[]) => Math.max(0, ...taken) + 1;
  return (
    <>
      <Breadcrumbs
        items={[{ href: "/admin", label: "Admin" }, { href: "/admin/tests", label: "Tests" }, { label: "New test" }]}
      />
      <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight">New test</h1>
      <p className="mt-2 mb-6 text-muted">You add topics, questions and the cue card on the next screen.</p>
      <NewTestForm
        categories={testCats.map((c) => {
          const taken = c.kind === "cambridge" ? [] : used((t) => t.category.id === c.id && !t.book);
          return { id: c.id, kind: c.kind, title: c.title, nextNumber: nextOf(taken), used: taken };
        })}
        books={books.map((b) => {
          const taken = used((t) => t.book?.id === b.id);
          return { id: b.id, title: b.title, number: b.number, nextNumber: nextOf(taken), used: taken };
        })}
        nextBookNumber={nextBook}
      />
    </>
  );
}

export default function NewTestPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <NewTestBody />
      </Suspense>
    </div>
  );
}
