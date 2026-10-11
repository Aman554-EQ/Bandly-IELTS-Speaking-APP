import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { StatusBadge } from "@/components/admin/ui";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { ButtonLink } from "@/components/ui/button";
import type { ExamMode } from "@/engine/types";
import { can } from "@/server/auth/policy";
import { requirePagePermission } from "@/server/auth/session";
import { PART_LABEL } from "@/server/db/assemble";
import { getDb } from "@/server/db/client";
import { listCategories, listTestsAdmin, partIncluded } from "@/server/db/library";
import { LiveSearchForm } from "@/components/ui/live-search-form";

export const metadata: Metadata = { title: "Tests · Admin" };

const MODES: ExamMode[] = ["part1", "part2", "part3", "full"];
const STATUSES = ["draft", "published", "archived"] as const;

/** One table of all tests, with filters kept in the URL. */
async function TestsBody({ searchParams }: { searchParams: PageProps<"/admin/tests">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const user = await requirePagePermission("content.preview", "/admin/tests");
  const db = getDb();
  const categories = (await listCategories(db)).filter((c) => c.kind !== "cue_cards");
  const cat = categories.find((c) => c.slug === sp.cat);
  const mode = MODES.find((m) => m === sp.part);
  const status = STATUSES.find((s) => s === sp.status);
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : "";
  const tests = await listTestsAdmin(db, { categoryId: cat?.id, mode, status, q });

  return (
    <>
      <Breadcrumbs items={[{ href: "/admin", label: "Admin" }, { label: "Tests" }]} />
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-4xl font-semibold tracking-tight">Tests</h1>
        {can(user, "content.manage") && <ButtonLink href="/admin/tests/new">+ New test</ButtonLink>}
      </div>

      <LiveSearchForm
        action="/admin/tests"
        className="card mt-6 grid gap-3 p-4 sm:grid-cols-[1fr_1fr_1fr_2fr_auto]"
        label="Filter tests"
      >
        <label className="text-sm font-semibold">
          Category
          <select
            name="cat"
            defaultValue={cat?.slug ?? ""}
            className="mt-1 block w-full rounded-lg border border-line-strong bg-surface px-2 py-1.5"
          >
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          Part
          <select
            name="part"
            defaultValue={mode ?? ""}
            className="mt-1 block w-full rounded-lg border border-line-strong bg-surface px-2 py-1.5"
          >
            <option value="">Any</option>
            {MODES.map((m) => (
              <option key={m} value={m}>
                {PART_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          Status
          <select
            name="status"
            defaultValue={status ?? ""}
            className="mt-1 block w-full rounded-lg border border-line-strong bg-surface px-2 py-1.5"
          >
            <option value="">Any</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          Search
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="e.g. Cambridge 21"
            className="mt-1 block w-full rounded-lg border border-line-strong bg-surface px-2 py-1.5"
          />
        </label>
      </LiveSearchForm>

      {tests.length === 0 ? (
        <p className="card mt-6 p-8 text-center text-muted">No tests match these filters.</p>
      ) : (
        <div className="card mt-6 overflow-x-auto">
          <table className="w-full text-left text-[15px]">
            <thead className="border-b border-line text-sm text-muted">
              <tr>
                <th className="p-3 font-semibold">Test</th>
                <th className="hidden p-3 font-semibold sm:table-cell">Category</th>
                <th className="p-3 font-semibold">Parts</th>
                <th className="p-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {tests.map((t) => (
                <tr key={t.id} className="border-b border-line last:border-0">
                  <td className="p-3">
                    <Link href={`/admin/tests/${t.id}`} className="font-semibold hover:underline">
                      {t.label}
                    </Link>
                    {t.title && <span className="block text-sm text-muted">{t.title}</span>}
                  </td>
                  <td className="hidden p-3 text-muted sm:table-cell">{t.category.title}</td>
                  <td className="p-3">
                    <span className="flex flex-wrap gap-1">
                      {MODES.map((m) => {
                        const inc = partIncluded(t, m);
                        const ok = t.available.includes(m);
                        return (
                          <span
                            key={m}
                            title={!inc ? "Not included" : ok ? "Complete" : "Incomplete"}
                            className={`rounded px-1.5 py-0.5 text-xs font-semibold ${!inc ? "text-muted line-through" : ok ? "bg-success-soft text-success" : "bg-accent-soft text-accent"}`}
                          >
                            {m === "full" ? "Full" : `P${m.slice(-1)}`}
                          </span>
                        );
                      })}
                    </span>
                  </td>
                  <td className="p-3">
                    <StatusBadge status={t.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-sm text-muted">
        Green: complete · Orange: included but incomplete · Struck through: not included.
      </p>
    </>
  );
}

export default function AdminTestsPage(props: PageProps<"/admin/tests">) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <TestsBody searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
