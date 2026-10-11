"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { CueCardView } from "@/components/library/cue-card-view";
import { Button } from "@/components/ui/button";
import { P3_KIND_LABEL, P3_KINDS, type P3Kind } from "@/content/question-kinds";
import type { PartKeyInput } from "@/content/test-ops";
import { Field, fieldClass, MoveButtons, OpButton, OpFeedback, StatusBadge, toLines } from "./ui";
import { useAdminOp } from "./use-admin-op";

// ------------------------------------------------------------- new test

export interface CategoryOption {
  id: string;
  kind: string;
  title: string;
  nextNumber: number;
  /** Test numbers already used (not counting books). */
  used?: number[];
}
export interface BookOption {
  id: string;
  title: string;
  number: number | null;
  nextNumber?: number;
  used?: number[];
}

/** Short form: category → (book) → number → parts. Everything else is edited in the tabs. */
export function NewTestForm({
  categories,
  books,
  nextBookNumber,
}: {
  categories: CategoryOption[];
  books: BookOption[];
  nextBookNumber: number;
}) {
  const state = useAdminOp();
  const router = useRouter();
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const cat = categories.find((c) => c.id === categoryId);
  const cambridge = cat?.kind === "cambridge";
  const [book, setBook] = useState<string>(books[0]?.id ?? "new");
  const [newBook, setNewBook] = useState(String(nextBookNumber));
  const suggest = (catId: string, bookId: string) => {
    const c = categories.find((x) => x.id === catId);
    if (c?.kind !== "cambridge") return c?.nextNumber ?? 1;
    return books.find((b) => b.id === bookId)?.nextNumber ?? 1;
  };
  const [number, setNumber] = useState(String(suggest(categoryId, books[0]?.id ?? "new")));
  const taken = cambridge ? (book === "new" ? [] : (books.find((b) => b.id === book)?.used ?? [])) : (cat?.used ?? []);
  const clash = taken.includes(Number(number));
  const [title, setTitle] = useState("");
  const [parts, setParts] = useState({ part1: true, part2: true, part3: true, full: true });
  const allThree = parts.part1 && parts.part2 && parts.part3;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = await state.run({
      op: "test.create",
      categoryId,
      number: Number(number),
      ...(title.trim() ? { title: title.trim() } : {}),
      ...(cambridge ? (book === "new" ? { newBookNumber: Number(newBook) } : { bookId: book }) : {}),
      parts: { ...parts, full: parts.full && allThree },
    });
    if (r?.id) {
      const first = parts.part1 ? "part1" : parts.part2 ? "part2" : "part3";
      router.push(`/admin/tests/${r.id}?tab=${first}`);
    }
  }

  return (
    <form onSubmit={submit} className="card max-w-2xl space-y-5 p-6" aria-label="New test">
      <Field label="Category">
        {(id) => (
          <select
            id={id}
            className={fieldClass}
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              setNumber(String(suggest(e.target.value, book)));
            }}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        )}
      </Field>
      {cambridge && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Book">
            {(id) => (
              <select
                id={id}
                className={fieldClass}
                value={book}
                onChange={(e) => {
                  setBook(e.target.value);
                  setNumber(String(suggest(categoryId, e.target.value)));
                }}
              >
                {books.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                  </option>
                ))}
                <option value="new">New book…</option>
              </select>
            )}
          </Field>
          {book === "new" && (
            <Field label="New book number" hint={`creates “Cambridge ${newBook || "…"}”`}>
              {(id) => (
                <input
                  id={id}
                  inputMode="numeric"
                  className={fieldClass}
                  value={newBook}
                  onChange={(e) => setNewBook(e.target.value.replace(/\D/g, ""))}
                />
              )}
            </Field>
          )}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
        <Field label="Test number" hint={taken.length ? `already used: ${taken.join(", ")}` : undefined}>
          {(id) => (
            <>
              <input
                id={id}
                inputMode="numeric"
                aria-invalid={clash || undefined}
                className={fieldClass}
                value={number}
                onChange={(e) => setNumber(e.target.value.replace(/\D/g, ""))}
              />
              {clash && (
                <span role="alert" className="mt-1 block text-sm font-medium text-danger">
                  Test {number} already exists here. Try {Math.max(...taken) + 1}.
                </span>
              )}
            </>
          )}
        </Field>
        <Field label="Subtitle" hint="optional, e.g. the topics">
          {(id) => <input id={id} className={fieldClass} value={title} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
      </div>
      <fieldset>
        <legend className="font-semibold">Parts to include</legend>
        <div className="mt-2 flex flex-wrap gap-4">
          {(["part1", "part2", "part3"] as const).map((p) => (
            <label key={p} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={parts[p]}
                onChange={(e) => setParts({ ...parts, [p]: e.target.checked })}
              />
              Part {p.slice(-1)}
            </label>
          ))}
          <label className={`flex items-center gap-2 ${allThree ? "" : "text-muted"}`}>
            <input
              type="checkbox"
              disabled={!allThree}
              checked={parts.full && allThree}
              onChange={(e) => setParts({ ...parts, full: e.target.checked })}
            />
            Full Test {allThree ? "" : "(needs Parts 1, 2 and 3)"}
          </label>
        </div>
      </fieldset>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={state.busy}>
          {state.busy ? "Creating…" : "Create test"}
        </Button>
        <OpFeedback state={state} />
      </div>
    </form>
  );
}

