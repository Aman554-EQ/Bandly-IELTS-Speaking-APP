import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { StatusBadge } from "@/components/admin/ui";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { P3_KIND_LABEL, P3_KINDS, type P3Kind } from "@/content/question-kinds";
import { requirePagePermission } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listCategories, searchQuestionBank } from "@/server/db/library";
import { LiveSearchForm } from "@/components/ui/live-search-form";

export const metadata: Metadata = { title: "Question bank · Admin" };

const STATUSES = ["draft", "published", "archived"] as const;
const select = "mt-1 block w-full rounded-lg border border-line-strong bg-surface px-2 py-1.5";

/** Every question in the four libraries, searchable; each row opens where it is edited. */
async function BankBody({ searchParams }: { searchParams: PageProps<"/admin/questions">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  await requirePagePermission("content.preview", "/admin/questions");
  const db = getDb();
  const categories = await listCategories(db);
  const cat = categories.find((c) => c.slug === sp.cat);
  const part = ([1, 2, 3] as const).find((p) => String(p) === sp.part);
  const status = STATUSES.find((s) => s === sp.status);
  const kind = P3_KINDS.find((k) => k === sp.kind);
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : "";
  const { rows, more } = await searchQuestionBank(db, { q, part, categoryId: cat?.id, status, kind, limit: 200 });

  return (
    <>
      <Breadcrumbs items={[{ href: "/admin", label: "Admin" }, { label: "Question bank" }]} />
      <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight">Question bank</h1>
      <p className="mt-2 text-muted">
        Every Part 1, Part 2 and Part 3 question across the four libraries. Open a row to edit it in its test or cue
        card.
      </p>

      <LiveSearchForm
        action="/admin/questions"
        className="card mt-6 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_auto_1fr_1fr_2fr_auto]"
        label="Filter questions"
      >
        <label className="text-sm font-semibold">
          Library
          <select name="cat" defaultValue={cat?.slug ?? ""} className={select}>
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
          <select name="part" defaultValue={part ?? ""} className={select}>
            <option value="">Any</option>
            <option value="1">Part 1</option>
            <option value="2">Part 2 (cue cards)</option>
            <option value="3">Part 3</option>
          </select>
        </label>
        <label className="text-sm font-semibold">
          Part 3 type
          <select name="kind" defaultValue={kind ?? ""} className={select}>
            <option value="">Any</option>
            {P3_KINDS.map((k) => (
              <option key={k} value={k}>
                {P3_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          Status
          <select name="status" defaultValue={status ?? ""} className={select}>
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
            placeholder="words in the question or topic"
            className={select}
          />
        </label>
      </LiveSearchForm>

      <p className="mt-4 text-sm text-muted" role="status">
        {rows.length === 0
          ? "No questions match."
          : `${rows.length}${more ? "+" : ""} question${rows.length === 1 ? "" : "s"}${more ? " (showing the first 200; narrow the search)" : ""}.`}
      </p>

      {rows.length > 0 && (
        <div className="card mt-3 overflow-x-auto">
          <table className="w-full text-left text-[15px]">
            <thead className="border-b border-line text-sm text-muted">
              <tr>
                <th className="p-3 font-semibold">Question</th>
                <th className="p-3 font-semibold">Part</th>
                <th className="p-3 font-semibold">Topic</th>
                <th className="p-3 font-semibold">Where</th>
                <th className="p-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const href =
                  r.source === "card" ? `/admin/cue-cards/${r.id}` : `/admin/tests/${r.ownerId}?tab=part${r.part}`;
                return (
                  <tr key={`${r.source}-${r.id}`} className="border-b border-line align-top last:border-0">
                    <td className="p-3">
                      <Link href={href} className="font-medium hover:underline">
                        {r.text}
                      </Link>
                      {r.kind && r.kind in P3_KIND_LABEL && (
                        <span className="ml-2 rounded bg-primary-soft px-1.5 py-0.5 text-xs font-semibold text-primary">
                          {P3_KIND_LABEL[r.kind as P3Kind]}
                        </span>
                      )}
                    </td>
                    <td className="p-3 whitespace-nowrap">Part {r.part}</td>
                    <td className="p-3 text-muted">{r.topic ?? "–"}</td>
                    <td className="p-3">
                      <span className="block">{r.ownerLabel}</span>
                      {r.source === "test" && r.ownerStatus !== "published" && (
                        <span className="text-sm text-muted">test is {r.ownerStatus}</span>
                      )}
                    </td>
                    <td className="p-3">
                      <StatusBadge status={r.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default function QuestionBankPage(props: PageProps<"/admin/questions">) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <BankBody searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
