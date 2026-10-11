import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { can } from "@/server/auth/policy";
import { requirePagePermission } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listCategories, listCueCards, listCueTopics, listTestsAdmin } from "@/server/db/library";

export const metadata: Metadata = { title: "Admin" };

/** Admin home: two content areas (Tests, Cue cards) plus books and categories. */
async function AdminBody() {
  await connection();
  const user = await requirePagePermission("content.preview", "/admin");
  const db = getDb();
  const [tests, topics, cards, categories] = await Promise.all([
    listTestsAdmin(db),
    listCueTopics(db, { preview: true }),
    listCueCards(db, { preview: true, limit: 1 }),
    listCategories(db),
  ]);
  const published = tests.filter((t) => t.status === "published").length;
  const drafts = tests.filter((t) => t.status === "draft").length;
  const area = (href: string, title: string, body: string, stats: string) => (
    <Link
      href={href}
      className="card flex flex-col p-6 hover:border-line-strong focus-visible:ring-2 focus-visible:ring-primary"
    >
      <span className="font-display text-2xl font-semibold">{title}</span>
      <span className="mt-1 text-muted">{body}</span>
      <span className="mt-4 text-sm font-semibold text-primary">{stats} →</span>
    </Link>
  );
  return (
    <>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Content</h1>
      <p className="mt-2 text-muted">
        {can(user, "content.manage")
          ? "Manage the library students see."
          : "Read-only view: content management is the admins' job."}
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {area(
          "/admin/tests",
          "Tests",
          `${categories
            .filter((c) => c.kind !== "cue_cards")
            .map((c) => c.title)
            .join(", ")}: Parts 1–3 and full tests.`,
          `${tests.length} tests · ${published} published · ${drafts} drafts`,
        )}
        {area(
          "/admin/cue-cards",
          "Cue cards",
          "Makkar Cue Cards, organised by topic.",
          `${topics.length} topics · ${cards.total} cards`,
        )}
      </div>
      <ul className="mt-6 flex flex-wrap gap-4 text-sm font-semibold">
        <li>
          <Link href="/admin/questions" className="text-primary underline">
            Question bank (search every question)
          </Link>
        </li>
        <li>
          <Link href="/admin/books" className="text-primary underline">
            Cambridge books
          </Link>
        </li>
        <li>
          <Link href="/admin/categories" className="text-primary underline">
            Categories (names and order)
          </Link>
        </li>
      </ul>
    </>
  );
}

export default function AdminPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">Admin</p>
      <Suspense fallback={<p className="mt-8 text-muted">Loading…</p>}>
        <AdminBody />
      </Suspense>
    </div>
  );
}
