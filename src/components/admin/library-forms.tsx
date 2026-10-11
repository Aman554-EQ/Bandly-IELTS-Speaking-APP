"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { type CardInitial, CardFields } from "./test-editor";
import { Field, fieldClass, OpFeedback } from "./ui";
import { useAdminOp } from "./use-admin-op";

// --------------------------------------------------------------- categories

export function CategoryForm({ c }: { c: { id: string; title: string; description: string | null } }) {
  const state = useAdminOp();
  const [title, setTitle] = useState(c.title);
  const [description, setDescription] = useState(c.description ?? "");
  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end"
      aria-label={`Category ${c.title}`}
      onSubmit={(e) => {
        e.preventDefault();
        void state.run({ op: "category.update", id: c.id, title, description: description.trim() || null });
      }}
    >
      <Field label="Name">
        {(id) => <input id={id} className={fieldClass} value={title} onChange={(e) => setTitle(e.target.value)} />}
      </Field>
      <Field label="Description">
        {(id) => (
          <input id={id} className={fieldClass} value={description} onChange={(e) => setDescription(e.target.value)} />
        )}
      </Field>
      <Button type="submit" size="md" variant="secondary" disabled={state.busy}>
        Save
      </Button>
      <OpFeedback state={state} className="sm:col-span-3" />
    </form>
  );
}

// -------------------------------------------------------------------- books

export function NewBookForm({ categoryId, nextNumber }: { categoryId: string; nextNumber: number }) {
  const state = useAdminOp();
  const [n, setN] = useState(String(nextNumber));
  return (
    <form
      className="card flex flex-wrap items-end gap-3 p-5"
      aria-label="New book"
      onSubmit={async (e) => {
        e.preventDefault();
        await state.run({ op: "book.create", categoryId, number: Number(n) });
      }}
    >
      <Field label="Book number" hint={`creates “Cambridge ${n || "…"}”`}>
        {(id) => (
          <input
            id={id}
            inputMode="numeric"
            className={`${fieldClass} w-32`}
            value={n}
            onChange={(e) => setN(e.target.value.replace(/\D/g, ""))}
          />
        )}
      </Field>
      <Button type="submit" disabled={state.busy}>
        Add book
      </Button>
      <OpFeedback state={state} className="w-full" />
    </form>
  );
}

export function BookRowForm({ b }: { b: { id: string; title: string; number: number | null } }) {
  const state = useAdminOp();
  const [title, setTitle] = useState(b.title);
  const [n, setN] = useState(String(b.number ?? ""));
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      aria-label={`Book ${b.title}`}
      onSubmit={(e) => {
        e.preventDefault();
        void state.run({ op: "book.update", id: b.id, title, number: Number(n) });
      }}
    >
      <Field label="Number">
        {(id) => (
          <input
            id={id}
            inputMode="numeric"
            className={`${fieldClass} w-24`}
            value={n}
            onChange={(e) => setN(e.target.value.replace(/\D/g, ""))}
          />
        )}
      </Field>
      <Field label="Title">
        {(id) => <input id={id} className={fieldClass} value={title} onChange={(e) => setTitle(e.target.value)} />}
      </Field>
      <Button type="submit" size="md" variant="secondary" disabled={state.busy}>
        Save
      </Button>
      <OpFeedback state={state} className="w-full" />
    </form>
  );
}

// --------------------------------------------------------------- cue cards

export function CueTopicForm({ topic }: { topic?: { id: string; title: string; description: string | null } }) {
  const state = useAdminOp();
  const router = useRouter();
  const [title, setTitle] = useState(topic?.title ?? "");
  const [description, setDescription] = useState(topic?.description ?? "");
  return (
    <form
      className="space-y-3"
      aria-label={topic ? "Edit topic" : "New topic"}
      onSubmit={async (e) => {
        e.preventDefault();
        if (topic) {
          await state.run({ op: "cueTopic.update", id: topic.id, title, description: description.trim() || null });
        } else {
          const r = await state.run({ op: "cueTopic.create", title, description: description.trim() || null });
          if (r?.id) {
            setTitle("");
            setDescription("");
            router.push(`/admin/cue-cards?topic=${r.id}`);
          }
        }
      }}
    >
      <Field label="Topic name">
        {(id) => (
          <input
            id={id}
            className={fieldClass}
            value={title}
            placeholder="e.g. Hobbies"
            onChange={(e) => setTitle(e.target.value)}
          />
        )}
      </Field>
      <Field label="Description" hint="optional">
        {(id) => (
          <input id={id} className={fieldClass} value={description} onChange={(e) => setDescription(e.target.value)} />
        )}
      </Field>
      <Button type="submit" variant={topic ? "secondary" : "primary"} size="sm" disabled={state.busy}>
        {topic ? "Save topic" : "Add topic"}
      </Button>
      <OpFeedback state={state} />
    </form>
  );
}

export function CueCardForm({
  card,
  topicId,
  topics,
}: {
  card?: { id: string; topicId: string } & CardInitial;
  topicId: string;
  topics: { id: string; title: string }[];
}) {
  const state = useAdminOp();
  const router = useRouter();
  const [topic, setTopic] = useState(card?.topicId ?? topicId);
  return (
    <div>
      <CardFields
        initial={card ?? null}
        withPart3Intros={false}
        submitLabel={card ? "Save cue card" : "Create cue card"}
        busy={state.busy}
        extra={
          <Field label="Topic">
            {(id) => (
              <select id={id} className={fieldClass} value={topic} onChange={(e) => setTopic(e.target.value)}>
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            )}
          </Field>
        }
        onSubmit={async (f) => {
          const { part3Intro: _a, part3OnlyIntro: _b, ...fields } = f;
          if (card) {
            await state.run({ op: "cueCard.update", id: card.id, topicId: topic, fields });
          } else {
            const r = await state.run({ op: "cueCard.create", topicId: topic, fields });
            if (r?.id) router.push(`/admin/cue-cards/${r.id}`);
          }
        }}
      />
      <OpFeedback state={state} className="mt-3" />
    </div>
  );
}
