/**
 * Prints the findings of the rules on a page, for tuning and reviewing them.
 * Runs the content modules in a plain Chromium page (no extension). Nothing is
 * sent anywhere: the pages are only opened and read.
 *
 *   node scripts/dump-findings.mjs dashboard-defects dashboard-clean
 *   node scripts/dump-findings.mjs --all                 every fixture, defects and clean
 *   node scripts/dump-findings.mjs https://example.com/
 *   node scripts/dump-findings.mjs --sites scripts/real-sites.txt
 *
 * Options:
 *   --preset strict|normal|relaxed   tolerance preset (default normal)
 *   --max <n>                        print at most n findings per page (default: all)
 *
 * On a fixture, each finding also shows the data-fx name of the element it is
 * in, so it can be matched with the seeded defects.
 */
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { readdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const pages = [];
let preset = "normal";
let max = Infinity;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--all") {
    for (const f of readdirSync("fixtures/src").sort()) {
      const name = f.replace(/\.template\.html$/, "");
      pages.push(`${name}-defects`, `${name}-clean`);
    }
  } else if (args[i] === "--sites") {
    for (const line of readFileSync(args[++i], "utf8").split(/\r?\n/)) {
      const url = line.split("|")[0].trim();
      if (url && !url.startsWith("#")) pages.push(url);
    }
  } else if (args[i] === "--preset") preset = args[++i];
  else if (args[i] === "--max") max = Number(args[++i]);
  else pages.push(args[i]);
}
if (pages.length === 0) {
  console.error("Usage: node scripts/dump-findings.mjs [--all] [--sites file] [--preset p] [--max n] <fixture name or URL>...");
  process.exit(1);
}

const out = await build({
  stdin: {
    contents: `export * from "./snapshot"; export * from "./grouping"; export * from "./rules"; export { RULES } from "@shared/rules";`,
    resolveDir: "src/content",
    loader: "ts",
  },
  bundle: true,
  format: "iife",
  globalName: "UICheckEngine",
  write: false,
  tsconfig: "tsconfig.json",
});

const browser = await chromium.launch();
const summary = [];
for (const name of pages) {
  const remote = /^https?:/.test(name);
  const url = remote ? name : pathToFileURL(`fixtures/${name}.html`).href;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true });
  const page = await context.newPage();
  try {
    const response = await page.goto(url, { waitUntil: "load", timeout: 45_000 });
    if (response && response.status() >= 400) throw new Error(`HTTP ${response.status()}`);
    if (remote) await page.waitForTimeout(2500);
    await page.addScriptTag({ content: out.outputFiles[0].text });
    const result = await page.evaluate((tolerancePreset) => {
      const engine = window.UICheckEngine;
      const snapshot = engine.takeSnapshot(document.body);
      const groups = engine.findPeerGroups(snapshot.elements);
      const started = performance.now();
      const ruleIds = engine.RULES.filter((r) => r.implemented && r.enabled).map((r) => r.id);
      const run = engine.runRules(snapshot.elements, groups, { scope: "page", tolerancePreset, rules: [] }, ruleIds);
      const ms = Math.round(performance.now() - started);
      const describe = (i) => {
        const el = snapshot.nodes[i];
        const cls = typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/)[0].slice(0, 18) : "";
        const text = snapshot.elements[i].text ? ` "${snapshot.elements[i].text.slice(0, 16)}"` : "";
        const fx = el.closest?.("[data-fx]")?.getAttribute("data-fx");
        return `${el.localName}${cls}${text}${fx ? `  <${fx}>` : ""}`;
      };
      const expected = JSON.parse(document.getElementById("expected")?.textContent ?? "[]");
      return {
        ms,
        elements: snapshot.elements.length,
        groups: groups.length,
        expected: expected.map((e) => `${e.id} ${e.rule ?? "-"} <${e.target}>${e.review ? " (review)" : ""}`),
        findings: run.findings.map((f) => `${f.ruleId} ${f.severity.padEnd(6)} ${(f.type === "Review" ? "review" : f.kind).padEnd(10)} ${describe(f.element)}\n        ${f.message}`),
      };
    }, preset);
    console.log(`=== ${name}: ${result.findings.length} findings, ${result.elements} elements, ${result.groups} groups, rules ran in ${result.ms} ms`);
    if (result.expected.length) console.log(`    seeded: ${result.expected.join(" | ")}`);
    console.log(result.findings.slice(0, max).join("\n"));
    summary.push(`ok       ${String(result.findings.length).padStart(4)} findings  ${result.ms} ms  ${name}`);
  } catch (e) {
    const reason = String(e instanceof Error ? e.message : e).split("\n")[0].slice(0, 120);
    console.log(`=== ${name}: SKIPPED (${reason})`);
    summary.push(`skipped  ${reason}  ${name}`);
  }
  await context.close();
}
await browser.close();
if (pages.length > 1) console.log("\n--- Summary ---\n" + summary.join("\n"));
