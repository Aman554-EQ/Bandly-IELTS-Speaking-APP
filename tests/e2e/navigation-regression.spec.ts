import { expect, type Page, test } from "@playwright/test";
import { signInAsStudent } from "./auth-helpers";
import { firstTestId, startFromOverview } from "./practice-helpers";

/**
 * Regression tests for the "UI freezes after a test until Ctrl+R" bug.
 *
 * Root cause: with Cache Components, Next.js hides pages you leave with React
 * <Activity> instead of unmounting them, so /practice kept its old state
 * ("Preparing your report", or a live exam whose audio was already closed).
 * See documentation/sessions/2026-10-10-s05-database-foundation.md.
 */

test.beforeEach(async ({ page }) => {
  await signInAsStudent(page);
});

async function startExam(page: Page, mode: "part1" | "part3") {
  await page.goto(`/practice/start?test=${await firstTestId(page, mode)}&part=${mode}`);
  await startFromOverview(page);
}

async function endExamAndOpenResult(page: Page) {
  await page.getByRole("button", { name: "End test" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "End test" }).click();
  await page.waitForURL(/\/results\/[a-z0-9-]+/, { timeout: 150_000 });
  await expect(page.getByText(/Your result/).first()).toBeVisible();
}

function headerLink(page: Page, name: string) {
  return page.getByRole("banner").getByRole("link", { name, exact: true });
}

test("after a finished test, Practice opens a fresh setup and a second test runs (no reload)", async ({ page }) => {
  test.setTimeout(8 * 60_000);
  await startExam(page, "part1");
  await endExamAndOpenResult(page);
  const firstResult = page.url();

  // Back to practice through the header: must show a fresh setup, not the old "Preparing your report".
  await headerLink(page, "Practice").click();
  await expect(page.getByRole("heading", { name: "Set up your test" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Preparing your report")).toBeHidden();

  // Switch to another part and run a second test immediately (all client-side navigation).
  await page.getByRole("radio", { name: /^Part 3/ }).click();
  await page.getByRole("link", { name: /See available tests/ }).click();
  await page
    .getByRole("link", { name: /^Choose / })
    .first()
    .click();
  await startFromOverview(page);
  await endExamAndOpenResult(page);
  expect(page.url()).not.toBe(firstResult);

  // Browser back from a finished result never lands in a dead exam.
  await page.goBack();
  await expect(page.getByText("Preparing your report")).toBeHidden({ timeout: 10_000 });
});

test("leaving mid-exam stops the examiner and Practice starts fresh", async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await startExam(page, "part1");

  // Leave while the exam is running (the leave warning only applies to reloads/closing the tab).
  await headerLink(page, "My results").click();
  await expect(page).toHaveURL(/\/results$/);

  // The hidden exam must not keep running and later pull us to a result page.
  await page.waitForTimeout(8_000);
  await expect(page).toHaveURL(/\/results$/);

  await headerLink(page, "Practice").click();
  await expect(page.getByRole("heading", { name: "Set up your test" })).toBeVisible({ timeout: 10_000 });
});
