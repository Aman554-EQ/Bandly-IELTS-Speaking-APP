/**
 * Admin changes to the Makkar cue card library: topics and cards
 * (step3.md §3, §4.6). Entry point: `applyCueOp` (POST /api/admin/cue-cards).
 * Separate from tests, so a cue card can never land in a test.
 */
import { and, asc, eq, max, ne, sql } from "drizzle-orm";
import type { CueOp } from "@/content/cue-card-ops";
import { slugify } from "@/content/ops-common";
import type { AppUser } from "@/server/auth/policy";
import type { RequestMeta } from "@/server/auth/users";
import {
  ContentError,
  defaultSpokenPrompt,
  newKey,
  type OpResult,
  roundOffWithIds,
  runAdminOp,
  type Tx,
} from "./admin-common";
import type { Db } from "./client";
import { cueCards, cueCardTopics } from "./schema";

const MESSAGES = {
  cue_card_topics_slug_unique: "A topic with this name already exists.",
  cue_cards_topic_slug_uq: "This topic already has a card with that heading.",
};

export function applyCueOp(db: Db, actor: AppUser, op: CueOp, meta?: RequestMeta): Promise<OpResult> {
  return runAdminOp(db, actor, op, (tx) => run(tx, actor, op), { meta, messages: MESSAGES });
}

async function mustTopic(tx: Tx, id: string) {
  const [t] = await tx.select().from(cueCardTopics).where(eq(cueCardTopics.id, id));
  if (!t) throw new ContentError(404, "Topic not found.");
  return t;
}

async function mustCard(tx: Tx, id: string) {
  const [c] = await tx.select().from(cueCards).where(eq(cueCards.id, id));
  if (!c) throw new ContentError(404, "Cue card not found.");
  return c;
}

