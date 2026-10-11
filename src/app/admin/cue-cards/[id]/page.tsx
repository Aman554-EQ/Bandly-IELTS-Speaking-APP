import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CueCardForm } from "@/components/admin/library-forms";
import { OpButton, StatusBadge } from "@/components/admin/ui";
import { CueCardView } from "@/components/library/cue-card-view";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { ButtonLink } from "@/components/ui/button";
import { can } from "@/server/auth/policy";
import { requirePagePermission } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getCueCard, listCueTopics } from "@/server/db/library";

export const metadata: Metadata = { title: "Cue card · Admin" };

/** /admin/cue-cards/new?topic=<id> creates; /admin/cue-cards/<id> edits. */
async function CardBody({ params, searchParams }: PageProps<"/admin/cue-cards/[id]">) {
  await connection();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const user = await requirePagePermission("content.preview", `/admin/cue-cards/${id}`);
  const canManage = can(user, "content.manage");
  const db = getDb();
  const topics = await listCueTopics(db, { preview: true });
  const crumbs = [
    { href: "/admin", label: "Admin" },
    { href: "/admin/cue-cards", label: "Cue cards" },
  ];

  if (id === "new") {
    if (!canManage) notFound();
    const topicId = topics.find((t) => t.id === sp.topic)?.id ?? topics[0]?.id;
    if (!topicId) notFound();
    return (
      <>
        <Breadcrumbs items={[...crumbs, { label: "New cue card" }]} />
        <h1 className="mt-4 mb-6 font-display text-4xl font-semibold tracking-tight">New cue card</h1>
        <CueCardForm topicId={topicId} topics={topics} />
      </>
    );
  }

  const card = await getCueCard(db, id, { preview: true });
  if (!card) notFound();
  return (
    <>
      <Breadcrumbs
        items={[
          ...crumbs,
          { href: `/admin/cue-cards?topic=${card.topicId}`, label: card.topicTitle },
          { label: "Cue card" },
        ]}
      />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-semibold tracking-tight">{card.prompt}</h1>
        <StatusBadge status={card.status} />
      </div>
      <div className="mt-4 flex flex-wrap items-start gap-2">
        {canManage && card.status !== "published" && (
          <OpButton op={{ op: "cueCard.status", id: card.id, status: "published" }} label="Publish" variant="primary" />
        )}
        {canManage && card.status === "published" && (
          <OpButton op={{ op: "cueCard.status", id: card.id, status: "draft" }} label="Unpublish" />
        )}
        {canManage && card.status !== "archived" && (
          <OpButton
            op={{ op: "cueCard.status", id: card.id, status: "archived" }}
            label="Archive"
            confirm={{
              title: "Archive this cue card?",
              description: "Students stop seeing it. Past results stay intact.",
            }}
          />
        )}
        {canManage && (
          <OpButton
            op={{ op: "cueCard.delete", id: card.id }}
            label="Delete"
            variant="danger"
            confirm={{
              title: "Delete this cue card?",
              description: "It is removed for good. If students practiced it, deleting is refused: archive it instead.",
              destructive: true,
            }}
          />
        )}
        <ButtonLink href={`/practice/start?card=${card.id}`} variant="secondary" size="sm">
          {card.status === "published" ? "Practice it as a student" : "Practice preview"}
        </ButtonLink>
      </div>
      <div className="mt-6">
        {canManage ? (
          <div className="card p-5">
            <CueCardForm card={card} topicId={card.topicId} topics={topics} />
          </div>
        ) : (
          <CueCardView prompt={card.prompt} bullets={card.bullets} explain={card.explain} />
        )}
      </div>
    </>
  );
}

export default function AdminCueCardPage(props: PageProps<"/admin/cue-cards/[id]">) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <CardBody {...props} />
      </Suspense>
    </div>
  );
}