// -------------------------------------------------------------- overview

export function TestDetailsForm({
  test,
  books,
}: {
  test: { id: string; number: number | null; title: string | null; description: string | null; bookId: string | null };
  books: BookOption[] | null;
}) {
  const state = useAdminOp();
  const [number, setNumber] = useState(String(test.number ?? ""));
  const [title, setTitle] = useState(test.title ?? "");
  const [description, setDescription] = useState(test.description ?? "");
  const [book, setBook] = useState(test.bookId ?? "");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void state.run({
          op: "test.update",
          id: test.id,
          number: Number(number),
          title: title.trim() || null,
          description: description.trim() || null,
          ...(books ? { bookId: book || null } : {}),
        });
      }}
      className="card space-y-4 p-5"
      aria-label="Test details"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {books && (
          <Field label="Book">
            {(id) => (
              <select id={id} className={fieldClass} value={book} onChange={(e) => setBook(e.target.value)}>
                {books.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        <Field label="Test number">
          {(id) => (
            <input
              id={id}
              inputMode="numeric"
              className={fieldClass}
              value={number}
              onChange={(e) => setNumber(e.target.value.replace(/\D/g, ""))}
            />
          )}
        </Field>
      </div>
      <Field label="Subtitle" hint="optional">
        {(id) => <input id={id} className={fieldClass} value={title} onChange={(e) => setTitle(e.target.value)} />}
      </Field>
      <Field label="Description" hint="optional">
        {(id) => (
          <textarea
            id={id}
            rows={2}
            className={fieldClass}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        )}
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={state.busy}>
          {state.busy ? "Saving…" : "Save details"}
        </Button>
        <OpFeedback state={state} />
      </div>
    </form>
  );
}

export function TestStatusActions({
  id,
  label,
  status,
  nextNumber,
}: {
  id: string;
  label: string;
  status: "draft" | "published" | "archived";
  nextNumber: number;
}) {
  const [copyNumber, setCopyNumber] = useState(String(nextNumber));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={status} />
        {status !== "published" && (
          <OpButton op={{ op: "test.status", id, status: "published" }} label="Publish" variant="primary" />
        )}
        {status === "published" && (
          <OpButton
            op={{ op: "test.status", id, status: "draft" }}
            label="Unpublish"
            confirm={{
              title: `Unpublish ${label}?`,
              description: "Students stop seeing it until you publish it again.",
            }}
          />
        )}
        {status !== "archived" && (
          <OpButton
            op={{ op: "test.status", id, status: "archived" }}
            label="Archive"
            confirm={{
              title: `Archive ${label}?`,
              description: "Students stop seeing it. Past results stay intact, and admins can still open it.",
            }}
          />
        )}
        <OpButton
          op={{ op: "test.delete", id }}
          label="Delete"
          variant="danger"
          confirm={{
            title: `Delete ${label}?`,
            description:
              "Its parts, topics and questions are removed for good. If any student took it, deleting is refused: archive it instead.",
            destructive: true,
          }}
        />
      </div>
      <details>
        <summary className="cursor-pointer font-semibold">Duplicate as a new draft</summary>
        <div className="mt-3 flex items-end gap-2">
          <Field label="Number of the copy">
            {(fid) => (
              <input
                id={fid}
                inputMode="numeric"
                className={`${fieldClass} w-28`}
                value={copyNumber}
                onChange={(e) => setCopyNumber(e.target.value.replace(/\D/g, ""))}
              />
            )}
          </Field>
          <DuplicateButton id={id} number={Number(copyNumber)} />
        </div>
      </details>
    </div>
  );
}

function DuplicateButton({ id, number }: { id: string; number: number }) {
  const state = useAdminOp();
  const router = useRouter();
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        variant="secondary"
        disabled={state.busy}
        onClick={async () => {
          const r = await state.run({ op: "test.duplicate", id, number });
          if (r?.id) router.push(`/admin/tests/${r.id}`);
        }}
      >
        Duplicate
      </Button>
      <OpFeedback state={state} />
    </span>
  );
}

/** Add or remove a part (removing is refused when students used it). */
export function PartToggle({
  testId,
  part,
  included,
  name,
}: {
  testId: string;
  part: PartKeyInput;
  included: boolean;
  name: string;
}) {
  return included ? (
    <OpButton
      op={{ op: "part.remove", testId, part }}
      label={`Remove ${name}`}
      variant="danger"
      confirm={{
        title: `Remove ${name}?`,
        description: "Its topics and questions are deleted. If students already took it, removing is refused.",
        destructive: true,
      }}
    />
  ) : (
    <OpButton op={{ op: "part.add", testId, part }} label={`Add ${name}`} variant="primary" />
  );
}

// ------------------------------------------------------- topics/questions

export interface QuestionItem {
  id: string;
  status: "draft" | "published" | "archived";
  usedBy: number;
  text: string;
  allowWhyProbe?: boolean;
  rephrase?: string;
  followUps?: string[];
  kind?: string;
}

export interface TopicItem {
  id: string;
  title: string;
  intro: string;
  isCore: boolean;
  questions: QuestionItem[];
}

export interface TopicRef {
  id: string;
  title: string;
}

/** Part 3 question type picker ("" = not set). */
function KindSelect({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  return (
    <select
      id={id}
      aria-label={id ? undefined : "Question type"}
      className={`${fieldClass} mt-0 w-auto`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Type: not set</option>
      {P3_KINDS.map((k) => (
        <option key={k} value={k}>
          {P3_KIND_LABEL[k]}
        </option>
      ))}
    </select>
  );
}

const asKind = (v: string) => (P3_KINDS.includes(v as P3Kind) ? { kind: v as P3Kind } : {});

function QuestionRow({
  q,
  part,
  first,
  last,
  others,
}: {
  q: QuestionItem;
  part: 1 | 3;
  first: boolean;
  last: boolean;
  /** Other topics of the same part, for "Move to topic". */
  others: TopicRef[];
}) {
  const state = useAdminOp();
  const [kind, setKind] = useState(q.kind ?? "");
  const [text, setText] = useState(q.text);
  const [why, setWhy] = useState(Boolean(q.allowWhyProbe));
  const [rephrase, setRephrase] = useState(q.rephrase ?? "");
  const [followUps, setFollowUps] = useState((q.followUps ?? []).join("\n"));
  const dirty =
    text !== q.text ||
    why !== Boolean(q.allowWhyProbe) ||
    rephrase !== (q.rephrase ?? "") ||
    followUps !== (q.followUps ?? []).join("\n") ||
    kind !== (q.kind ?? "");
  const archived = q.status === "archived";
  const save = () =>
    state.run({
      op: "question.update",
      id: q.id,
      fields:
        part === 1
          ? { part: 1, text, ...(why ? { allowWhyProbe: true } : {}) }
          : {
              part: 3,
              text,
              ...(rephrase.trim() ? { rephrase } : {}),
              ...(toLines(followUps).length ? { followUps: toLines(followUps) } : {}),
              ...asKind(kind),
            },
    });
  return (
    <li className={`rounded-xl border border-line p-3 ${archived ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <MoveButtons
          up={{ op: "question.move", id: q.id, direction: "up" }}
          down={{ op: "question.move", id: q.id, direction: "down" }}
          name={q.text}
          first={first}
          last={last}
        />
        <label className="sr-only" htmlFor={`q-${q.id}`}>
          Question text
        </label>
        <textarea
          id={`q-${q.id}`}
          rows={2}
          className={`${fieldClass} mt-0 min-w-[min(100%,14rem)] flex-1 resize-y`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && dirty) {
              e.preventDefault();
              void save();
            }
          }}
        />
        {dirty && (
          <Button size="sm" disabled={state.busy} onClick={() => void save()}>
            Save
          </Button>
        )}
        {archived && <StatusBadge status="archived" />}
        {q.usedBy > 0 && (
          <span className="text-sm text-muted" title="Students answered it, so it can't be deleted.">
            {q.usedBy} answers
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-start gap-2 pl-1">
        {part === 1 ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={why} onChange={(e) => setWhy(e.target.checked)} />
            “Why?” after a short answer
          </label>
        ) : (
          <details className="w-full text-sm">
            <summary className="cursor-pointer text-primary">
              Type, simpler wording and follow-ups
              {q.kind && P3_KINDS.includes(q.kind as P3Kind) && (
                <span className="ml-2 rounded bg-primary-soft px-1.5 py-0.5 text-xs font-semibold text-primary">
                  {P3_KIND_LABEL[q.kind as P3Kind]}
                </span>
              )}
            </summary>
            <div className="mt-2">
              <Field label="Question type" hint="for organising and search; not spoken">
                {(id) => <KindSelect id={id} value={kind} onChange={setKind} />}
              </Field>
            </div>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <Field label="Simpler wording" hint="if not understood">
                {(id) => (
                  <input
                    id={id}
                    className={fieldClass}
                    value={rephrase}
                    onChange={(e) => setRephrase(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Follow-up probes" hint="one per line">
                {(id) => (
                  <textarea
                    id={id}
                    rows={2}
                    className={fieldClass}
                    value={followUps}
                    onChange={(e) => setFollowUps(e.target.value)}
                  />
                )}
              </Field>
            </div>
          </details>
        )}
        <span className="ml-auto flex flex-wrap gap-2">
          {others.length > 0 && (
            <select
              aria-label={`Move to another topic: ${q.text}`}
              className={`${fieldClass} mt-0 w-auto py-1 text-sm`}
              value=""
              disabled={state.busy}
              onChange={(e) => {
                if (e.target.value) void state.run({ op: "question.regroup", id: q.id, topicId: e.target.value });
              }}
            >
              <option value="">Move to topic…</option>
              {others.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          )}
          <OpButton
            op={{ op: "question.status", id: q.id, status: archived ? "published" : "archived" }}
            label={archived ? "Restore" : "Archive"}
            ariaLabel={`${archived ? "Restore" : "Archive"}: ${q.text}`}
          />
          <OpButton
            op={{ op: "question.delete", id: q.id }}
            label="Delete"
            variant="danger"
            ariaLabel={`Delete: ${q.text}`}
            confirm={{
              title: "Delete this question?",
              description: "It is removed for good. If students answered it, deleting is refused: archive it instead.",
              destructive: true,
            }}
          />
        </span>
      </div>
      <OpFeedback state={state} className="mt-1" />
    </li>
  );
}

function AddQuestion({ topicId, part }: { topicId: string; part: 1 | 3 }) {
  const state = useAdminOp();
  const [many, setMany] = useState(false);
  const [text, setText] = useState("");
  const [kind, setKind] = useState("");
  const count = toLines(text).length;
  return (
    <form
      className="mt-3 space-y-2 rounded-xl border border-dashed border-line p-3"
      aria-label="Add a question"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = many
          ? await state.run({ op: "question.createMany", topicId, texts: toLines(text), ...asKind(kind) })
          : await state.run({
              op: "question.create",
              topicId,
              fields: part === 1 ? { part, text } : { part, text, ...asKind(kind) },
            });
        if (r) setText("");
      }}
    >
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-semibold">Add</span>
        <label className="flex items-center gap-1">
          <input type="radio" name={`mode-${topicId}`} checked={!many} onChange={() => setMany(false)} /> one question
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" name={`mode-${topicId}`} checked={many} onChange={() => setMany(true)} /> several (one per
          line)
        </label>
        {part === 3 && <KindSelect value={kind} onChange={setKind} />}
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <label className="sr-only" htmlFor={`new-${topicId}`}>
          {many ? "New questions, one per line" : "New question"}
        </label>
        <textarea
          id={`new-${topicId}`}
          rows={many ? 5 : part === 3 ? 2 : 1}
          className={`${fieldClass} mt-0 min-w-0 flex-1 resize-y`}
          placeholder={
            many
              ? part === 1
                ? "Where is your hometown?\nWhat do you like about it?\nHas it changed much?"
                : "Why do people read less today?\nWhat could schools do about it?\nWill this change in future?"
              : part === 1
                ? "e.g. Where is your hometown?"
                : "e.g. Why do people read less today?"
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (!many && e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <Button type="submit" variant="secondary" disabled={state.busy || (many && count === 0)}>
          {many ? `+ Add ${count || ""} question${count === 1 ? "" : "s"}` : "+ Add question"}
        </Button>
      </div>
      <OpFeedback state={state} />
    </form>
  );
}

/** One topic: its title and intro (editable), its questions in order, and "add question". */
export function TopicEditor({
  topic,
  part,
  first,
  last,
  topics,
  copyTargets,
}: {
  topic: TopicItem;
  part: 1 | 3;
  first: boolean;
  last: boolean;
  /** All topics of this part (for moving questions between them). */
  topics: TopicRef[];
  /** Tests with this part, where the topic can be copied. */
  copyTargets: { id: string; label: string }[];
}) {
  const state = useAdminOp();
  const [copyTo, setCopyTo] = useState("");
  const others = topics.filter((t) => t.id !== topic.id);
  const [title, setTitle] = useState(topic.title);
  const [intro, setIntro] = useState(topic.intro);
  const [isCore, setIsCore] = useState(topic.isCore);
  const dirty = title !== topic.title || intro !== topic.intro || isCore !== topic.isCore;
  const live = topic.questions.length;
  return (
    <section className="card p-4 sm:p-5" aria-label={`Topic: ${topic.title}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <MoveButtons
          up={{ op: "topic.move", id: topic.id, direction: "up" }}
          down={{ op: "topic.move", id: topic.id, direction: "down" }}
          name={topic.title}
          first={first}
          last={last}
        />
        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
          <Field label={part === 1 ? "Topic" : "Discussion topic"}>
            {(id) => <input id={id} className={fieldClass} value={title} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <Field label="What the examiner says first">
            {(id) => <input id={id} className={fieldClass} value={intro} onChange={(e) => setIntro(e.target.value)} />}
          </Field>
          {part === 1 && (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={isCore} onChange={(e) => setIsCore(e.target.checked)} />
              About the candidate (work, studies or home): asked first
            </label>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {dirty && (
          <Button
            size="sm"
            disabled={state.busy}
            onClick={() =>
              void state.run({ op: "topic.update", id: topic.id, title, intro, ...(part === 1 ? { isCore } : {}) })
            }
          >
            Save topic
          </Button>
        )}
        <OpButton
          op={{ op: "topic.delete", id: topic.id }}
          label="Delete topic"
          variant="danger"
          confirm={{
            title: `Delete “${topic.title}”?`,
            description: `Its ${live} question${live === 1 ? "" : "s"} are deleted too. Refused if students answered them.`,
            destructive: true,
          }}
        />
        {copyTargets.length > 0 && (
          <span className="flex flex-wrap items-center gap-2">
            <select
              aria-label={`Copy “${topic.title}” to test`}
              className={`${fieldClass} mt-0 w-auto py-1 text-sm`}
              value={copyTo}
              onChange={(e) => setCopyTo(e.target.value)}
            >
              <option value="">Copy topic to…</option>
              {copyTargets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="secondary"
              disabled={!copyTo || state.busy}
              onClick={async () => {
                if (await state.run({ op: "topic.copy", id: topic.id, testId: copyTo })) setCopyTo("");
              }}
            >
              Copy
            </Button>
          </span>
        )}
        <OpFeedback state={state} />
      </div>
      <ol className="mt-4 space-y-2" aria-label={`Questions of ${topic.title}`}>
        {topic.questions.map((q, i) => (
          <QuestionRow
            key={q.id}
            q={q}
            part={part}
            first={i === 0}
            last={i === topic.questions.length - 1}
            others={others}
          />
        ))}
      </ol>
      {topic.questions.length === 0 && <p className="mt-3 text-sm text-muted">No questions yet.</p>}
      <AddQuestion topicId={topic.id} part={part} />
    </section>
  );
}

export function NewTopicForm({ testId, part }: { testId: string; part: 1 | 3 }) {
  const state = useAdminOp();
  const [title, setTitle] = useState("");
  const [intro, setIntro] = useState("");
  const [isCore, setIsCore] = useState(false);
  return (
    <form
      className="card space-y-3 border-dashed p-5"
      aria-label={part === 1 ? "New topic" : "New discussion topic"}
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await state.run({
          op: "topic.create",
          testId,
          part,
          title,
          intro,
          ...(part === 1 && isCore ? { isCore } : {}),
        });
        if (r) {
          setTitle("");
          setIntro("");
          setIsCore(false);
        }
      }}
    >
      <h3 className="font-semibold">{part === 1 ? "+ New topic" : "+ New discussion topic"}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title">
          {(id) => (
            <input
              id={id}
              className={fieldClass}
              value={title}
              placeholder={part === 1 ? "Hometown" : "Theatre culture"}
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </Field>
        <Field label="What the examiner says first">
          {(id) => (
            <input
              id={id}
              className={fieldClass}
              value={intro}
              placeholder={
                part === 1 ? "Let's talk about your hometown." : "Let's consider first of all theatre culture."
              }
              onChange={(e) => setIntro(e.target.value)}
            />
          )}
        </Field>
      </div>
      {part === 1 && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isCore} onChange={(e) => setIsCore(e.target.checked)} />
          About the candidate (work, studies or home): asked first
        </label>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" variant="secondary" disabled={state.busy}>
          Add topic
        </Button>
        <OpFeedback state={state} />
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ card

export interface CardInitial {
  prompt: string;
  bullets: string[];
  explain: string;
  spokenPrompt: string;
  roundOff: { text: string }[];
  part3Intro?: string;
  part3OnlyIntro?: string;
}

/** A cue card form with a live preview. Used for a test's Part 2 and for Makkar cards. */
export function CardFields({
  initial,
  withPart3Intros,
  submitLabel,
  onSubmit,
  busy,
  extra,
}: {
  initial: CardInitial | null;
  withPart3Intros: boolean;
  submitLabel: string;
  onSubmit: (fields: {
    prompt: string;
    bullets: string[];
    explain: string;
    spokenPrompt?: string;
    roundOff: string[];
    part3Intro?: string;
    part3OnlyIntro?: string;
  }) => void;
  busy: boolean;
  extra?: React.ReactNode;
}) {
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [bullets, setBullets] = useState(initial?.bullets.join("\n") ?? "");
  const [explain, setExplain] = useState(initial?.explain ?? "");
  const [spoken, setSpoken] = useState(initial?.spokenPrompt ?? "");
  const [roundOff, setRoundOff] = useState(initial?.roundOff.map((r) => r.text).join("\n") ?? "");
  const [p3, setP3] = useState(initial?.part3Intro ?? "");
  const [p3only, setP3only] = useState(initial?.part3OnlyIntro ?? "");
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,420px)]">
      <form
        className="space-y-4"
        aria-label="Cue card"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({
            prompt,
            bullets: toLines(bullets),
            explain,
            ...(spoken.trim() ? { spokenPrompt: spoken } : {}),
            roundOff: toLines(roundOff),
            ...(withPart3Intros && p3.trim() ? { part3Intro: p3 } : {}),
            ...(withPart3Intros && p3only.trim() ? { part3OnlyIntro: p3only } : {}),
          });
        }}
      >
        {extra}
        <Field label="Card heading">
          {(id) => (
            <input
              id={id}
              className={fieldClass}
              value={prompt}
              placeholder="Describe a book you enjoyed reading."
              onChange={(e) => setPrompt(e.target.value)}
            />
          )}
        </Field>
        <Field label="Bullet points" hint="one per line, up to 6">
          {(id) => (
            <textarea
              id={id}
              rows={4}
              className={fieldClass}
              value={bullets}
              placeholder={"what the book was\nwhen you read it\nwhat it was about"}
              onChange={(e) => setBullets(e.target.value)}
            />
          )}
        </Field>
        <Field label="Last line of the card">
          {(id) => (
            <input
              id={id}
              className={fieldClass}
              value={explain}
              placeholder="and explain why you enjoyed it."
              onChange={(e) => setExplain(e.target.value)}
            />
          )}
        </Field>
        <Field label="What the examiner says when giving the card" hint="optional">
          {(id) => (
            <input
              id={id}
              className={fieldClass}
              value={spoken}
              placeholder="Empty = “I'd like you to describe…” from the heading"
              onChange={(e) => setSpoken(e.target.value)}
            />
          )}
        </Field>
        <Field label="Follow-up (round-off) questions after the long turn" hint="optional, one per line, up to 2">
          {(id) => (
            <textarea
              id={id}
              rows={2}
              className={fieldClass}
              value={roundOff}
              onChange={(e) => setRoundOff(e.target.value)}
            />
          )}
        </Field>
        {withPart3Intros && (
          <details>
            <summary className="cursor-pointer font-semibold">Part 3 introductions (optional)</summary>
            <div className="mt-3 space-y-3">
              <Field label="In the full test" hint="leads from the card into Part 3">
                {(id) => <input id={id} className={fieldClass} value={p3} onChange={(e) => setP3(e.target.value)} />}
              </Field>
              <Field label="When Part 3 is practiced on its own">
                {(id) => (
                  <input id={id} className={fieldClass} value={p3only} onChange={(e) => setP3only(e.target.value)} />
                )}
              </Field>
            </div>
          </details>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </Button>
        <p className="text-xs text-muted">
          New wording is read by the browser voice until the examiner clips are re-rendered (pnpm voice:render).
        </p>
      </form>
      <div>
        <p className="mb-2 text-sm font-semibold text-muted">Student preview</p>
        <CueCardView prompt={prompt} bullets={toLines(bullets)} explain={explain} />
      </div>
    </div>
  );
}

export function TestCardForm({ testId, initial }: { testId: string; initial: CardInitial | null }) {
  const state = useAdminOp();
  return (
    <div className="card p-5">
      <CardFields
        initial={initial}
        withPart3Intros
        submitLabel={initial ? "Save cue card" : "Add cue card"}
        busy={state.busy}
        onSubmit={(fields) => void state.run({ op: "card.save", testId, fields })}
      />
      <OpFeedback state={state} className="mt-3" />
    </div>
  );
}
