/** Footer newsletter sign-ups against the test database. */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, type Db } from "@/server/db/client";
import { subscribe } from "@/server/db/newsletter";
import { newsletterSubscribers } from "@/server/db/schema";
import { pointAtTestDatabase, resetDatabase } from "./helpers";

pointAtTestDatabase();
let db: Db;

beforeAll(async () => {
  db = (await resetDatabase()).db;
}, 60_000);
afterAll(async () => {
  await closeDb();
});

describe("newsletter", () => {
  it("stores an address once, case-insensitively, and re-activates it", async () => {
    expect(await subscribe(db, { email: "  Reader@Example.com " })).toBe(true);
    expect(await subscribe(db, { email: "reader@example.com" })).toBe(false);
    const rows = await db.select().from(newsletterSubscribers);
    expect(rows.map((r) => r.email)).toEqual(["reader@example.com"]);
    await db
      .update(newsletterSubscribers)
      .set({ unsubscribedAt: new Date() })
      .where(eq(newsletterSubscribers.email, "reader@example.com"));
    await subscribe(db, { email: "READER@example.com" });
    const [again] = await db.select().from(newsletterSubscribers);
    expect(again.unsubscribedAt).toBeNull();
    expect(again.source).toBe("footer");
  });
});
