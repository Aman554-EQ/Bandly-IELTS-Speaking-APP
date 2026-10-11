import "server-only";
import { AuthError } from "./auth/session";
import { isContentError } from "./db/admin-common";
import { PartNotAvailableError } from "./db/assemble";
import { NotAvailableError } from "./db/library";
import { AttemptClosedError } from "./db/repo";
import { ConfigError } from "./env";
import { GroqError } from "./groq";
import { NotFoundError } from "./score-service";

/** Maps internal errors to calm, user-facing JSON responses. */
export function errorResponse(e: unknown, context: string): Response {
  if (e instanceof AuthError) return Response.json({ error: e.message }, { status: e.status });
  if (isContentError(e)) return Response.json({ error: e.message, problems: e.problems }, { status: e.status });
  if (e instanceof NotAvailableError) return Response.json({ error: e.message }, { status: 404 });
  if (e instanceof PartNotAvailableError) return Response.json({ error: e.message }, { status: 400 });
  if (e instanceof AttemptClosedError) return Response.json({ error: e.message }, { status: 409 });
  if (e instanceof ConfigError) return Response.json({ error: e.message }, { status: 500 });
  if (e instanceof NotFoundError || (e instanceof Error && e.message === "Session not found")) {
    return Response.json({ error: "This test session was not found." }, { status: 404 });
  }
  if (e instanceof GroqError) {
    if (e.status === 429) {
      return Response.json(
        { error: "The AI service is busy right now. Please try again in a minute." },
        { status: 429 },
      );
    }
    return Response.json({ error: "The AI service did not respond. Please try again." }, { status: 502 });
  }
  console.error(`[${context}]`, e);
  return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}
