/**
 * Prints the peer groups the engine finds on a page, for reviewing Phase 2 by
 * hand. Runs the content modules in a plain Chromium page (no extension).
 * Nothing is sent anywhere: the pages are only opened and read.
 *
 *   node scripts/dump-groups.mjs dashboard-defects table-clean
 *   node scripts/dump-groups.mjs https://example.com/
 *   node scripts/dump-groups.mjs --sites scripts/real-sites.txt --sample 20
 *
 * Options:
 *   --sites <file>   read the pages from a file (one URL per line, "#" comments, text after "|" ignored)
 *   --sample <n>     print only n groups of each page, evenly spread, instead of all
 *   --shots <dir>    save a screenshot of each page with the groups drawn
 *
 * A page that cannot be opened (blocked, offline, timeout) is reported as
 * skipped and does not stop the run.
 */
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const pages = [];
let sample = 0;
let shots = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--sites") {
    for (const line of readFileSync(args[++i], "utf8").split(/\r?\n/)) {
      const url = line.split("|")[0].trim();
      if (url && !url.startsWith("#")) pages.push(url);
    }
  } else if (args[i] === "--sample") sample = Number(args[++i]);
  else if (args[i] === "--shots") shots = args[++i];
  else pages.push(args[i]);
}
if (pages.length === 0) {
  console.error("Usage: node scripts/dump-groups.mjs [--sites file] [--sample n] [--shots dir] <fixture name or URL>...");
  process.exit(1);
}
if (shots) mkdirSync(shots, { recursive: true });

const out = await build({
  stdin: { contents: `export * from "./snapshot"; export * from "./grouping";`, resolveDir: "src/content", loader: "ts" },
  bundle: true,
  format: "iife",
  globalName: "UICheckEngine",
  write: false,
  tsconfig: "tsconfig.json",
});

const browser = await chromium.launch();
const summary = [];
for (const [n, name] of pages.entries()) {
  const remote = /^https?:/.test(name);
  const url = remote ? name : pathToFileURL(`fixtures/${name}.html`).href;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, bypassCSP: true });
  const page = await context.newPage();
  try {
    const response = await page.goto(url, { waitUntil: "load", timeout: 45_000 });
    if (response && response.status() >= 400) throw new Error(`HTTP ${response.status()}`);
    // Client-rendered pages fill in after "load".
    if (remote) await page.waitForTimeout(2500);
    await page.addScriptTag({ content: out.outputFiles[0].text });
    const result = await page.evaluate((draw) => {
      const snapshot = window.UICheckEngine.takeSnapshot(document.body);
      const started = performance.now();
      const groups = window.UICheckEngine.findPeerGroups(snapshot.elements);
      const ms = Math.round(performance.now() - started);
      const describe = (i) => {
        const el = snapshot.nodes[i];
        const data = snapshot.elements[i];
        const cls = typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/)[0].slice(0, 16) : "";
        const text = data.text ? ` "${data.text.slice(0, 14)}"` : "";
        const state = data.state.length ? ` {${data.state.join(",")}}` : "";
        return `${el.localName}${cls}${text}${state} ${Math.round(data.box.width)}x${Math.round(data.box.height)}`;
      };
      if (draw) {
        const colours = ["#d6336c", "#1971c2", "#2f9e44", "#e8590c", "#7048e8", "#0c8599", "#a61e4d", "#5c940d"];
        groups.forEach((g, k) => {
          for (const m of g.members) {
            const b = snapshot.elements[m].box;
            const box = document.createElement("div");
            const c = colours[k % colours.length];
            box.style.cssText = `position:absolute;left:${b.x}px;top:${b.y}px;width:${b.width}px;height:${b.height}px;box-sizing:border-box;border:2px solid ${c};pointer-events:none;z-index:2147483647;font:700 10px/1 sans-serif;color:${c}`;
            box.textContent = String(k);
            document.documentElement.appendChild(box);
          }
        });
      }
      const kinds = {};
      for (const g of groups) kinds[g.kind] = (kinds[g.kind] ?? 0) + 1;
      return {
        ms,
        snapshotMs: Math.round(snapshot.durationMs),
        elements: snapshot.elements.length,
        notScanned: snapshot.notScanned,
        kinds,
        lines: groups.map(
          (g, k) =>
            `g${k} [${g.kind}${g.parent >= 0 ? " of g" + g.parent : ""}] ${g.label}${g.guessedActive >= 0 ? ` (looks active: ${describe(g.guessedActive)})` : ""}\n      ` +
            g.members.slice(0, 6).map(describe).join(" | ") +
            (g.members.length > 6 ? " …" : ""),
        ),
      };
    }, Boolean(shots));
    console.log(`=== ${name}: ${result.lines.length} groups (${JSON.stringify(result.kinds)}), ${result.elements} elements, read in ${result.snapshotMs} ms, grouped in ${result.ms} ms`);
    if (result.notScanned.length) console.log(`    not scanned: ${result.notScanned.join(" ")}`);
    let lines = result.lines;
    if (sample > 0 && lines.length > sample) {
      const step = lines.length / sample;
      lines = Array.from({ length: sample }, (_, k) => lines[Math.floor(k * step)]);
    }
    console.log(lines.join("\n"));
    if (shots) await page.screenshot({ path: path.join(shots, `${String(n + 1).padStart(2, "0")}.png`), fullPage: false });
    summary.push(`ok       ${result.lines.length} groups, ${result.elements} elements, ${result.snapshotMs}+${result.ms} ms  ${name}`);
  } catch (e) {
    const reason = String(e instanceof Error ? e.message : e).split("\n")[0].slice(0, 120);
    console.log(`=== ${name}: SKIPPED (${reason})`);
    summary.push(`skipped  ${reason}  ${name}`);
  }
  await context.close();
}
await browser.close();
if (pages.length > 1) console.log("\n--- Summary ---\n" + summary.join("\n"));
