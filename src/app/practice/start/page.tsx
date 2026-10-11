import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CueCardView } from "@/components/library/cue-card-view";
import { PartContents } from "@/components/library/part-contents";
import { PracticeApp, type PracticeTarget } from "@/components/practice/practice-app";
import { practiceSearch, readPracticeSettings } from "@/content/practice-params";
import { can } from "@/server/auth/policy";
import { requirePagePermission } from "@/server/auth/session";
import { getProfile } from "@/server/auth/users";
import { getDb } from "@/server/db/client";
import { getCategoryByKind, getCueCard, getTest } from "@/server/db/library";

export const metadata: Metadata = { title: "Start your test" };

/**
 * Step 3 of Practice: overview and confirmation, then the exam itself.
 *   ?test=<id>&part=…&voice=…&style=…   one part of a test
 *   ?card=<id>&voice=…&style=…           a Makkar cue card (Part 2)
 * Unpublished content opens only for admins (preview).
 */
async function StartBody({ searchParams }: { searchParams: PageProps<"/practice/start">["searchParams"] }) {
  const sp = await searchParams;
  const testId = typeof sp.test === "string" ? sp.test : null;
  const cardId = typeof sp.card === "string" ? sp.card : null;
  const here = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string"));
  const user = await requirePagePermission("exam.take", `/practice/start?${here}`);
  const db = getDb();
  const prefs = (await getProfile(db, user.id))?.preferences ?? {};
  const s = readPracticeSettings(sp, { examinerId: prefs.examinerId, fidelity: prefs.fidelity });
  const preview = can(user, "content.preview");

  let target: PracticeTarget;
  let summary: React.ReactNode;
  let backHref: string;
  let mode = s.mode;
  if (cardId) {
    const card = await getCueCard(db, cardId, { preview });
    if (!card) notFound();
    mode = "part2";
    target = {
      kind: "card",
      id: card.id,
      title: card.topicTitle,
      subtitle: "Makkar Cue Cards",
      preview: card.status !== "published",
    };
    summary = (
      <div className="mt-6">
        <CueCardView prompt={card.prompt} bullets={card.bullets} explain={card.explain} />
      </div>
    );
    const cat = await getCategoryByKind(db, "cue_cards");
    backHref = `/library/${cat?.slug ?? "makkar-cue-cards"}/${card.topicSlug}`;
  } else if (testId) {
    const test = await getTest(db, testId, { preview });
    if (!test || !test.available.includes(s.mode)) notFound();
    target = {
      kind: "test",
      id: test.id,
      title: test.label,
      subtitle: test.title,
      preview: test.status !== "published",
    };
    summary = (
      <details className="mt-6">
        <summary className="cursor-pointer font-semibold text-primary">What this test contains</summary>
        <PartContents parts={test.parts} mode={s.mode} />
      </details>
    );
    backHref = `/practice/tests?${practiceSearch(s)}`;
  } else {
    notFound();
  }

  return (
    <PracticeApp
      // A different test, card or part starts a fresh attempt.
      key={`${testId ?? cardId}:${mode}`}
      target={target}
      mode={mode}
      initialExaminer={s.examinerId}
      initialFidelity={s.fidelity}
      backHref={backHref}
    >
      {summary}
    </PracticeApp>
  );
}

export default function PracticeStartPage(props: PageProps<"/practice/start">) {
  return (
    <Suspense fallback={<div className="p-10 text-center text-muted">Loading…</div>}>
      <StartBody searchParams={props.searchParams} />
    </Suspense>
  );
}
