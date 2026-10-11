import type { UserJSON } from "@clerk/nextjs/server";
import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";
import { type ClerkEventLite, type ClerkUserLite, handleClerkEvent } from "@/server/auth/users";
import { getDb } from "@/server/db/client";
import { errorResponse } from "@/server/http";

/**
 * POST /api/webhooks/clerk (Clerk dashboard → Webhooks; events user.created,
 * user.updated, user.deleted). The Svix signature is verified with
 * CLERK_WEBHOOK_SIGNING_SECRET; each delivery (svix-id) is processed once.
 * Users are also created on their first request (lazy sync), so a late or
 * missing webhook never locks anyone out.
 */
function userFromJson(u: UserJSON): ClerkUserLite | undefined {
  const email =
    u.email_addresses.find((e) => e.id === u.primary_email_address_id)?.email_address ??
    u.email_addresses[0]?.email_address;
  if (!email) return undefined;
  return { id: u.id, email, firstName: u.first_name, lastName: u.last_name, imageUrl: u.image_url || null };
}

export async function POST(req: NextRequest) {
  if (!process.env.CLERK_WEBHOOK_SIGNING_SECRET) {
    return Response.json({ error: "Webhooks are not configured." }, { status: 503 });
  }
  const deliveryId = req.headers.get("svix-id");
  let evt: Awaited<ReturnType<typeof verifyWebhook>>;
  try {
    evt = await verifyWebhook(req);
  } catch {
    return Response.json({ error: "Invalid signature." }, { status: 400 });
  }
  if (!deliveryId) return Response.json({ error: "Missing delivery id." }, { status: 400 });

  const lite: ClerkEventLite = { deliveryId, type: evt.type };
  if (evt.type === "user.created" || evt.type === "user.updated") lite.user = userFromJson(evt.data);
  if (evt.type === "user.deleted" && evt.data.id) lite.deletedUserId = evt.data.id;
  try {
    return Response.json({ result: await handleClerkEvent(getDb(), lite) });
  } catch (e) {
    // 500 makes Clerk retry; the delivery is only marked processed on success.
    return errorResponse(e, "webhooks:clerk");
  }
}
