import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { ButtonLink } from "@/components/ui/button";
import { MODE_BY_SLUG, PART_LABEL, PART_SLUG } from "@/server/db/assemble";
import { getDb } from "@/server/db/client";
import { getCategory, getCueTopic, listCueCards, listTestsForPart } from "@/server/db/library";

export const metadata: Metadata = { title: "Library" };

/**
 * /library/<category>/<part>   → the tests offering that part (Cambridge, Practice Test Exam, Recent Real)
 * /library/<cue-cards>/<topic> → the cue cards of that topic
 */
async function ItemBody({ params }: { params: PageProps<"/library/[category]/[item]">["params"] }) {
  await connection();
  const { category: slug, item } = await params;
  const db = getDb();
  const found = await getCategory(db, slug);
  if (!found) notFound();
  if ("redirectTo" in found) redirect(`/library/${found.redirectTo}/${item}`);
  const c = found.category;

  if (c.kind !== "cue_cards") {
    const mode = MODE_BY_SLUG[item];
    if (!mode) notFound();
    const tests = await listTestsForPart(db, { mode, categoryId: c.id });
    return (
      <>
        <Breadcrumbs
          items={[
            { href: "/library", label: "Library" },
            { href: `/library/${c.slug}`, label: c.title },
            { label: PART_LABEL[mode] },
          ]}
        />
        <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight">
          {c.title}: {PART_LABEL[mode]}
        </h1>
        <p className="mt-2 text-muted">Tests that include {PART_LABEL[mode]}.</p>
        {tests.length === 0 ? (
          <div className="card mt-8 p-8 text-center">
            <p className="text-muted">
              No {PART_LABEL[mode]} tests in {c.title} yet.
            </p>
            <Link href={`/library/${c.slug}`} className="mt-3 inline-block font-semibold text-primary underline">
              Choose another part
            </Link>
          </div>
        ) : (
          <ul className="mt-8 space-y-3">
            {tests.map((t) => (
              <li key={t.id} className="card flex flex-wrap items-center gap-4 p-5">
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-semibold">
                    {t.label}, {PART_LABEL[mode]}
                  </p>
                  {t.title && <p className="text-sm text-muted">{t.title}</p>}
                </div>
                <ButtonLink href={`/library/${c.slug}/${PART_SLUG[mode]}/${t.id}`} variant="secondary" size="sm">
                  View
                </ButtonLink>
                <ButtonLink
                  href={`/practice/start?test=${t.id}&part=${mode}`}
                  size="sm"
                  aria-label={`Practice ${t.label}, ${PART_LABEL[mode]}`}
                >
                  Practice
                </ButtonLink>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  const topic = await getCueTopic(db, { slug: item });
  if (!topic) notFound();
  const { items } = await listCueCards(db, { topicId: topic.id, limit: 100 });
  return (
    <>
      <Breadcrumbs
        items={[
          { href: "/library", label: "Library" },
          { href: `/library/${c.slug}`, label: c.title },
          { label: topic.title },
        ]}
      />
      <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight">{topic.title}</h1>
      {topic.description && <p className="mt-2 text-muted">{topic.description}</p>}
      {items.length === 0 ? (
        <p className="card mt-8 p-8 text-center text-muted">No cue cards in this topic yet.</p>
      ) : (
        <ul className="mt-8 grid gap-3 sm:grid-cols-2">
          {items.map((card) => (
            <li key={card.id} className="card flex flex-col gap-3 p-5">
              <p className="text-lg font-semibold">{card.prompt}</p>
              <div className="mt-auto flex gap-2">
                <ButtonLink href={`/library/${c.slug}/${topic.slug}/${card.id}`} variant="secondary" size="sm">
                  View
                </ButtonLink>
                <ButtonLink href={`/practice/start?card=${card.id}`} size="sm" aria-label={`Practice: ${card.prompt}`}>
                  Practice
                </ButtonLink>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function ItemPage(props: PageProps<"/library/[category]/[item]">) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <ItemBody params={props.params} />
      </Suspense>
    </div>
  );
}
