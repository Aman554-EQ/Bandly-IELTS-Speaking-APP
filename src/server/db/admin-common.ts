/**
 * Shared machinery for admin content changes (tests and cue cards):
 * permission check (`content.manage`, denials audited) → ONE transaction →
 * audit row → database constraint errors turned into friendly messages.
 */
import { randomBytes } from "node:crypto";
import { type AppUser, can } from "@/server/auth/policy";
import { type RequestMeta, writeAudit } from "@/server/auth/users";
import type { Db } from "./client";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export class ContentError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    message: string,
    readonly problems: string[] = [],
  ) {
    super(message);
    this.name = "ContentError";
  }
}

/**
 * True for a ContentError, even when the dev server has loaded this module twice
 * (then `instanceof` fails and a friendly 409 would become a 500).
 */
export function isContentError(e: unknown): e is ContentError {
  return (
    e instanceof ContentError ||
    (e instanceof Error && e.name === "ContentError" && typeof (e as { status?: unknown }).status === "number")
  );
}

export interface OpResult {
  id?: string;
  message: string;
}

/** A fresh engine key, e.g. "t-3f9a1c2b" (audio clips are keyed by these). */
export const newKey = (prefix: string) => `${prefix}-${randomBytes(4).toString("hex")}`;

/** Messages for unique-constraint names (Postgres error 23505). */
export type ConstraintMessages = Record<string, string>;

function friendly(e: unknown, messages: ConstraintMessages): unknown {
  if (isContentError(e)) return e;
  const err =
    (e as { cause?: { code?: string; constraint?: string } })?.cause ?? (e as { code?: string; constraint?: string });
  if (err?.code === "23505")
    return new ContentError(409, messages[err.constraint ?? ""] ?? "That would create a duplicate.");
  if (err?.code === "23503") {
    return new ContentError(409, "Something still uses this item, so it can't be removed. Archive it instead.");
  }
  return e;
}

export async function runAdminOp<O extends { op: string }>(
  db: Db,
  actor: AppUser,
  op: O,
  run: (tx: Tx) => Promise<OpResult>,
  opts: { meta?: RequestMeta; messages?: ConstraintMessages } = {},
): Promise<OpResult> {
  const entityType = op.op.split(".")[0];
  if (!can(actor, "content.manage")) {
    await writeAudit(db, {
      actorUserId: actor.id,
      action: `${op.op}.denied`,
      entityType,
      entityId: "id" in op ? String(op.id) : null,
      after: { op: op.op, reason: "not_allowed" },
      meta: opts.meta,
    });
    throw new ContentError(403, "Only admins can change content.");
  }
  try {
    return await db.transaction(async (tx) => {
      const result = await run(tx);
      await writeAudit(tx, {
        actorUserId: actor.id,
        action: op.op,
        entityType,
        entityId: result.id ?? ("id" in op ? String(op.id) : null),
        after: op,
        meta: opts.meta,
      });
      return result;
    });
  } catch (e) {
    throw friendly(e, opts.messages ?? {});
  }
}

/** "I'd like you to describe a book you enjoyed reading." from the card heading. */
export function defaultSpokenPrompt(prompt: string): string {
  const p = prompt.trim().replace(/\.$/, "");
  return `I'd like you to ${p.charAt(0).toLowerCase()}${p.slice(1)}.`;
}

/** Round-off questions keep their id while the wording is unchanged (audio stays valid). */
export function roundOffWithIds(texts: string[] | undefined, old: { id: string; text: string }[] = []) {
  return (texts ?? []).map((text, i) => ({ id: old[i]?.text === text ? old[i].id : newKey("r"), text }));
}
