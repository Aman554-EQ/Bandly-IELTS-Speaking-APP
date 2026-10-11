import { clerk } from "@clerk/testing/playwright";
import type { Page } from "@playwright/test";

/** Signs the browser in as the test student (created in global.setup.ts). */
export async function signInAsStudent(page: Page): Promise<void> {
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: process.env.E2E_CLERK_USER_EMAIL ?? "bandly-e2e+clerk_test@example.com" });
}

/** Signs the browser in as the test admin (created in global.setup.ts). */
export async function signInAsAdmin(page: Page): Promise<void> {
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: "bandly-e2e-admin+clerk_test@example.com" });
}

/** Signs the browser in as the test superadmin (created in global.setup.ts). */
export async function signInAsSuperadmin(page: Page): Promise<void> {
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: "bandly-e2e-super+clerk_test@example.com" });
}
