/**
 * Runs the scan engine inside a plain Chromium page, without the extension:
 * the content modules are bundled once and added to the page as a script.
 */
import type { Page } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { RawGroup } from "@src/content/grouping";
import type { ElementSnapshot, PageSnapshot } from "@src/content/snapshot";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export type Snap = Omit<PageSnapshot, "nodes"> & {
  /** data-fx or id of an element -> its index in `elements`. */
  named: Record<string, number>;
};

interface Engine {
  takeSnapshot(root: Element): PageSnapshot;
  findPeerGroups(elements: ElementSnapshot[]): RawGroup[];
}

let bundle: Promise<string> | null = null;

function engineScript(): Promise<string> {
  bundle ??= build({
    stdin: { contents: `export * from "./snapshot"; export * from "./grouping";`, resolveDir: path.join(ROOT, "src/content"), loader: "ts" },
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
