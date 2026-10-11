"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { hostOf, type Resource, RESOURCE_SECTIONS } from "@/content/resources";

const TAGS = ["Lessons", "Practice tests", "Academic", "General Training", "Video", "Official"] as const;
type Tag = (typeof TAGS)[number];

function matches(r: Resource, q: string, tag: Tag | null) {
  if (tag && !r.tags?.includes(tag)) return false;
  if (!q) return true;
  return `${r.title} ${r.note} ${hostOf(r.url)} ${(r.tags ?? []).join(" ")}`.toLowerCase().includes(q);
}

/** Searchable, filterable list of IELTS resources, grouped by skill. */
export function ResourceBrowser() {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<Tag | null>(null);
  const q = query.trim().toLowerCase();
  const sections = useMemo(
    () =>
      RESOURCE_SECTIONS.map((s) => ({
        ...s,
        shown: s.items.filter((r) => matches(r, q, tag) || (q !== "" && !tag && s.title.toLowerCase().includes(q))),
      })),
    [q, tag],
  );
  const total = sections.reduce((n, s) => n + s.shown.length, 0);
  const filtering = q !== "" || tag !== null;

  return (
    <>
      {/* Sticky tools: search, type filter, jump to a section. */}
      <div className="mt-8 rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <label className="relative flex-1">
            <span className="sr-only">Search resources</span>
            <svg
              viewBox="0 0 24 24"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search: cue cards, Task 2, Cambridge, mock test…"
              className="w-full rounded-xl border border-line-strong bg-surface py-2.5 pl-9 pr-3 text-[15px] focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            />
          </label>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5" role="group" aria-label="Filter by type">
            {TAGS.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tag === t}
                onClick={() => setTag(tag === t ? null : t)}
                className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                  tag === t
                    ? "border-primary bg-primary text-primary-ink"
                    : "border-line bg-surface text-muted hover:border-line-strong hover:text-ink"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <nav aria-label="Sections" className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5">
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-1 text-sm font-medium hover:bg-surface-2 ${s.shown.length ? "text-ink" : "text-muted opacity-60"}`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} aria-hidden="true" />
              {s.short}
              <span className="text-xs text-muted tabular-nums">{s.shown.length}</span>
            </a>
          ))}
        </nav>
      </div>

      <p className="mt-4 text-sm text-muted" role="status">
        {filtering
          ? total === 0
            ? "No resources match. Try another word or clear the filter."
            : `${total} resource${total === 1 ? "" : "s"} match.`
          : `${total} resources in ${sections.length} sections.`}
        {filtering && (
          <button
            type="button"
            className="ml-2 font-semibold text-primary underline"
            onClick={() => {
              setQuery("");
              setTag(null);
            }}
          >
            Clear
          </button>
        )}
      </p>

      <div className="mt-6 space-y-12">
        {sections
          .filter((s) => !filtering || s.shown.length > 0)
          .map((s) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-36">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="max-w-2xl">
                  <h2
                    id={`${s.id}-h`}
                    className="flex items-center gap-3 font-display text-2xl font-semibold tracking-tight"
                  >
                    <span className="h-6 w-1.5 rounded-full" style={{ background: s.color }} aria-hidden="true" />
                    {s.title}
                  </h2>
                  <p className="mt-1 text-muted">{s.intro}</p>
                </div>
                {s.inBandly && (
                  <ul className="flex flex-wrap gap-2" aria-label={`${s.title} in Bandly`}>
                    {s.inBandly.map((l) => (
                      <li key={l.href + l.label}>
                        <Link
                          href={l.href}
                          className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-3 py-1 text-sm font-semibold text-primary hover:underline"
                        >
                          {l.label} →
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {s.shown.map((r) => (
                  <li key={r.url}>
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="card group flex h-full flex-col p-4 transition-colors hover:border-line-strong focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <span className="flex items-start justify-between gap-3">
                        <span className="font-semibold leading-snug group-hover:underline">{r.title}</span>
                        <svg
                          viewBox="0 0 24 24"
                          className="mt-0.5 h-4 w-4 shrink-0 text-muted group-hover:text-primary"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          aria-hidden="true"
                        >
                          <path d="M7 17 17 7M9 7h8v8" />
                        </svg>
                      </span>
                      <span className="mt-1.5 flex-1 text-sm text-muted">{r.note}</span>
                      <span className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="font-mono text-muted">{hostOf(r.url)}</span>
                        {r.tags?.map((t) => (
                          <span key={t} className="rounded bg-surface-2 px-1.5 py-0.5 font-medium text-muted">
                            {t}
                          </span>
                        ))}
                      </span>
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </div>
    </>
  );
}
