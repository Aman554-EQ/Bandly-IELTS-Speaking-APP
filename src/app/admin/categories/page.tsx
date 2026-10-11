import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { CategoryForm } from "@/components/admin/library-forms";
import { MoveButtons } from "@/components/admin/ui";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { can } from "@/server/auth/policy";
import { requirePagePermission } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listCategories } from "@/server/db/library";

export const metadata: Metadata = { title: "Categories · Admin" };

async function CategoriesBody() {
  await connection();
  const user = await requirePagePermission("content.preview", "/admin/categories");
  const canManage = can(user, "content.manage");
  const categories = await listCategories(getDb());
  return (
    <>
      <Breadcrumbs items={[{ href: "/admin", label: "Admin" }, { label: "Categories" }]} />
      <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight">Categories</h1>
      <p className="mt-2 text-muted">
        The library always has these four. You can rename them, describe them and change their order.
      </p>
      <ul className="mt-6 space-y-3">
        {categories.map((c, i) => (
          <li key={c.id} className="card flex flex-wrap items-start gap-3 p-4">
            {canManage && (
              <MoveButtons
                up={{ op: "category.move", id: c.id, direction: "up" }}
                down={{ op: "category.move", id: c.id, direction: "down" }}
                name={c.title}
                first={i === 0}
                last={i === categories.length - 1}
              />
            )}
            <div className="min-w-0 flex-1">
              {canManage ? <CategoryForm c={c} /> : <span className="font-semibold">{c.title}</span>}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function CategoriesPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <CategoriesBody />
      </Suspense>
    </div>
  );
}
