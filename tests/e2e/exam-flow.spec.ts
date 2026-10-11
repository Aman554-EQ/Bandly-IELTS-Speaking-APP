import { expect, test } from "@playwright/test";
import { signInAsStudent } from "./auth-helpers";

/**
 * Real-browser exam flow with a fake microphone that plays a recorded
 * student answer followed by silence (tests/e2e/fixtures/student-answer.wav).
 *
 * Covers: setup (mode, examiner, style) → mic check → voice detection →
 * clip prefetch → examiner speaking → mic opens → live analysis → examiner
 * continues → end test early → report page. With GROQ_API_KEY set this also
 * exercises real transcription and scoring; without it the exam must still
 * run to the end and the result page must offer re-scoring.
 */
test("Part 1 guided with James: listens, reacts, ends early and opens the result", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  const consoleErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/api\/sessions|Failed to load resource/.test(m.text())) consoleErrors.push(m.text());
  });

  // Every examiner clip must come from the chosen examiner's recordings (James), never Emma's.
  const voiceFiles: string[] = [];
  page.on("request", (r) => {
    const m = new URL(r.url()).pathname.match(/^\/voice\/([a-z]+)\/.+\.mp3$/);
    if (m) voiceFiles.push(m[1]);
  });

  await signInAsStudent(page);
  await page.goto("/practice?part=part1");
  await expect(page.getByRole("heading", { name: "Set up your test" })).toBeVisible();

  // All four tests are offered.
  for (const name of [/^Part 1/, /^Part 2/, /^Part 3/, /^Full Test/]) {
    await expect(page.getByRole("radio", { name })).toBeVisible();
  }
  await expect(page.getByRole("radio", { name: /^Part 1/ })).toHaveAttribute("aria-checked", "true");

  await page.getByRole("radio", { name: /James Carter/ }).click();
  await page.getByRole("radio", { name: /Guided style/ }).click();

  // Practice flow: compatible tests → overview (choices carried over) → start.
  await page.getByRole("link", { name: /See available tests/ }).click();
  await expect(page).toHaveURL(/\/practice\/tests\?.*part=part1.*voice=male.*style=guided/);
  await expect(page.getByRole("heading", { name: "Part 1 tests" })).toBeVisible();
  // The seeded sample test (admins may add tests that sort before it).
  await page.getByRole("link", { name: "Choose Practice Test Exam, Test 1", exact: true }).click();
  await expect(page.getByRole("radio", { name: /James Carter/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: /Guided style/ })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Begin test" }).click();

  // Mic check: permission + speech detected from the fake mic.
  await page.getByRole("button", { name: /Enable microphone/ }).click();
  await expect(page.getByText("We can hear you clearly.")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Start the test" }).click();

  // Examiner (James) greets; captions are on in Guided style.
  await expect(page.getByText(/Good (morning|afternoon|evening)\. My name is James Carter/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Can you tell me your full name, please?")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Your turn: speak now")).toBeVisible({ timeout: 20_000 });

  // End of turn detected → examiner continues with the format of the test.
  await expect(page.getByText(/Today you will practice Part 1/)).toBeVisible({ timeout: 60_000 });

  // First question asked, mic opens, answer analysed.
  await expect(page.getByText("Do you work, or are you a student?").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Your turn: speak now")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/is listening to your answer/)).toBeVisible({ timeout: 40_000 });

  // End the test early (confirm dialog) → formal closing → report.
  await page.getByRole("button", { name: "End test" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "End test" }).click();
  await expect(page.getByText("The test has now ended.").first()).toBeVisible({ timeout: 20_000 });

  await expect(page.getByRole("heading", { name: /Part 1/ }).first()).toBeVisible({ timeout: 120_000 });
  await page.waitForURL(/\/results\/[a-z0-9-]+/, { timeout: 120_000 });
  await expect(page.getByText(/Your result/).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your answers, word for word" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Practice Part 1 again/ })).toBeVisible();
  // The report never names the AI model or prompt version.
  await expect(page.locator("body")).not.toContainText(/qwen|llama|gpt-|whisper|score-v\d/i);

  expect(voiceFiles.length).toBeGreaterThan(5);
  expect(new Set(voiceFiles)).toEqual(new Set(["james"]));
  expect(consoleErrors).toEqual([]);
});

test("theme switcher offers Soft, White and Dark and remembers the choice", async ({ page }) => {
  await page.goto("/");
  const group = page.getByRole("group", { name: "Colour theme" });
  for (const t of ["Soft", "White", "Dark"])
    await expect(group.getByRole("button", { name: new RegExp(t) })).toBeVisible();
  await group.getByRole("button", { name: /Dark/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("group", { name: "Colour theme" }).getByRole("button", { name: /White/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "white");
});

test("home page: four tests, the guide video and the footer", async ({ page }) => {
  await signInAsStudent(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Practice with an examiner who runs the test just like the real exam.",
  );
  await expect(page.getByRole("main").getByRole("link", { name: /My results/ })).toHaveCount(0);
  const choose = page.getByRole("region", { name: "One part at a time, or the whole exam" });
  for (const t of ["Practice Part 1", "Practice Part 2", "Practice Part 3", "Take the full test"]) {
    await expect(choose.getByRole("link", { name: new RegExp(t) })).toBeVisible();
  }
  // The video loads only when played.
  await expect(page.locator('iframe[src*="youtube-nocookie.com/embed/ZF-s2XNCgJA"]')).toHaveCount(0);
  await page.getByRole("button", { name: /^Play video/ }).click();
  await expect(page.locator('iframe[src*="youtube-nocookie.com/embed/ZF-s2XNCgJA"]')).toHaveCount(1);
  // Footer: copyright with this year, legal links.
  const footer = page.getByRole("contentinfo");
  await expect(footer).toContainText(`© ${new Date().getFullYear()} Bandly`);
  await expect(footer.getByRole("link", { name: "Privacy policy" })).toHaveAttribute("href", "/privacy");
  // The footer is on the homepage only.
  await page.goto("/guide");
  await expect(page.getByRole("contentinfo")).toHaveCount(0);
  await page.goto("/");
  // A part card opens the setup with that part chosen.
  await choose.getByRole("link", { name: /Practice Part 3/ }).click();
  await expect(page).toHaveURL(/practice\?part=part3/);
  await expect(page.getByRole("radio", { name: /^Part 3/ })).toHaveAttribute("aria-checked", "true");
});

test("footer newsletter: the form sends the address; bad addresses are refused", async ({ page }) => {
  // The form only (storage is covered by tests/db): the API answer is stubbed, so the dev database stays clean.
  let sent: unknown = null;
  await page.route("**/api/newsletter", async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true, message: "Thanks! You're on the list." } });
  });
  await page.goto("/");
  const email = "someone@example.com";
  const form = page.getByRole("form", { name: "Subscribe to updates" });
  await form.getByLabel("Email address").fill(email);
  await form.getByRole("button", { name: "Subscribe" }).click();
  await expect(form.getByRole("status")).toHaveText("Thanks! You're on the list.");
  expect(sent).toEqual({ email, source: "footer" });
  await expect(form.getByLabel("Email address")).toHaveValue("");
  await page.unroute("**/api/newsletter");
  const bad = await page.request.post("/api/newsletter", { data: { email: "not-an-email" } });
  expect(bad.status()).toBe(400);
});
