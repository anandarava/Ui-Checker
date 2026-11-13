import { defineConfig } from "@playwright/test";

/**
 * Playwright configuration for the CI scan (ci/example.spec.ts). It needs no
 * extension and no build: the scan engine is bundled when the test starts.
 * See ci/README.md.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "**/example.spec.ts",
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
  outputDir: "../test-results/ci",
  use: { viewport: { width: 1440, height: 900 } },
});
