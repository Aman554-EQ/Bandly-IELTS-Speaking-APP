/**
 * Responsive guard rails (documentation/responsive-design.md): no page scrolls
 * sideways on a small phone or in phone landscape, and the mobile menu works.
 * The full device-by-device audit is described in that document.
 */
import { expect, type Page, test } from "@playwright/test";
import { signInAsStudent } from "./auth-helpers";

const SIZES = [
  { width: 320, height: 640 },
  { width: 844, height: 390 },
];

async function sideways(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test("public pages never scroll sideways on a small phone or in landscape", async ({ page }) => {
  test.setTimeout(3 * 60_000);
  for (const size of SIZES) {
    await page.setViewportSize(size);
    for (const path of [
      "/",
      "/library",
      "/library/makkar-cue-cards",
      "/guide",
      "/band-calculator",
      "/resources",
      "/privacy",
    ]) {
      await page.goto(path);
      expect(await sideways(page), `${path} at ${size.width}×${size.height}`).toBeLessThanOrEqual(1);
    }
  }
});

test("signed-in pages never scroll sideways on a small phone", async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await signInAsStudent(page);
  await page.setViewportSize(SIZES[0]);
  for (const path of ["/practice", "/practice/tests?part=part1", "/dashboard", "/results", "/profile"]) {
    await page.goto(path);
    expect(await sideways(page), path).toBeLessThanOrEqual(1);
  }
});

test("mobile menu: opens, lists every page, navigates and closes (Escape too)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
  const button = page.getByRole("button", { name: "Open menu" });
  await button.click();
  const menu = page.getByRole("navigation", { name: "Main" });
  for (const name of ["Home", "Library", "Practice", "My results", "Test guide", "Band calculator", "Resources"]) {
    await expect(menu.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("group", { name: "Colour theme" })).toBeVisible();
  await menu.getByRole("link", { name: "Band calculator" }).click();
  await expect(page).toHaveURL(/\/band-calculator$/);
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();
});
