/**
 * Sample CI test: scan a page with the UI Consistency Checker engine and fail
 * only on issues that are not in the baseline.
 *
 *   UICHECK_URL=https://staging.example.test/orders npx playwright test -c ci/playwright.config.ts
 *
 * Environment
 *   UICHECK_URL              page to scan, or several separated by spaces (the test skips itself when unset)
 *   UICHECK_BASELINE         baseline file (default ./ui-baseline.json); a missing file is an empty baseline
 *   UICHECK_UPDATE_BASELINE  "1": write the issues found as the new baseline instead of failing
 *   UICHECK_WIDTHS           viewport widths to scan at, e.g. "1440,1024,768,375" (default 1440)
 *   UICHECK_PRESET           strict | normal | relaxed (default normal)
 *   UICHECK_TOKENS           a design-token file: the design scale is checked against it
 *   UICHECK_ORIGIN           when the baseline is an export of the options page: the site whose
 *                            baseline to use (default: every site in the file)
 *
 * The baseline can be written here (UICHECK_UPDATE_BASELINE=1), or exported
 * from the extension: Options > Import / Export > Export settings and
 * baselines. The fingerprints are the same in both.
 */
import { test, expect } from "@playwright/test";
import path from "node:path";
import type { ScanResult, TolerancePreset } from "../shared/types";
import { describeIssues, loadBaseline, newIssues, scanAtWidths, writeBaseline } from "./ui-check";

const URLS = (process.env.UICHECK_URL ?? "").split(/\s+/).filter(Boolean);
const BASELINE = process.env.UICHECK_BASELINE ?? path.resolve(process.cwd(), "ui-baseline.json");
const UPDATE = process.env.UICHECK_UPDATE_BASELINE === "1";
const WIDTHS = (process.env.UICHECK_WIDTHS ?? "1440").split(",").map((w) => Number(w.trim())).filter((w) => w > 0);
const PRESET = (process.env.UICHECK_PRESET as TolerancePreset | undefined) ?? "normal";
const TOKENS = process.env.UICHECK_TOKENS;

test.describe("UI consistency", () => {
  // Without a page there is nothing to scan: one skipped test says so, and the run still succeeds.
  if (URLS.length === 0) test.skip("set UICHECK_URL to the page to scan", () => undefined);

  // One baseline for every page and width: a finding keeps its fingerprint at every width.
  const scanned: ScanResult[] = [];

  for (const url of URLS) {
    test(`no new issues on ${url}`, async ({ page }) => {
      await page.goto(url, { waitUntil: "load" });
      const baseline = loadBaseline(BASELINE, process.env.UICHECK_ORIGIN);
      const results = await scanAtWidths(page, WIDTHS, { preset: PRESET, ...(TOKENS ? { tokens: TOKENS } : {}) });
      scanned.push(...results.map((r) => r.result));
      if (UPDATE) return;

      const problems = results.map((r) => ({ width: r.width, fresh: newIssues(r.result, baseline) })).filter((r) => r.fresh.length > 0);
      const message = problems.map((r) => describeIssues(r.fresh, `at ${r.width}px`)).join("\n\n");
      expect(problems.reduce((n, r) => n + r.fresh.length, 0), message).toBe(0);
    });
  }

  test.afterAll(() => {
    if (UPDATE && scanned.length > 0) {
      const count = writeBaseline(BASELINE, scanned);
      console.log(`Baseline written to ${BASELINE}: ${count} ${count === 1 ? "issue" : "issues"} accepted.`);
    }
  });
});
