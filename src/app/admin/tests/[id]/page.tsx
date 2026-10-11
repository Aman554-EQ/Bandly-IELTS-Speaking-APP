import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import {
  NewTopicForm,
  PartToggle,
  type QuestionItem,
  TestCardForm,
  TestDetailsForm,
  TestStatusActions,
  TopicEditor,
} from "@/components/admin/test-editor";
import { ExamOrder } from "@/components/admin/exam-order";
import { StatusBadge } from "@/components/admin/ui";
import { CueCardView } from "@/components/library/cue-card-view";
import { PartContents } from "@/components/library/part-contents";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { ButtonLink } from "@/components/ui/button";
import { usesBooks } from "@/content/categories";
import type { ExamMode } from "@/engine/types";
import { can } from "@/server/auth/policy";
import { requirePagePermission } from "@/server/auth/session";
import { contentForTest, type GroupView, PART_LABEL, partGaps } from "@/server/db/assemble";
import { getDb } from "@/server/db/client";
import { getTest, listBooks, listTestsAdmin, partIncluded, testAttemptCount } from "@/server/db/library";

export const metadata: Metadata = { title: "Test · Admin" };

const TABS = ["overview", "part1", "part2", "part3", "full", "order"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
  overview: "Overview",
  part1: "Part 1",
  part2: "Part 2",
  part3: "Part 3",
  full: "Full test",
  order: "Exam order",
};

function topicsOf(
  groups: GroupView<{
    text: string;
    allowWhyProbe?: boolean;
    rephrase?: string;
    followUps?: string[];
    kind?: string;
  }>[],
) {
  return groups.map((g) => ({
    id: g.id,
    title: g.title,
    intro: g.intro,
    isCore: g.isCore,
    questions: g.questions.map((q): QuestionItem => ({ ...q.question, id: q.id, status: q.status, usedBy: q.usedBy })),
  }));
}

