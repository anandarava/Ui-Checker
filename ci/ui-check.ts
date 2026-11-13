/**
 * The UI consistency scan for Playwright (PLAN.md, Phase 6): the same engine
 * and the same rule catalogue as the extension, run in a test, with a baseline
 * so a build fails only on new issues.
 *
 *   import { scanPage, loadBaseline, newIssues, describeIssues } from "./ui-check";
 *
 *   test("orders page is consistent", async ({ page }) => {
 *     await page.goto("https://staging.example.test/orders");
 *     const result = await scanPage(page);
 *     const fresh = newIssues(result, loadBaseline("ui-baseline.json"));
 *     expect(fresh, describeIssues(fresh)).toEqual([]);
 *   });
 *
 * The scan is the extension's own `runScan` (src/content/scanner.ts), bundled
 * with esbuild and added to the page, so a finding has the same rule, the same
 * selector and the same fingerprint here and in the extension. A baseline
 * exported from the extension therefore works in CI, and the other way round.
 *
 * Nothing is sent anywhere: the page is read in the browser Playwright drives.
 */
import type { Page } from "@playwright/test";
import { build } from "esbuild";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTokens } from "../shared/tokens";
import type { DesignTokens, Finding, ScanOptions, ScanResult, Settings, StoredStatus, TolerancePreset } from "../shared/types";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface CheckOptions {
  /** Tolerance preset; default "normal". */
  preset?: TolerancePreset;
  /** Scan only this element and what is inside it. */
  selector?: string;
  /** Rule ids to run; default all. */
  rules?: string[];
  /** Rule ids to leave out. */
  disabledRules?: string[];
  /** Smallest peer group that is compared; default 2. */
  minGroupSize?: number;
  /** Tolerances for single rules, by rule id. */
  tolerances?: Record<string, number>;
  /** Design tokens: a parsed token set, or the path of a token file. */
  tokens?: DesignTokens | string;
}

let bundle: Promise<string> | null = null;

/** The scan engine as one script, built once per test run. */
function engineScript(): Promise<string> {
  bundle ??= build({
    stdin: { contents: `export { runScan } from "./scanner";`, resolveDir: path.join(ROOT, "src/content"), loader: "ts" },
    bundle: true,
    format: "iife",
    globalName: "UIConsistencyCheck",
    write: false,
    tsconfig: path.join(ROOT, "tsconfig.json"),
  }).then((out) => out.outputFiles[0].text);
  return bundle;
}

function scanOptions(options: CheckOptions): ScanOptions {
  const tokens = typeof options.tokens === "string" ? parseTokens(readFileSync(options.tokens, "utf8"), path.basename(options.tokens)) : (options.tokens ?? null);
  return {
    scope: options.selector ? "selector" : "page",
    ...(options.selector ? { selector: options.selector } : {}),
    tolerancePreset: options.preset ?? "normal",
    rules: options.rules ?? [],
    ...(options.disabledRules ? { disabledRules: options.disabledRules } : {}),
    ...(options.minGroupSize ? { minGroupSize: options.minGroupSize } : {}),
    ...(options.tolerances ? { tolerances: options.tolerances } : {}),
    tokens,
  };
}

/** Scans the page as it is now and returns the same result the extension gives. */
export async function scanPage(page: Page, options: CheckOptions = {}): Promise<ScanResult> {
  const present = await page.evaluate(() => typeof (window as unknown as { UIConsistencyCheck?: unknown }).UIConsistencyCheck !== "undefined");
  if (!present) await page.addScriptTag({ content: await engineScript() });
  return page.evaluate((scan) => (window as unknown as { UIConsistencyCheck: { runScan(o: ScanOptions): Promise<ScanResult> } }).UIConsistencyCheck.runScan(scan), scanOptions(options));
}

export interface WidthResult {
  /** Viewport width the page was scanned at, in CSS px. */
  width: number;
  result: ScanResult;
}

/**
 * Scans the page at several viewport widths (for example 1440, 1024, 768 and
 * 375). The viewport height is kept; the page gets `settleMs` after each
 * resize to lay itself out again. The viewport is put back afterwards.
 */
