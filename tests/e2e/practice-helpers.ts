import { expect, type Page } from "@playwright/test";

/** The first published test offering a part (from the public GET /api/question-sets). */
export async function firstTestId(page: Page, mode: "part1" | "part2" | "part3" | "full"): Promise<string> {
  const res = await page.request.get("/api/question-sets");
  const { sets } = (await res.json()) as { sets: { id: string; modes: string[] }[] };
  const hit = sets.find((s) => s.modes.includes(mode));
  if (!hit) throw new Error(`No published test offers ${mode}`);
  return hit.id;
}

/** From the overview screen: microphone check, then start. Ends when the exam is running. */
export async function startFromOverview(page: Page) {
  await page.getByRole("button", { name: "Begin test" }).click();
  await page.getByRole("button", { name: /Enable microphone/ }).click();
  await expect(page.getByText("We can hear you clearly.")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Start the test" }).click();
  await expect(page.getByRole("button", { name: "End test" })).toBeVisible({ timeout: 30_000 });
}