async function EditorBody({ params, searchParams }: PageProps<"/admin/tests/[id]">) {
  await connection();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const user = await requirePagePermission("content.preview", `/admin/tests/${id}`);
  const canManage = can(user, "content.manage");
  const db = getDb();
  const test = await getTest(db, id, { preview: true });
  if (!test) notFound();
  const tab: Tab = TABS.find((t) => t === sp.tab) ?? "overview";
  const gaps = partGaps(test.parts);
  const [attempts, books, allTests] = await Promise.all([
    testAttemptCount(db, test.id),
    usesBooks(test.category.kind) ? listBooks(db, test.category.id) : Promise.resolve(null),
    listTestsAdmin(db),
  ]);
  const siblings = allTests.filter((s) => s.category.id === test.category.id);
  /** Tests (this one included) that have the part, for "Copy topic to…". */
  const copyTargets = (mode: "part1" | "part3") =>
    allTests
      .filter((t) => t.status !== "archived" && partIncluded(t, mode))
      .map((t) => ({ id: t.id, label: t.id === test.id ? `${t.label} (this test)` : t.label }));
  const orderMode = test.available.find((m) => m === sp.mode) ?? test.available[0] ?? null;
  const nextNumber =
    Math.max(0, ...siblings.filter((s) => (s.book?.id ?? null) === (test.book?.id ?? null)).map((s) => s.number ?? 0)) +
    1;
  const included = (t: Exclude<Tab, "overview" | "order">) =>
    t === "full" ? Boolean(test.parts.full) : Boolean(test.parts[t]);
  const tabState = (t: Exclude<Tab, "overview" | "order">) =>
    !included(t) ? "–" : (t === "full" ? gaps.full : gaps[t]).length ? "!" : "✓";
  const firstMode: ExamMode | undefined = test.available[0];

  return (
    <>
      <Breadcrumbs
        items={[{ href: "/admin", label: "Admin" }, { href: "/admin/tests", label: "Tests" }, { label: test.label }]}
      />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-4xl font-semibold tracking-tight">{test.label}</h1>
        <StatusBadge status={test.status} />
        {firstMode && (
          <ButtonLink href={`/practice/start?test=${test.id}&part=${firstMode}`} variant="secondary" size="sm">
            {test.status === "published" ? "Try it as a student" : "Preview"}
          </ButtonLink>
        )}
      </div>
      <p className="mt-1 text-muted">
        {test.category.title}
        {test.title ? ` · ${test.title}` : ""} ·{" "}
        {test.status === "published" && test.available.length
          ? `Students can take: ${test.available.map((m) => PART_LABEL[m]).join(", ")}.`
          : "Not visible to students."}
        {attempts > 0 && ` ${attempts} attempt${attempts === 1 ? "" : "s"} recorded.`}
      </p>

      <nav
        aria-label="Test sections"
        className="-mx-4 mt-6 flex gap-1 overflow-x-auto border-b border-line px-4 whitespace-nowrap sm:mx-0 sm:px-0"
      >
        {TABS.map((t) => (
          <Link
            key={t}
            href={`/admin/tests/${test.id}?tab=${t}`}
            aria-current={t === tab ? "page" : undefined}
            className={`-mb-px rounded-t-lg border-b-2 px-4 py-2 font-semibold ${t === tab ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink"}`}
          >
            {TAB_LABEL[t]}
            {t !== "overview" && t !== "order" && <span className="ml-1 text-sm">{tabState(t)}</span>}
          </Link>
        ))}
      </nav>

      <div className="mt-6">
        {tab === "overview" && (
          <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,380px)]">
            <div className="space-y-6">
              {test.problems.length > 0 ? (
                <div role="status" className="card border-accent/40 p-5">
                  <p className="font-semibold">Before this test can be published:</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
                    {test.problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p role="status" className="card p-5 font-medium text-success">
                  Every included part is complete.
                </p>
              )}
              {canManage && (
                <TestDetailsForm
                  test={{
                    id: test.id,
                    number: test.number,
                    title: test.title,
                    description: test.description,
                    bookId: test.book?.id ?? null,
                  }}
                  books={books?.map((b) => ({ id: b.id, title: b.title, number: b.number })) ?? null}
                />
              )}
            </div>
            {canManage && (
              <div className="card h-fit p-5">
                <p className="mb-3 font-semibold">Status</p>
                <TestStatusActions id={test.id} label={test.label} status={test.status} nextNumber={nextNumber} />
              </div>
            )}
          </div>
        )}

        {(tab === "part1" || tab === "part3") &&
          (() => {
            const part = tab === "part1" ? 1 : 3;
            const p = test.parts[tab];
            if (!p) {
              return (
                <div className="card p-6">
                  <p className="text-muted">This test has no {PART_LABEL[tab]}.</p>
                  {canManage && (
                    <div className="mt-3">
                      <PartToggle testId={test.id} part={tab} included={false} name={PART_LABEL[tab]} />
                    </div>
                  )}
                </div>
              );
            }
            const topics = topicsOf(p.groups);
            return canManage ? (
              <div className="space-y-4">
                <GapNote gaps={gaps[tab]} />
                {topics.map((t, i) => (
                  <TopicEditor
                    key={t.id}
                    topic={t}
                    part={part}
                    first={i === 0}
                    last={i === topics.length - 1}
                    topics={topics.map((x) => ({ id: x.id, title: x.title }))}
                    copyTargets={copyTargets(tab)}
                  />
                ))}
                <NewTopicForm testId={test.id} part={part} />
                <div className="pt-2">
                  <PartToggle testId={test.id} part={tab} included name={PART_LABEL[tab]} />
                </div>
              </div>
            ) : (
              <PartContents parts={test.parts} mode={tab} />
            );
          })()}

        {tab === "part2" &&
          (test.parts.part2 ? (
            canManage ? (
              <div className="space-y-4">
                <GapNote gaps={gaps.part2} />
                <TestCardForm testId={test.id} initial={test.parts.part2.card?.card ?? null} />
                <PartToggle testId={test.id} part="part2" included name="Part 2" />
              </div>
            ) : test.parts.part2.card ? (
              <CueCardView
                prompt={test.parts.part2.card.card.prompt}
                bullets={test.parts.part2.card.card.bullets}
                explain={test.parts.part2.card.card.explain}
              />
            ) : (
              <p className="text-muted">No cue card yet.</p>
            )
          ) : (
            <div className="card p-6">
              <p className="text-muted">This test has no Part 2.</p>
              {canManage && (
                <div className="mt-3">
                  <PartToggle testId={test.id} part="part2" included={false} name="Part 2" />
                </div>
              )}
            </div>
          ))}

        {tab === "order" && (
          <ExamOrder
            testId={test.id}
            available={test.available}
            mode={orderMode}
            content={orderMode ? contentForTest(test.parts, orderMode) : null}
          />
        )}

        {tab === "full" && (
          <div className="card space-y-4 p-6">
            <p>
              The full test runs this test&apos;s parts in a fixed order: <strong>Part 1 → Part 2 → Part 3</strong>,
              about 11–15 minutes.
            </p>
            <ol className="space-y-2">
              {(["part1", "part2", "part3"] as const).map((p) => (
                <li key={p} className="flex items-center gap-3">
                  <span className="w-16 font-semibold">{PART_LABEL[p]}</span>
                  <span className={!test.parts[p] ? "text-muted" : gaps[p].length ? "text-accent" : "text-success"}>
                    {!test.parts[p] ? "Not in this test" : gaps[p].length ? gaps[p].join(" ") : "Complete"}
                  </span>
                </li>
              ))}
            </ol>
            <p className="font-semibold">
              Full test:{" "}
              {test.parts.full ? (gaps.full.length ? gaps.full.join(" ") : "offered to students") : "not offered"}
            </p>
            {canManage && (
              <PartToggle testId={test.id} part="full" included={Boolean(test.parts.full)} name="the full test" />
            )}
          </div>
        )}
      </div>
    </>
  );
}

function GapNote({ gaps }: { gaps: string[] }) {
  if (gaps.length === 0) return <p className="text-sm font-medium text-success">This part is complete.</p>;
  return (
    <p role="status" className="text-sm font-medium text-accent">
      {gaps.join(" ")}
    </p>
  );
}

export default function TestEditorPage(props: PageProps<"/admin/tests/[id]">) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <EditorBody {...props} />
      </Suspense>
    </div>
  );
}
