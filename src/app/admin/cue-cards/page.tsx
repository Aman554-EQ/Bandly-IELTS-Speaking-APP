import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { CueTopicForm } from "@/components/admin/library-forms";
import { MoveButtons, OpButton, StatusBadge } from "@/components/admin/ui";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { ButtonLink } from "@/components/ui/button";
import { can } from "@/server/auth/policy";
import { requirePagePermission } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listCueCards, listCueTopics } from "@/server/db/library";
import { LiveSearchForm } from "@/components/ui/live-search-form";

export const metadata: Metadata = { title: "Cue cards · Admin" };

/** Left: topics (managed on their own). Right: the cards of the chosen topic, or search results across all. */
async function CueBody({ searchParams }: { searchParams: PageProps<"/admin/cue-cards">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const user = await requirePagePermission("content.preview", "/admin/cue-cards");
  const canManage = can(user, "content.manage");
  const db = getDb();
  const topics = await listCueTopics(db, { preview: true });
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : "";
  const topic = q ? null : (topics.find((t) => t.id === sp.topic) ?? topics[0] ?? null);
  const { items } = await listCueCards(db, { preview: true, topicId: topic?.id, q, limit: 100 });

  return (
    <>
      <Breadcrumbs items={[{ href: "/admin", label: "Admin" }, { label: "Cue cards" }]} />
      <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight">Makkar Cue Cards</h1>
      <div className="mt-6 grid gap-6 lg:grid-cols-[280px_1fr]">
        <aside aria-label="Topics" className="space-y-4">
          <div className="card p-3">
            <p className="px-2 pb-2 text-sm font-semibold uppercase tracking-wide text-muted">Topics</p>
            <ul className="space-y-1">
              {topics.map((t, i) => (
                <li
                  key={t.id}
                  className={`flex items-center gap-1 rounded-lg ${t.id === topic?.id ? "bg-primary-soft" : ""}`}
                >
                  {canManage && (
                    <MoveButtons
                      up={{ op: "cueTopic.move", id: t.id, direction: "up" }}
                      down={{ op: "cueTopic.move", id: t.id, direction: "down" }}
                      name={t.title}
                      first={i === 0}
                      last={i === topics.length - 1}
                    />
                  )}
                  <Link
                    href={`/admin/cue-cards?topic=${t.id}`}
                    aria-current={t.id === topic?.id ? "page" : undefined}
                    className={`min-w-0 flex-1 truncate px-2 py-1.5 font-medium ${t.id === topic?.id ? "text-primary" : ""}`}
                  >
                    {t.title}
                  </Link>
                  <span className="pr-2 text-sm text-muted">{t.cardCount}</span>
                </li>
              ))}
            </ul>
          </div>
          {canManage && (
            <details className="card p-4">
              <summary className="cursor-pointer font-semibold">+ New topic</summary>
              <div className="mt-3">
                <CueTopicForm />
              </div>
            </details>
          )}
        </aside>

        <section aria-label="Cue cards">
          <LiveSearchForm className="flex flex-wrap gap-2" action="/admin/cue-cards" label="Search cue cards">
            <label htmlFor="q" className="sr-only">
              Search all cue cards
            </label>
            <input
              id="q"
              name="q"
              defaultValue={q}
              type="search"
              placeholder="Search all cue cards"
              className="h-10 flex-1 rounded-xl border border-line-strong bg-surface px-3"
            />
            {canManage && topic && (
              <ButtonLink href={`/admin/cue-cards/new?topic=${topic.id}`}>+ New cue card</ButtonLink>
            )}
          </LiveSearchForm>

          {topic && (
            <div className="card mt-4 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h2 className="text-xl font-semibold">{topic.title}</h2>
                {canManage && (
                  <OpButton
                    op={{ op: "cueTopic.delete", id: topic.id }}
                    label="Delete topic"
                    variant="danger"
                    confirm={{
                      title: `Delete the topic “${topic.title}”?`,
                      description: "Only empty topics can be deleted: move or delete its cards first.",
                      destructive: true,
                    }}
                  />
                )}
              </div>
              {canManage && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm font-semibold text-primary">
                    Rename or describe this topic
                  </summary>
                  <div className="mt-3 max-w-md">
                    <CueTopicForm topic={topic} />
                  </div>
                </details>
              )}
            </div>
          )}
          {q && (
            <p className="mt-4 text-sm text-muted" aria-live="polite">
              {items.length} {items.length === 1 ? "card" : "cards"} matching “{q}” ·{" "}
              <Link href="/admin/cue-cards" className="font-semibold text-primary underline">
                Clear
              </Link>
            </p>
          )}

          {items.length === 0 ? (
            <p className="card mt-4 p-8 text-center text-muted">
              {q ? "No cards match." : "No cards in this topic yet."}
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {items.map((c, i) => (
                <li key={c.id} className="card flex flex-wrap items-center gap-3 p-4">
                  {canManage && !q && (
                    <MoveButtons
                      up={{ op: "cueCard.move", id: c.id, direction: "up" }}
                      down={{ op: "cueCard.move", id: c.id, direction: "down" }}
                      name={c.prompt}
                      first={i === 0}
                      last={i === items.length - 1}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <Link href={`/admin/cue-cards/${c.id}`} className="font-semibold hover:underline">
                      {c.prompt}
                    </Link>
                    {q && <span className="block text-sm text-muted">{c.topicTitle}</span>}
                  </div>
                  <StatusBadge status={c.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

export default function AdminCueCardsPage(props: PageProps<"/admin/cue-cards">) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <CueBody searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
