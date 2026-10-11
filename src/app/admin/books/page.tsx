import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { BookRowForm, NewBookForm } from "@/components/admin/library-forms";
import { OpButton } from "@/components/admin/ui";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/server/auth/policy";
import { requirePagePermission } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getCategoryByKind, listBooks } from "@/server/db/library";

export const metadata: Metadata = { title: "Cambridge books · Admin" };

async function BooksBody() {
  await connection();
  const user = await requirePagePermission("content.preview", "/admin/books");
  const canManage = can(user, "content.manage");
  const db = getDb();
  const cambridge = await getCategoryByKind(db, "cambridge");
  const books = cambridge ? await listBooks(db, cambridge.id) : [];
  const next = Math.max(0, ...books.map((b) => b.number ?? 0)) + 1;
  return (
    <>
      <Breadcrumbs items={[{ href: "/admin", label: "Admin" }, { label: "Cambridge books" }]} />
      <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight">Cambridge books</h1>
      <p className="mt-2 text-muted">Students see the newest book first. Only Cambridge tests belong to a book.</p>
      {canManage && cambridge && (
        <div className="mt-6 max-w-xl">
          <NewBookForm categoryId={cambridge.id} nextNumber={next} />
        </div>
      )}
      <ul className="mt-6 space-y-2">
        {books.map((b) => (
          <li key={b.id} className="card flex flex-wrap items-end justify-between gap-3 p-4">
            {canManage ? <BookRowForm b={b} /> : <span className="font-semibold">{b.title}</span>}
            <span className="flex items-center gap-3">
              <span className="text-sm text-muted">
                {b.testCount} {b.testCount === 1 ? "test" : "tests"}
              </span>
              {canManage && (
                <OpButton
                  op={{ op: "book.delete", id: b.id }}
                  label="Delete"
                  variant="danger"
                  ariaLabel={`Delete ${b.title}`}
                  confirm={{
                    title: `Delete ${b.title}?`,
                    description: "Only books without tests can be deleted.",
                    destructive: true,
                  }}
                />
              )}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function BooksPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <BooksBody />
      </Suspense>
    </div>
  );
}
