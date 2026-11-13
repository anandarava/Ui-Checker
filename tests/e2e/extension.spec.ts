/**
 * End-to-end: load the built extension (dist/) into a persistent Chromium
 * context, serve the fixture pages from a tiny node:http server, and scan them
 * through the service worker from the side panel page.
 *
 * Prerequisite: `npm run build` (the suite skips itself when dist/ is missing).
 *
 * Playwright cannot click the toolbar action, so the side panel page is opened
 * as a normal tab bound to the page under test (`index.html?tabId=N`).
 *
 * Same harness as the PalTech Accessibility Testing extension.
 */
import { test, expect, chromium, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ScanOptions, ScanResult } from "@shared/types";
import type { Message, Response } from "@shared/messages";
import catalogue from "../../shared/ui-rules.json" with { type: "json" };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIST = path.resolve(ROOT, process.env.UICHECK_E2E_DIST ?? "dist");
const FIXTURES = path.join(ROOT, "fixtures");
const HAS_DIST = existsSync(path.join(DIST, "manifest.json"));

const FIXTURE_NAMES = ["dashboard", "table", "compliance", "grid-plain", "grid-utility", "grid-hashed"] as const;
const SCAN_OPTIONS: ScanOptions = { scope: "page", tolerancePreset: "normal", rules: [] };

// ---------------------------------------------------------------------------
// Fixture server (node:http, no dependencies)
// ---------------------------------------------------------------------------

function serveFixtures(req: IncomingMessage, res: ServerResponse): void {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const file = path.resolve(FIXTURES, "." + pathname);
    if (!file.startsWith(FIXTURES + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(readFileSync(file));
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(err instanceof Error ? err.message : String(err));
  }
}

function startServer(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer(serveFixtures);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Fixture server did not bind to a port"));
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

// ---------------------------------------------------------------------------
// Extension launch helpers
// ---------------------------------------------------------------------------

async function launchWithExtension(extensionDir: string): Promise<{ context: BrowserContext; userDataDir: string }> {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "ui-check-profile-"));
  const headed = process.env.UICHECK_E2E_HEADED === "1";
  const args = [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, "--no-first-run", "--no-default-browser-check"];
  try {
    // The "chromium" channel is the full Chromium build, which supports
    // extensions in headless mode (the default headless shell does not).
    const context = await chromium.launchPersistentContext(userDataDir, { channel: "chromium", headless: !headed, args, viewport: { width: 1440, height: 900 } });
    return { context, userDataDir };
  } catch {
    const context = await chromium.launchPersistentContext(userDataDir, { headless: false, args, viewport: { width: 1440, height: 900 } });
    return { context, userDataDir };
  }
}

async function waitForServiceWorker(context: BrowserContext): Promise<Worker> {
  const existing = context.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
  if (existing) return existing;
  return context.waitForEvent("serviceworker", { timeout: 30_000 });
}

// ---------------------------------------------------------------------------
// Messaging helpers (run inside an extension page, which has chrome.* access)
// ---------------------------------------------------------------------------

