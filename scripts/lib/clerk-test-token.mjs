// Short-lived Clerk session token for the test student, so scripts and live
// tests can call the API as a signed-in user ("Authorization: Bearer <token>").
// Development instances only. Used by tests/live and scripts/live-check.mjs.
import { createClerkClient } from "@clerk/backend";

/** @returns {Promise<string>} a session JWT valid for `seconds` */
export async function testStudentToken(seconds = 900) {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("CLERK_SECRET_KEY is missing in .env.local.");
  if (secretKey.startsWith("sk_live_")) throw new Error("Refusing to create test sessions on a live Clerk instance.");
  const email = process.env.E2E_CLERK_USER_EMAIL ?? "bandly-e2e+clerk_test@example.com";
  const clerk = createClerkClient({ secretKey });
  const { data } = await clerk.users.getUserList({ emailAddress: [email], limit: 1 });
  const user =
    data[0] ??
    (await clerk.users.createUser({ emailAddress: [email], skipPasswordRequirement: true, firstName: "Test" }));
  const session = await clerk.sessions.createSession({ userId: user.id });
  const token = await clerk.sessions.getToken(session.id, undefined, seconds);
  return token.jwt;
}
