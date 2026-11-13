import { defineConfig } from "@playwright/test";

/**
 * Playwright configuration.
 *
 * Project `extension` (tests/e2e) launches a persistent Chromium context with
 * the built extension (dist/) loaded. Extensions only work in Chromium with a
 * persistent context, so the tests create their own context instead of using
 * the `page` fixture. Run `npm run build` first; the suite skips itself when
 * dist/ is missing.
 *
 * Environment variables:
 *   UICHECK_E2E_HEADED=1   run with a visible browser window
 *   UICHECK_E2E_DIST=path  load a different build directory (default: ./dist)
 */
export default defineConfig({
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "test-results/playwright-report" }]] : [["list"]],
  outputDir: "test-results/e2e",
  use: {
    trace: "retain-on-failure",
    video: "off",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "extension", testDir: "./tests/e2e", testMatch: "**/*.spec.ts" }],
});
