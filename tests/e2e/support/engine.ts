/**
 * Runs the scan engine inside a plain Chromium page, without the extension:
 * the content modules are bundled once and added to the page as a script.
 */
import type { Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { RuleDef, ScanOptions, TolerancePreset } from "@shared/types";
import type { DesignTokens, ScaleFlag } from "@shared/types";
import type { RawScaleList } from "@src/content/audit";
import type { RawGroup } from "@src/content/grouping";
import type { RawFinding, RuleRun } from "@src/content/rules";
import type { ElementSnapshot, PageSnapshot } from "@src/content/snapshot";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export type Snap = Omit<PageSnapshot, "nodes"> & {
  /** data-fx or id of an element -> its index in `elements`. */
  named: Record<string, number>;
};

interface Engine {
  takeSnapshot(root: Element): PageSnapshot;
  findPeerGroups(elements: ElementSnapshot[]): RawGroup[];
  runRules(elements: ElementSnapshot[], groups: RawGroup[], options: ScanOptions, ruleIds: string[]): RuleRun;
  buildAudit(elements: ElementSnapshot[], tokens?: DesignTokens | null): RawScaleList[];
  parseTokens(text: string, name: string): DesignTokens;
  RULES: RuleDef[];
}

let bundle: Promise<string> | null = null;

function engineScript(): Promise<string> {
  bundle ??= build({
    stdin: {
      contents: `export * from "./snapshot"; export * from "./grouping"; export * from "./rules"; export * from "./audit"; export { RULES } from "@shared/rules"; export { parseTokens } from "@shared/tokens";`,
      resolveDir: path.join(ROOT, "src/content"),
      loader: "ts",
    },
    bundle: true,
    format: "iife",
    globalName: "UICheckEngine",
    write: false,
    tsconfig: path.join(ROOT, "tsconfig.json"),
  }).then((out) => out.outputFiles[0].text);
  return bundle;
}

export function fixtureUrl(name: string): string {
  return pathToFileURL(path.join(ROOT, "fixtures", `${name}.html`)).href;
}

async function addEngine(page: Page): Promise<void> {
  await page.addScriptTag({ content: await engineScript() });
  await page.evaluate(() => document.fonts.ready);
}

export async function takeSnapshot(page: Page): Promise<Snap> {
  await addEngine(page);
  return page.evaluate(() => {
    const api = (window as unknown as { UICheckEngine: Engine }).UICheckEngine;
    const { nodes, ...data } = api.takeSnapshot(document.body);
    const named: Record<string, number> = {};
    nodes.forEach((el, i) => {
      const name = el.getAttribute("data-fx") ?? el.id;
      if (name && !(name in named)) named[name] = i;
    });
    return { ...data, named };
  });
}

export interface FoundGroups {
  groups: RawGroup[];
  /** For each selector asked for: the snapshot indexes of the elements it matches, sorted. */
  matches: Record<string, number[]>;
  /** Short description of every measured element, for failure messages. */
  names: string[];
  durationMs: number;
}

/** Finds the peer groups of the page and resolves `selectors` to snapshot indexes. */
export async function findGroups(page: Page, selectors: string[] = []): Promise<FoundGroups> {
  await addEngine(page);
  return page.evaluate((wanted) => {
    const api = (window as unknown as { UICheckEngine: Engine }).UICheckEngine;
    const snapshot = api.takeSnapshot(document.body);
    const started = performance.now();
    const groups = api.findPeerGroups(snapshot.elements);
    const durationMs = performance.now() - started;
    const indexOf = new Map(snapshot.nodes.map((el, i) => [el, i]));
    const matches: Record<string, number[]> = {};
    for (const selector of wanted) {
      matches[selector] = Array.from(document.querySelectorAll(selector), (el) => indexOf.get(el) ?? -1).sort((a, b) => a - b);
    }
    const names = snapshot.nodes.map((el) => `${el.localName}${el.className && typeof el.className === "string" ? "." + el.className.split(/\s+/).join(".") : ""}${snapshot.elements[indexOf.get(el)!].text ? ` "${snapshot.elements[indexOf.get(el)!].text.slice(0, 20)}"` : ""}`);
    return { groups, matches, names, durationMs };
  }, selectors);
}

export interface FoundFinding extends RawFinding {
  /** data-fx names of the element the finding points at and of the elements it sits in, nearest first. */
  within: string[];
  /** Short description of the element, for failure messages. */
  name: string;
}

export interface FoundFindings {
  findings: FoundFinding[];
  /** The seeded defects the page lists about itself. */
  expected: Array<{ id: string; rule: string | null; target: string; review?: boolean; both?: boolean }>;
  /** Rule id -> number of groups the rule looked at. */
  checked: Record<string, number>;
  durationMs: number;
}

/** Runs every built rule on the page. */
export async function findFindings(page: Page, preset: TolerancePreset = "normal"): Promise<FoundFindings> {
  await addEngine(page);
  return page.evaluate((tolerancePreset) => {
    const api = (window as unknown as { UICheckEngine: Engine }).UICheckEngine;
    const snapshot = api.takeSnapshot(document.body);
    const groups = api.findPeerGroups(snapshot.elements);
    const started = performance.now();
    const ruleIds = api.RULES.filter((r) => r.implemented && r.enabled).map((r) => r.id);
    const run = api.runRules(snapshot.elements, groups, { scope: "page", tolerancePreset, rules: [] }, ruleIds);
    const durationMs = performance.now() - started;
    const findings = run.findings.map((f) => {
      const el = snapshot.nodes[f.element];
      const within: string[] = [];
      for (let node: Element | null = el; node; node = node.parentElement) {
        const fx = node.getAttribute("data-fx");
        if (fx) within.push(fx);
      }
      const text = snapshot.elements[f.element].text;
      return { ...f, within, name: `${el.localName}${typeof el.className === "string" && el.className ? "." + el.className.split(/\s+/).join(".") : ""}${text ? ` "${text.slice(0, 20)}"` : ""}` };
    });
    const expected = JSON.parse(document.getElementById("expected")?.textContent ?? "[]");
    return { findings, expected, checked: Object.fromEntries(run.checked), durationMs };
  }, preset);
}

export interface AuditValue {
  value: string;
  /** Elements that use the value. */
  count: number;
  flags: ScaleFlag[];
  token?: string;
  detail?: string;
  /** data-fx names of the elements that use the value or that they sit in, sorted. */
  within: string[];
}

export interface AuditList {
  kind: string;
  note?: string;
  values: AuditValue[];
}

/** The design scale of the page, by kind; `tokens` is a token file to check it against. */
export async function findAudit(page: Page, tokens: { name: string; text: string } | null = null): Promise<Record<string, AuditList>> {
  await addEngine(page);
  return page.evaluate((file) => {
    const api = (window as unknown as { UICheckEngine: Engine }).UICheckEngine;
    const snapshot = api.takeSnapshot(document.body);
    const lists = api.buildAudit(snapshot.elements, file ? api.parseTokens(file.text, file.name) : null);
    const out: Record<string, AuditList> = {};
    for (const list of lists) {
      out[list.kind] = {
        kind: list.kind,
        ...(list.note ? { note: list.note } : {}),
        values: list.values.map((v) => {
          const within = new Set<string>();
          for (const i of v.elements) {
            for (let node: Element | null = snapshot.nodes[i]; node; node = node.parentElement) {
              const fx = node.getAttribute("data-fx");
              if (fx) within.add(fx);
            }
          }
          return { value: v.value, count: v.elements.length, flags: v.flags, ...(v.token ? { token: v.token } : {}), ...(v.detail ? { detail: v.detail } : {}), within: [...within].sort() };
        }),
      };
    }
    return out;
  }, tokens);
}
