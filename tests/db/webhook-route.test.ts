/**
 * The real /api/webhooks/clerk handler: signature verification (Svix/Standard
 * Webhooks HMAC), user creation with the student role, and duplicate deliveries.
 */
import { createHmac, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadAppUser } from "@/server/auth/users";
import { closeDb, type Db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { pointAtTestDatabase, resetDatabase } from "./helpers";

pointAtTestDatabase();
const KEY = randomBytes(24);
process.env.CLERK_WEBHOOK_SIGNING_SECRET = `whsec_${KEY.toString("base64")}`;
const { POST } = await import("@/app/api/webhooks/clerk/route");

let db: Db;

function signed(id: string, payload: unknown, opts: { badSignature?: boolean } = {}): NextRequest {
  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000).toString();
  const key = opts.badSignature ? randomBytes(24) : KEY;
  const sig = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  return new Request("http://localhost/api/webhooks/clerk", {
    method: "POST",
    headers: { "content-type": "application/json", "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,${sig}` },
    body,
  }) as unknown as NextRequest;
}

const userCreated = (clerkId: string, email: string) => ({
  type: "user.created",
  object: "event",
  data: {
    id: clerkId,
    object: "user",
    first_name: "Web",
    last_name: "Hook",
    image_url: "",
    primary_email_address_id: "idn_1",
    email_addresses: [{ id: "idn_1", email_address: email }],
  },
});

beforeAll(async () => {
  db = (await resetDatabase()).db;
}, 60_000);

afterAll(async () => {
  await closeDb();
});

describe("POST /api/webhooks/clerk", () => {
  it("rejects a delivery with a wrong signature and stores nothing", async () => {
    const res = await POST(signed("msg_bad", userCreated("user_hook0", "bad@example.com"), { badSignature: true }));
    expect(res.status).toBe(400);
    expect(await db.select().from(users).where(eq(users.clerkUserId, "user_hook0"))).toHaveLength(0);
  });

  it("creates the user with the student role from a valid delivery", async () => {
    const res = await POST(signed("msg_ok", userCreated("user_hook1", "hook@example.com")));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "processed" });
    const u = await loadAppUser(db, { clerkUserId: "user_hook1" });
    expect(u).toMatchObject({ email: "hook@example.com", displayName: "Web Hook", roles: ["student"] });
  });

  it("ignores the same delivery sent again", async () => {
    const res = await POST(signed("msg_ok", userCreated("user_hook1", "hook@example.com")));
    expect(await res.json()).toEqual({ result: "duplicate" });
    expect(await db.select().from(users).where(eq(users.clerkUserId, "user_hook1"))).toHaveLength(1);
  });
});