async function freeCardSlug(tx: Tx, topicId: string, base: string, exceptId?: string) {
  const rows = await tx
    .select({ slug: cueCards.slug })
    .from(cueCards)
    .where(and(eq(cueCards.topicId, topicId), exceptId ? ne(cueCards.id, exceptId) : undefined));
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

async function nextCardPosition(tx: Tx, topicId: string) {
  const [r] = await tx
    .select({ m: max(cueCards.position) })
    .from(cueCards)
    .where(eq(cueCards.topicId, topicId));
  return (r?.m ?? 0) + 1;
}

async function swapIn<T extends { id: string; position: number }>(
  rows: T[],
  id: string,
  dir: "up" | "down",
  write: (id: string, p: number) => Promise<unknown>,
) {
  const renumbered = rows.map((r, i) => ({ ...r, position: i + 1 }));
  for (const r of renumbered) await write(r.id, r.position);
  const i = renumbered.findIndex((r) => r.id === id);
  const j = i + (dir === "up" ? -1 : 1);
  if (i < 0 || j < 0 || j >= renumbered.length) return;
  await write(renumbered[i].id, renumbered[j].position);
  await write(renumbered[j].id, renumbered[i].position);
}

async function run(tx: Tx, actor: AppUser, op: CueOp): Promise<OpResult> {
  switch (op.op) {
    case "cueTopic.create": {
      const [{ m }] = await tx.select({ m: max(cueCardTopics.position) }).from(cueCardTopics);
      const [t] = await tx
        .insert(cueCardTopics)
        .values({
          slug: slugify(op.title),
          title: op.title,
          description: op.description ?? null,
          position: (m ?? 0) + 1,
        })
        .returning({ id: cueCardTopics.id });
      return { id: t.id, message: `Topic “${op.title}” added.` };
    }
    case "cueTopic.update": {
      const t = await mustTopic(tx, op.id);
      await tx
        .update(cueCardTopics)
        .set({
          ...(op.title !== undefined && { title: op.title, slug: slugify(op.title) }),
          ...(op.description !== undefined && { description: op.description }),
        })
        .where(eq(cueCardTopics.id, t.id));
      return { id: t.id, message: "Topic saved." };
    }
    case "cueTopic.move": {
      await mustTopic(tx, op.id);
      const all = await tx
        .select({ id: cueCardTopics.id, position: cueCardTopics.position })
        .from(cueCardTopics)
        .orderBy(asc(cueCardTopics.position), asc(cueCardTopics.title));
      await swapIn(all, op.id, op.direction, (id, p) =>
        tx.update(cueCardTopics).set({ position: p }).where(eq(cueCardTopics.id, id)),
      );
      return { id: op.id, message: "Moved." };
    }
    case "cueTopic.delete": {
      const t = await mustTopic(tx, op.id);
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(cueCards)
        .where(eq(cueCards.topicId, t.id));
      if (n > 0)
        throw new ContentError(
          409,
          `“${t.title}” still has ${n} card${n === 1 ? "" : "s"}. Move or delete them first.`,
        );
      await tx.delete(cueCardTopics).where(eq(cueCardTopics.id, t.id));
      return { id: t.id, message: `Topic “${t.title}” deleted.` };
    }
    case "cueCard.create": {
      const t = await mustTopic(tx, op.topicId);
      const f = op.fields;
      const [c] = await tx
        .insert(cueCards)
        .values({
          topicId: t.id,
          slug: await freeCardSlug(tx, t.id, slugify(f.prompt).slice(0, 60)),
          prompt: f.prompt,
          bullets: f.bullets,
          explain: f.explain,
          spokenPrompt: f.spokenPrompt || defaultSpokenPrompt(f.prompt),
          roundOff: roundOffWithIds(f.roundOff),
          engineKey: newKey("card"),
          status: "draft",
          position: await nextCardPosition(tx, t.id),
          createdBy: actor.id,
        })
        .returning({ id: cueCards.id });
      return { id: c.id, message: "Cue card created as a draft." };
    }
    case "cueCard.update": {
      const c = await mustCard(tx, op.id);
      const f = op.fields;
      const topicId = op.topicId ?? c.topicId;
      if (topicId !== c.topicId) await mustTopic(tx, topicId);
      const spokenPrompt = f.spokenPrompt || defaultSpokenPrompt(f.prompt);
      await tx
        .update(cueCards)
        .set({
          topicId,
          ...(topicId !== c.topicId && { position: await nextCardPosition(tx, topicId) }),
          slug: await freeCardSlug(tx, topicId, slugify(f.prompt).slice(0, 60), c.id),
          prompt: f.prompt,
          bullets: f.bullets,
          explain: f.explain,
          spokenPrompt,
          roundOff: roundOffWithIds(f.roundOff, c.roundOff),
          // New wording → new audio key, so an old recording is never played for new words.
          engineKey: spokenPrompt !== c.spokenPrompt ? newKey("card") : c.engineKey,
          version: sql`${cueCards.version} + 1`,
        })
        .where(eq(cueCards.id, c.id));
      return { id: c.id, message: topicId !== c.topicId ? "Saved and moved to the new topic." : "Cue card saved." };
    }
    case "cueCard.status": {
      const c = await mustCard(tx, op.id);
      await tx.update(cueCards).set({ status: op.status }).where(eq(cueCards.id, c.id));
      const verb = op.status === "published" ? "published" : op.status === "archived" ? "archived" : "back to draft";
      return { id: c.id, message: `The cue card is ${verb}.` };
    }
    case "cueCard.move": {
      const c = await mustCard(tx, op.id);
      const sibs = await tx
        .select({ id: cueCards.id, position: cueCards.position })
        .from(cueCards)
        .where(eq(cueCards.topicId, c.topicId))
        .orderBy(asc(cueCards.position), asc(cueCards.id));
      await swapIn(sibs, c.id, op.direction, (id, p) =>
        tx.update(cueCards).set({ position: p }).where(eq(cueCards.id, id)),
      );
      return { id: c.id, message: "Moved." };
    }
    case "cueCard.delete": {
      const c = await mustCard(tx, op.id);
      const used = Number(
        ((
          await tx.execute<{ n: number }>(
            sql`SELECT count(*)::int AS n FROM exam_attempts WHERE cue_card_id = ${c.id}::uuid`,
          )
        ).rows[0]?.n as number) ?? 0,
      );
      if (used > 0) {
        throw new ContentError(
          409,
          `This card can't be deleted: ${used} recorded test${used === 1 ? "" : "s"} used it. Archive it instead.`,
        );
      }
      await tx.delete(cueCards).where(eq(cueCards.id, c.id));
      return { id: c.id, message: "Cue card deleted." };
    }
  }
}
