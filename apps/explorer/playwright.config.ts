import { defineConfig, devices } from "@playwright/test";

// The demo path runs against a deployed explorer: https://sdiqt.xyz by
// default, or SDIQT_E2E_URL (a local `pnpm dev` at http://127.0.0.1:5320).
export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.SDIQT_E2E_URL ?? "https://sdiqt.xyz",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