async function sendToBackground<T>(panel: Page, msg: Message): Promise<Response<T>> {
  return panel.evaluate(async (m) => {
    try {
      const response = (await chrome.runtime.sendMessage(m)) as Response<T> | undefined;
      return response ?? { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, msg);
}

async function findTabId(panel: Page, url: string): Promise<number> {
  const id = await panel.evaluate(async (target) => {
    const tabs = await chrome.tabs.query({ url: target + "*" });
    return tabs.find((t) => typeof t.id === "number")?.id ?? -1;
  }, url);
  if (id < 0) throw new Error(`Could not resolve a tab id for ${url}`);
  return id;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe("extension", () => {
  test.skip(!HAS_DIST, "dist/ is missing: run `npm run build` first");

  let context: BrowserContext;
  let userDataDir: string;
  let server: Server;
  let baseUrl: string;
  let extensionId: string;
  /** An extension page used only to send messages. */
  let helper: Page;

  test.beforeAll(async () => {
    ({ server, baseUrl } = await startServer());
    ({ context, userDataDir } = await launchWithExtension(DIST));
    const worker = await waitForServiceWorker(context);
    extensionId = new URL(worker.url()).host;
    helper = await context.newPage();
    await helper.goto(`chrome-extension://${extensionId}/src/options/index.html`);
  });

  test.afterAll(async () => {
    await context?.close();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
  });

  for (const name of FIXTURE_NAMES) {
    for (const variant of ["defects", "clean"] as const) {
      test(`scans ${name}-${variant} end to end`, async () => {
        const url = `${baseUrl}/${name}-${variant}.html`;
        const page = await context.newPage();
        await page.goto(url, { waitUntil: "load" });
        const tabId = await findTabId(helper, url);

        const res = await sendToBackground<ScanResult>(helper, { type: "SCAN_START", tabId, options: SCAN_OPTIONS });
        expect(res.ok, `SCAN_START was rejected: ${res.error ?? "unknown error"}`).toBe(true);
        const result = res.data as ScanResult;

        expect(result.url).toBe(url);
        expect(result.elementsScanned).toBeGreaterThan(10);
        expect(result.rules.map((r) => r.id)).toEqual(catalogue.rules.map((r) => r.id));

        // Phase 0: no rule is built, so the scan must not claim anything passed or failed.
        const built = new Set(catalogue.rules.filter((r) => r.implemented).map((r) => r.id));
        for (const rule of result.rules) {
          if (!built.has(rule.id)) expect(rule.outcome, rule.id).toBe("notImplemented");
        }
        if (built.size === 0) expect(result.findings).toEqual([]);

        // The service worker keeps the result for the tab.
        const last = await sendToBackground<ScanResult>(helper, { type: "GET_LAST_RESULT", tabId });
        expect(last.data?.scanId).toBe(result.scanId);

        await page.close();
      });
    }
  }

  test("the three card grids measure the same number of elements", async () => {
    const counts: number[] = [];
    for (const name of ["grid-plain", "grid-utility", "grid-hashed"]) {
      const url = `${baseUrl}/${name}-clean.html`;
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "load" });
      const tabId = await findTabId(helper, url);
      const res = await sendToBackground<ScanResult>(helper, { type: "SCAN_START", tabId, options: SCAN_OPTIONS });
      expect(res.ok, res.error).toBe(true);
      counts.push((res.data as ScanResult).elementsScanned);
      await page.close();
    }
    expect(counts[1]).toBe(counts[0]);
    expect(counts[2]).toBe(counts[0]);
  });

  test("the side panel starts a scan and shows the raw result", async () => {
    const url = `${baseUrl}/dashboard-defects.html`;
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load" });
    const tabId = await findTabId(helper, url);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html?tabId=${tabId}`);
    await expect(panel.getByRole("heading", { name: "Scan your page for UI consistency issues" })).toBeVisible();

    await panel.getByRole("button", { name: "Start scan" }).click();

    const results = panel.getByTestId("raw-results");
    await expect(results).toBeVisible();
    await expect(results).toContainText(url);
    await expect(results).toContainText("Elements measured");
    await expect(results).toContainText("No checks are built yet");
    await expect(panel.getByRole("button", { name: "Rescan page" })).toBeVisible();

    // Reset returns to the landing view.
    await panel.getByRole("button", { name: "Reset" }).click();
    await expect(panel.getByRole("button", { name: "Start scan" })).toBeVisible();

    await panel.close();
    await page.close();
  });

  test("a scan returns peer groups that point at elements of the page", async () => {
    const url = `${baseUrl}/dashboard-defects.html`;
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load" });
    const tabId = await findTabId(helper, url);
    const res = await sendToBackground<ScanResult>(helper, { type: "SCAN_START", tabId, options: SCAN_OPTIONS });
    expect(res.ok, res.error).toBe(true);
    const result = res.data as ScanResult;

    expect(result.groups.length).toBeGreaterThan(10);
    expect(new Set(result.groups.map((g) => g.id)).size).toBe(result.groups.length);
    const ids = new Set(result.groups.map((g) => g.id));
    for (const group of result.groups) {
      expect(group.members.length).toBeGreaterThanOrEqual(2);
      if (group.parentGroupId) expect(ids.has(group.parentGroupId)).toBe(true);
      // Every member's selector finds exactly one element.
      for (const member of group.members) expect(await page.locator(member.selector).count(), member.selector).toBe(1);
    }

    // The six holiday tiles are one group, and the selected tab carries its state.
    const tiles = result.groups.find((g) => g.kind === "sibling" && g.members.length === 6);
    expect(tiles?.label).toBe("6 boxes in a grid");
    const tabs = result.groups.find((g) => g.members.some((m) => m.state?.includes("selected")));
    expect(tabs?.members).toHaveLength(3);

    // A higher minimum group size drops the pairs.
    const bigger = await sendToBackground<ScanResult>(helper, { type: "SCAN_START", tabId, options: { ...SCAN_OPTIONS, minGroupSize: 3 } });
    expect((bigger.data as ScanResult).groups.every((g) => g.members.length >= 3)).toBe(true);
    await page.close();
  });

  test("the side panel lists the peer groups and outlines them on the page", async () => {
    const url = `${baseUrl}/dashboard-defects.html`;
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load" });
    const tabId = await findTabId(helper, url);
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html?tabId=${tabId}`);
    await panel.getByRole("button", { name: "Start scan" }).click();

    const list = panel.getByTestId("peer-groups");
    await expect(list).toBeVisible();
    await expect(list).toContainText("6 boxes in a grid");
    const overlay = page.locator("#ui-consistency-checker-overlay");
    await expect(overlay).toHaveCount(0);

    await panel.getByRole("button", { name: "Show all on page" }).click();
    await expect(overlay).toHaveCount(1);
    await expect(panel.getByRole("button", { name: "Hide on page" })).toHaveAttribute("aria-pressed", "true");

    // What the extension draws is never measured: a rescan with the overlay on gives the same result.
    const first = (await sendToBackground<ScanResult>(helper, { type: "GET_LAST_RESULT", tabId })).data as ScanResult;
    const again = (await sendToBackground<ScanResult>(helper, { type: "SCAN_START", tabId, options: SCAN_OPTIONS })).data as ScanResult;
    expect(again.elementsScanned).toBe(first.elementsScanned);
    expect(again.groups.length).toBe(first.groups.length);
    // A new scan removes the old outlines.
    await expect(overlay).toHaveCount(0);

    // One group at a time.
    await list.getByRole("button", { name: /^G\d+ 6 boxes in a grid/ }).click();
    await expect(overlay).toHaveCount(1);
    await list.getByRole("button", { name: /^G\d+ 6 boxes in a grid/ }).click();
    await expect(overlay).toHaveCount(0);

    // Reset removes everything from the page.
    await panel.getByRole("button", { name: "Show all on page" }).click();
    await expect(overlay).toHaveCount(1);
    await panel.getByRole("button", { name: "Reset" }).click();
    await expect(overlay).toHaveCount(0);

    await panel.close();
    await page.close();
  });

  test("a page that cannot be scripted gives a readable error", async () => {
    // An extension cannot read the address of a chrome:// tab, so find it as "the tab that was not there before".
    const tabIds = () => helper.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.id ?? -1));
    const before = new Set(await tabIds());
    const page = await context.newPage();
    await page.goto("chrome://version");
    const tabId = (await tabIds()).find((id) => !before.has(id)) ?? -1;
    expect(tabId).toBeGreaterThan(0);
    const res = await sendToBackground(helper, { type: "SCAN_START", tabId, options: SCAN_OPTIONS });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Cannot access this page/);
    await page.close();
  });

  test("the options page lists every rule of the catalogue", async () => {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/src/options/index.html`);
    for (const rule of catalogue.rules) {
      await expect(options.getByLabel(`${rule.id} · ${rule.name}`)).toBeChecked();
    }
    await options.close();
  });
});
