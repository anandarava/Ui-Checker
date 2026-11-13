/**
 * The Playwright CI package (ci/): the same engine as the extension, with
 * baselines so a build fails only on new issues (PLAN.md, Phase 6).
 */
import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describeIssues, loadBaseline, newIssues, scanAtWidths, scanPage, writeBaseline } from "../../ci/ui-check";
import { fixtureUrl, ROOT } from "./support/engine";

test.use({ viewport: { width: 1440, height: 900 } });

let dir: string;
test.beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "uicheck-ci-"));
});
test.afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Runs the sample test of the package the way a pipeline would. */
function runSample(env: Record<string, string>): { status: number | null; output: string } {
  const cli = path.join(ROOT, "node_modules", "@playwright", "test", "cli.js");
  // The outer test run must not leak its own settings into the inner one.
  const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PW_") && !key.startsWith("PLAYWRIGHT_") && !key.startsWith("TEST_")));
  const run = spawnSync(process.execPath, [cli, "test", "-c", "ci/playwright.config.ts"], { cwd: ROOT, env: { ...clean, ...env }, encoding: "utf8", timeout: 110_000 });
  return { status: run.status, output: `${run.stdout}\n${run.stderr}` };
}

test.describe("CI package", () => {
  test("gives the result the extension gives", async ({ page }) => {
    await page.goto(fixtureUrl("dashboard-defects"));
    const result = await scanPage(page);
    expect(result.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(result.groups.length).toBeGreaterThan(10);
    expect(result.score).toBeLessThan(100);
    expect(result.audit?.lists.map((l) => l.kind)).toContain("fontSize");
    const inset = result.findings.find((f) => f.ruleId === "LAY-06")!;
    expect(inset).toMatchObject({ type: "Definite", status: "new", expected: "20px", actual: "70px" });
    expect(await page.locator(inset.element.selector).count()).toBe(1);
    expect(inset.fingerprint).toMatch(/^[0-9a-f]{8}$/);

    // A second scan of the same page gives the same fingerprints: that is what a baseline rests on.
    const again = await scanPage(page);
    expect(again.findings.map((f) => f.fingerprint)).toEqual(result.findings.map((f) => f.fingerprint));
  });

  test("the defects page has new issues, the clean page has none", async ({ page }) => {
    await page.goto(fixtureUrl("dashboard-defects"));
    const defects = newIssues(await scanPage(page));
    expect(defects.length).toBeGreaterThan(5);
    expect(describeIssues(defects)).toContain("LAY-06 [High]");
    // Findings for review never fail a build.
    expect(defects.every((f) => f.type === "Definite")).toBe(true);

    await page.goto(fixtureUrl("dashboard-clean"));
    expect(newIssues(await scanPage(page))).toEqual([]);
    expect(describeIssues([])).toBe("No new UI consistency issues.");
  });

  test("a baseline accepts the issues of today and reports only what is new", async ({ page }) => {
    await page.goto(fixtureUrl("dashboard-defects"));
    const result = await scanPage(page);
    const file = path.join(dir, "baseline.json");
    const count = writeBaseline(file, result);
    expect(count).toBe(newIssues(result).length);
    expect(newIssues(result, loadBaseline(file))).toEqual([]);

    // A new defect on the baselined page is the only thing reported.
    await page.locator("[data-fx='tile-1']").evaluate((el) => ((el as HTMLElement).style.padding = "30px 10px"));
    const fresh = newIssues(await scanPage(page), loadBaseline(file));
    expect([...new Set(fresh.map((f) => f.ruleId))]).toEqual(["LAY-01"]);
    expect(fresh.length).toBeLessThan(count);

    // A missing file is an empty baseline.
    expect(loadBaseline(path.join(dir, "none.json")).fingerprints.size).toBe(0);
  });

  test("reads the baselines the extension writes", async ({ page }) => {
    await page.goto(fixtureUrl("table-defects"));
    const result = await scanPage(page);
    const [first, second] = newIssues(result);

    // The export of the options page: findings a tester excluded, per site.
    const exported = path.join(dir, "export.json");
    const entry = (fingerprint: string) => ({ fingerprint, ruleId: "X", selector: "x", status: "baselined", reason: "", createdAt: "2026-11-14T00:00:00.000Z" });
    writeFileSync(exported, JSON.stringify({ settings: { tolerancePreset: "strict" }, statuses: { "https://a.example.test": { [first.fingerprint]: entry(first.fingerprint) }, "https://b.example.test": { [second.fingerprint]: entry(second.fingerprint) } } }));
    const all = loadBaseline(exported);
    expect([...all.fingerprints].sort()).toEqual([first.fingerprint, second.fingerprint].sort());
    expect(all.settings).toEqual({ tolerancePreset: "strict" });
    expect([...loadBaseline(exported, "https://a.example.test").fingerprints]).toEqual([first.fingerprint]);

    // A JSON report: every finding in it is accepted. A plain list of fingerprints works too.
    const report = path.join(dir, "report.json");
    writeFileSync(report, JSON.stringify(result));
    expect(newIssues(result, loadBaseline(report))).toEqual([]);
    const list = path.join(dir, "list.json");
    writeFileSync(list, JSON.stringify([first.fingerprint]));
    expect(newIssues(result, loadBaseline(list))).toHaveLength(newIssues(result).length - 1);

    writeFileSync(list, "not json");
    expect(() => loadBaseline(list)).toThrow("is not valid JSON");
  });

  test("scans at several viewport widths and puts the viewport back", async ({ page }) => {
    await page.goto(fixtureUrl("grid-plain-clean"));
    const results = await scanAtWidths(page, [1440, 1024, 768, 375]);
    expect(results.map((r) => r.width)).toEqual([1440, 1024, 768, 375]);
    expect(results.map((r) => r.result.viewport.width)).toEqual([1440, 1024, 768, 375]);
    // Every width is a scan of its own, with the groups found at that width.
    expect(results.every((r) => r.result.groups.length > 0)).toBe(true);
    expect(page.viewportSize()).toEqual({ width: 1440, height: 900 });
  });

  test("checks the design scale against a token file", async ({ page }) => {
    await page.goto(fixtureUrl("dashboard-clean"));
    const result = await scanPage(page, { tokens: path.join(ROOT, "fixtures", "tokens", "dashboard.tokens.json") });
    expect(result.audit?.tokenFile).toBe("dashboard.tokens.json");
    expect(result.audit?.lists.flatMap((l) => l.values.flatMap((v) => v.flags))).toEqual([]);
  });

  test("the sample test fails on the defects fixture and passes on the clean one", async () => {
    test.setTimeout(300_000);
    const baseline = path.join(dir, "sample-baseline.json");

    const clean = runSample({ UICHECK_URL: fixtureUrl("dashboard-clean"), UICHECK_BASELINE: baseline });
    expect(clean.status, clean.output).toBe(0);
    expect(clean.output).toContain("1 passed");

    const defects = runSample({ UICHECK_URL: fixtureUrl("dashboard-defects"), UICHECK_BASELINE: baseline });
    expect(defects.status, defects.output).toBe(1);
    expect(defects.output).toContain("new UI consistency issues at 1440px");
    expect(defects.output).toContain("LAY-06 [High]");

    // Accept today's issues: the same page then passes.
    const update = runSample({ UICHECK_URL: fixtureUrl("dashboard-defects"), UICHECK_BASELINE: baseline, UICHECK_UPDATE_BASELINE: "1" });
    expect(update.status, update.output).toBe(0);
    expect(JSON.parse(readFileSync(baseline, "utf8")).baseline.length).toBeGreaterThan(5);
    const accepted = runSample({ UICHECK_URL: fixtureUrl("dashboard-defects"), UICHECK_BASELINE: baseline });
    expect(accepted.status, accepted.output).toBe(0);

    // Without a page to scan the test skips itself.
    const skipped = runSample({ UICHECK_URL: "" });
    expect(skipped.status, skipped.output).toBe(0);
    expect(skipped.output).toContain("skipped");
  });
});
