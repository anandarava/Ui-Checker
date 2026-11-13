import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@shared": r("./shared"),
      "@src": r("./src"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.ts"],
    setupFiles: ["tests/unit/support/setup.ts"],
    exclude: ["node_modules", "dist", "tests/e2e/**"],
    globals: false,
    restoreMocks: true,
    testTimeout: 15_000,
    reporters: process.env.CI ? ["default", "junit"] : ["default"],
    outputFile: { junit: "test-results/unit-junit.xml" },
  },
});
