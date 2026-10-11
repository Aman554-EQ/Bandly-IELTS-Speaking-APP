import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CueCardView } from "@/components/library/cue-card-view";
import { PartContents } from "@/components/library/part-contents";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { ButtonLink } from "@/components/ui/button";
import { MODE_BY_SLUG, PART_LABEL } from "@/server/db/assemble";
import { getDb } from "@/server/db/client";
import { getCategory, getCueCard, getTest } from "@/server/db/library";

export const metadata: Metadata = { title: "Library" };

/**
 * /library/<category>/<part>/<testId> → that part of the test (topics and questions, or the card)
 * /library/<cue-cards>/<topic>/<cardId> → the cue card
 */
async function EntryBody({ params }: { params: PageProps<"/library/[category]/[item]/[entry]">["params"] }) {
  await connection();
  const { category: slug, item, entry } = await params;
  const db = getDb();
  const found = await getCategory(db, slug);
  if (!found) notFound();
  if ("redirectTo" in found) redirect(`/library/${found.redirectTo}/${item}/${entry}`);
  const c = found.category;

  if (c.kind !== "cue_cards") {
    const mode = MODE_BY_SLUG[item];
    const test = mode ? await getTest(db, entry) : null;
    if (!mode || !test || test.category.id !== c.id || !test.available.includes(mode)) notFound();
    return (
      <>
        <Breadcrumbs
          items={[
            { href: "/library", label: "Library" },
            { href: `/library/${c.slug}`, label: c.title },
            { href: `/library/${c.slug}/${item}`, label: PART_LABEL[mode] },
            { label: test.label },
          ]}
        />
        <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight">
          {test.label}, {PART_LABEL[mode]}
        </h1>
        {test.title && <p className="mt-2 text-lg text-muted">{test.title}</p>}
        <div className="mt-6">
          <ButtonLink href={`/practice/start?test=${test.id}&part=${mode}`} size="lg">
            Practice this {mode === "full" ? "full test" : "part"}
          </ButtonLink>
        </div>
        <PartContents parts={test.parts} mode={mode} />
      </>
    );
  }

  const card = await getCueCard(db, entry);
  if (!card || card.topicSlug !== item) notFound();
  return (
    <>
      <Breadcrumbs
        items={[
          { href: "/library", label: "Library" },
          { href: `/library/${c.slug}`, label: c.title },
          { href: `/library/${c.slug}/${card.topicSlug}`, label: card.topicTitle },
          { label: "Cue card" },
        ]}
      />
      <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight">{card.prompt}</h1>
      <div className="mt-6">
        <CueCardView prompt={card.prompt} bullets={card.bullets} explain={card.explain} />
      </div>
      <p className="mt-4 text-muted">
        1 minute to prepare, then speak for up to 2 minutes. The examiner may ask one or two questions after.
      </p>
      <div className="mt-6">
        <ButtonLink href={`/practice/start?card=${card.id}`} size="lg">
          Practice this cue card
        </ButtonLink>
      </div>
    </>
  );
}

export default function EntryPage(props: PageProps<"/library/[category]/[item]/[entry]">) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <EntryBody params={props.params} />
      </Suspense>
    </div>
  );
}
