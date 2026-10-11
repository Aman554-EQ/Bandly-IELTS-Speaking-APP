import { expect, type Page, test } from "@playwright/test";
import { signInAsStudent, signInAsSuperadmin } from "./auth-helpers";

/** The page content, without the site header and footer (they repeat links such as "Part 1"). */
const inMain = (page: Page) => page.locator("#main");

/** Sign-in, protected pages, role checks and the profile allowlist (database-integration.md §6–7). */

test("visitors are sent to sign-in and come back to the page they asked for", async ({ page }) => {
  await page.goto("/practice?mode=part2");
  await expect(page).toHaveURL(/\/sign-in\?.*redirect_url=/);
  expect(decodeURIComponent(page.url())).toContain("/practice?mode=part2");
});

test("API routes answer 401 to visitors instead of redirecting", async ({ request }) => {
  expect((await request.get("/api/sessions")).status()).toBe(401);
  expect((await request.patch("/api/profile", { data: { displayName: "x" } })).status()).toBe(401);
  expect(
    (
      await request.post("/api/superadmin/users/0192f000-0000-7000-8000-000000000000/access", {
        data: { kind: "grant", role: "admin" },
      })
    ).status(),
  ).toBe(401);
  // Public: the question-set listing.
  expect((await request.get("/api/question-sets")).status()).toBe(200);
});

test("a student reaches the dashboard but not the admin or superadmin pages", async ({ page }) => {
  await signInAsStudent(page);
  await page.goto("/auth/continue");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(inMain(page).getByRole("heading", { name: /Welcome/ })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("link", { name: "Dashboard" })).toBeVisible();

  for (const path of ["/admin", "/superadmin"]) {
    await page.goto(path);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
  }
  const res = await page.request.post("/api/superadmin/users/0192f000-0000-7000-8000-000000000000/access", {
    data: { kind: "grant", role: "superadmin" },
  });
  expect(res.status()).toBe(403);
});

test("profile: allowed fields save, protected fields are rejected", async ({ page }) => {
  await signInAsStudent(page);
  await page.goto("/profile");
  await page.getByLabel("Display name").fill("E2E Student");
  await page.getByLabel("Default examiner").selectOption("james");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(inMain(page).getByRole("status")).toHaveText("Saved.");

  const bad = await page.request.patch("/api/profile", { data: { displayName: "Hacker", role: "superadmin" } });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).error).toMatch(/cannot be changed/);
  const me = await (await page.request.get("/api/profile")).json();
  expect(me.displayName).toBe("E2E Student");
  expect(me.roles).toEqual(["student"]);

  // The saved default examiner is preselected on the practice page.
  await page.goto("/practice");
  await expect(page.getByRole("radio", { name: /James Carter/ })).toHaveAttribute("aria-checked", "true");
});

test("a result that is not yours (or does not exist) answers 404", async ({ page }) => {
  await signInAsStudent(page);
  const res = await page.request.get("/api/sessions/0192f000-0000-7000-8000-000000000000");
  expect(res.status()).toBe(404);
});

test("superadmin page lists users with their roles and the audit log", async ({ page }) => {
  await signInAsSuperadmin(page);
  await page.goto("/auth/continue");
  await expect(page).toHaveURL(/\/superadmin$/);
  await expect(inMain(page).getByRole("heading", { name: "Users and access" })).toBeVisible();
  const me = inMain(page).getByRole("listitem").filter({ hasText: "bandly-e2e-super+clerk_test@example.com" });
  await expect(me.getByText("superadmin", { exact: true })).toBeVisible();
  await expect(inMain(page).getByRole("heading", { name: "Audit log" })).toBeVisible();

  // Search narrows the list; removing your own role is refused with a clear message.
  // Live search: no button, the list updates while typing.
  await page.getByLabel("Search users by email or name").fill("bandly-e2e-super");
  await expect(page).toHaveURL((u) => u.searchParams.get("q") === "bandly-e2e-super");
  await expect(inMain(page).getByRole("listitem")).toHaveCount(1);
  await page.getByRole("button", { name: "Remove superadmin" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove superadmin" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "cannot change your own role" })).toBeVisible();
});
