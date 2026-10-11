import { redirect } from "next/navigation";
import { homeFor } from "@/server/auth/policy";
import { getCurrentUser } from "@/server/auth/session";

/**
 * GET /auth/continue: where Clerk sends people after sign-in or sign-up when no
 * page was requested first. Sends each role to its own home (§7.1). When a
 * protected page was requested, Clerk returns there instead (redirect_url).
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (user.status !== "active") redirect("/account-suspended");
  redirect(homeFor(user));
}
