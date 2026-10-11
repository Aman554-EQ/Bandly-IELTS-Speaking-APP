import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const fixture = (name: string) => path.resolve(__dirname, "tests/e2e/fixtures", name);

/** Chrome with a fake microphone that plays `wav` on a loop. */
function fakeMic(wav: string) {
  return {
    ...devices["Desktop Chrome"],
    permissions: ["microphone"],
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-audio-capture=${fixture(wav)}`,
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  };
}

export default defineConfig({
  testDir: "tests/e2e",
  // Clerk testing token + test student (needs the Clerk Development keys in .env.local).
  globalSetup: "./tests/e2e/global.setup.ts",
  timeout: 4 * 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium-fake-mic", use: fakeMic("student-answer.wav") }],
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