export async function scanAtWidths(page: Page, widths: number[], options: CheckOptions = {}, settleMs = 300): Promise<WidthResult[]> {
  const before = page.viewportSize();
  const height = before?.height ?? 900;
  const out: WidthResult[] = [];
  try {
    for (const width of widths) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(settleMs);
      out.push({ width, result: await scanPage(page, options) });
    }
  } finally {
    if (before) await page.setViewportSize(before);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Baselines
// ---------------------------------------------------------------------------

export interface Baseline {
  /** Fingerprints of the findings that are accepted: they do not fail the build. */
  fingerprints: Set<string>;
  /** Settings found in the file (an export of the options page has them). */
  settings?: Partial<Settings>;
}

/** What the options page writes with "Export settings and baselines". */
interface OptionsExport {
  settings?: Partial<Settings>;
  statuses?: Record<string, Record<string, StoredStatus>>;
}

/** What `writeBaseline` writes. */
interface BaselineFile {
  tool?: string;
  writtenAt?: string;
  baseline: Array<string | { fingerprint: string }>;
}

/**
 * Reads a baseline. Accepted files:
 *
 *  1. the file `writeBaseline` writes: `{ baseline: [{ fingerprint, ruleId, selector, message }] }`
 *  2. "Export settings and baselines" of the options page: every finding that was
 *     ignored, baselined or marked intentional, for `origin` or (default) for every site
 *  3. a JSON report of the extension: every finding in it is accepted
 *  4. a plain array of fingerprints
 *
 * A file that does not exist is an empty baseline, so the first run reports everything.
 */
export function loadBaseline(file: string, origin?: string): Baseline {
  if (!existsSync(file)) return { fingerprints: new Set() };
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(`The baseline file ${file} is not valid JSON.`);
  }
  const fingerprints = new Set<string>();
  const add = (entry: unknown): void => {
    if (typeof entry === "string") fingerprints.add(entry);
    else if (entry && typeof entry === "object" && typeof (entry as { fingerprint?: unknown }).fingerprint === "string") fingerprints.add((entry as { fingerprint: string }).fingerprint);
  };

  if (Array.isArray(data)) {
    data.forEach(add);
    return { fingerprints };
  }
  if (!data || typeof data !== "object") throw new Error(`The baseline file ${file} holds no baseline.`);
  const o = data as Partial<BaselineFile> & OptionsExport & { findings?: Finding[] };
  if (Array.isArray(o.baseline)) o.baseline.forEach(add);
  if (o.statuses && typeof o.statuses === "object") {
    for (const [site, entries] of Object.entries(o.statuses)) {
      if (origin && origin !== "*" && site !== origin) continue;
      for (const fingerprint of Object.keys(entries ?? {})) fingerprints.add(fingerprint);
    }
  }
  if (Array.isArray(o.findings)) o.findings.forEach(add);
  return { fingerprints, ...(o.settings ? { settings: o.settings } : {}) };
}

/** Writes the open issues of one or more results as the new baseline. */
export function writeBaseline(file: string, results: ScanResult | ScanResult[]): number {
  const seen = new Set<string>();
  const baseline = [results].flat().flatMap((result) =>
    result.findings
      .filter((f) => f.type === "Definite" && !seen.has(f.fingerprint) && Boolean(seen.add(f.fingerprint)))
      .map((f) => ({ fingerprint: f.fingerprint, ruleId: f.ruleId, selector: f.element.selector, message: f.message })),
  );
  writeFileSync(file, JSON.stringify({ tool: "PalTech UI Consistency Checker", writtenAt: new Date().toISOString(), baseline }, null, 2) + "\n");
  return baseline.length;
}

/**
 * The issues that should fail a build: definite findings that are not in the
 * baseline. Findings listed for review never fail a build.
 */
export function newIssues(result: ScanResult, baseline: Baseline = { fingerprints: new Set() }): Finding[] {
  return result.findings.filter((f) => f.type === "Definite" && f.status === "new" && !baseline.fingerprints.has(f.fingerprint));
}

/** The findings as readable lines, for the message of a failed assertion. */
export function describeIssues(findings: Finding[], label = ""): string {
  if (findings.length === 0) return "No new UI consistency issues.";
  const lines = findings.map((f) => `  ${f.ruleId} [${f.severity}] ${f.element.selector}\n      ${f.message}  (fingerprint ${f.fingerprint})`);
  return `${findings.length} new UI consistency ${findings.length === 1 ? "issue" : "issues"}${label ? ` ${label}` : ""}:\n${lines.join("\n")}`;
}
