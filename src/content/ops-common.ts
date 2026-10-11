/** Shared field rules for the admin operation schemas (forms and API use the same ones). */
import { z } from "zod";

export const idField = z.uuid("Invalid id.");
export const direction = z.enum(["up", "down"]);
export const statusField = z.enum(["draft", "published", "archived"]);

export const line = (what: string, max = 400) =>
  z.string().trim().min(1, `Enter ${what}.`).max(max, `Use at most ${max} characters.`);
export const optionalLine = (max = 400) => z.string().trim().max(max, `Use at most ${max} characters.`).optional();
export const lines = (max: number, what = "lines") =>
  z.array(z.string().trim().min(1).max(300)).max(max, `Use at most ${max} ${what}.`);

export const number = (what: string) =>
  z
    .number({ error: `Enter the ${what} as a whole number.` })
    .int(`Enter the ${what} as a whole number.`)
    .min(1, `The ${what} must be 1 or more.`)
    .max(10_000, `The ${what} is too large.`);

/** Cue card fields, shared by a test's Part 2 card and Makkar cue cards. */
export const cardFields = {
  prompt: line("the card heading (e.g. “Describe a book you enjoyed reading.”)", 200),
  bullets: lines(6, "bullet points").min(1, "Add at least one bullet point."),
  explain: line("the last line of the card (e.g. “and explain why you enjoyed it.”)", 200),
  spokenPrompt: optionalLine(300),
  roundOff: lines(2, "round-off questions").optional(),
};

/** "Cambridge 22" → "cambridge-22". */
export function slugify(text: string): string {
  return (
    text
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/g, "") || "item"
  );
}

/** First Zod issue as a readable sentence, for forms and API errors. */
export function firstIssue(error: z.ZodError): string {
  const i = error.issues[0];
  if (!i) return "Invalid request.";
  if (i.code === "unrecognized_keys") return `Unknown fields: ${i.keys.join(", ")}.`;
  if (i.code === "invalid_union" || i.code === "invalid_value") return i.message || "Invalid request.";
  return i.message;
}
