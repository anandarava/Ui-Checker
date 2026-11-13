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

/** Saves a screenshot when UICHECK_E2E_SHOTS names a folder; used to review the UI by eye. */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.UICHECK_E2E_SHOTS;
  if (dir) await page.screenshot({ path: path.join(dir, `${name}.png`) });
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

        // A rule without a check must not claim anything passed or failed.
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

  test("the side panel shows the score, the issues by rule and one issue in detail", async () => {
    const url = `${baseUrl}/dashboard-defects.html`;
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load" });
    const tabId = await findTabId(helper, url);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html?tabId=${tabId}`);
    await expect(panel.getByRole("heading", { name: "Scan your page for UI consistency issues" })).toBeVisible();
    await panel.getByRole("button", { name: "Start scan" }).click();

    // Summary: the score and the open issues by severity.
    await expect(panel.getByText(/Consistency score \d+ \/ 100/)).toBeVisible();
    const result = (await sendToBackground<ScanResult>(helper, { type: "GET_LAST_RESULT", tabId })).data as ScanResult;
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(100);
    const open = result.findings.filter((f) => f.type === "Definite").length;
    await expect(panel.getByRole("tab", { name: new RegExp(`^All ${open}$`) })).toBeVisible();
    await expect(panel.getByRole("tab", { name: /^Needs review 2$/ })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Rescan page" })).toBeVisible();

    // The list is grouped by rule; a rule expands to its elements.
    const list = panel.getByTestId("issue-list");
    const rule = list.getByRole("button", { name: /Content inset differs between sections \(1\)/ });
    await expect(rule).toHaveAttribute("aria-expanded", "false");
    await rule.click();
    await expect(list).toContainText("Content inset 70px, expected 20px");
    await shot(panel, "panel-list");

    // One issue: what was expected, what was found, the peers, and the element drawn on the page.
    await list.getByRole("button", { name: /Issue number \d+.*holiday-grid/ }).click();
    const detail = panel.getByTestId("issue-detail");
    await expect(detail.getByRole("heading", { name: /Content inset differs between sections/ })).toBeVisible();
    await expect(detail).toContainText("This block starts 70px from the edge of its section");
    await expect(detail.getByText("70px", { exact: true })).toBeVisible();
    await expect(detail.getByText("20px", { exact: true })).toBeVisible();
    await expect(detail).toContainText("Compared with");
    const overlay = page.locator("#ui-consistency-checker-overlay");
    await expect(overlay).toHaveCount(1);
    await shot(panel, "panel-detail");
    await shot(page, "page-redline");

    // Ignoring needs a reason, removes the issue from the totals and raises the score.
    await detail.getByRole("button", { name: "Ignore…" }).click();
    // The reason is required: submitting without one leaves the form open and the issue as it was.
    await detail.getByRole("button", { name: "Ignore", exact: true }).click();
    await expect(detail.getByLabel(/Reason/)).toBeVisible();
    expect(((await sendToBackground<ScanResult>(helper, { type: "GET_LAST_RESULT", tabId })).data as ScanResult).summary.excluded).toBe(0);
    await detail.getByLabel(/Reason/).fill("The grid is centred on purpose");
    await detail.getByRole("button", { name: "Ignore", exact: true }).click();
    await expect(detail.getByText("Ignored.", { exact: false })).toBeVisible();
    const afterIgnore = (await sendToBackground<ScanResult>(helper, { type: "GET_LAST_RESULT", tabId })).data as ScanResult;
    expect(afterIgnore.summary.excluded).toBe(1);
    expect(afterIgnore.score).toBeGreaterThanOrEqual(result.score);
    expect(afterIgnore.rules.find((r) => r.id === "LAY-06")?.outcome).toBe("passed");

    // Back in the list the issue is gone from the open ones, and a rescan keeps the decision.
    await detail.getByRole("button", { name: "Back" }).click();
    await expect(panel.getByRole("tab", { name: new RegExp(`^All ${open - 1}$`) })).toBeVisible();
    await expect(overlay).toHaveCount(0);
    await panel.getByRole("button", { name: "Rescan page" }).click();
    await expect(panel.getByRole("tab", { name: new RegExp(`^All ${open - 1}$`) })).toBeVisible();
    const rescanned = (await sendToBackground<ScanResult>(helper, { type: "GET_LAST_RESULT", tabId })).data as ScanResult;
    const ignored = rescanned.findings.find((f) => f.ruleId === "LAY-06");
    expect(ignored).toMatchObject({ status: "ignored", reason: "The grid is centred on purpose" });

    // Reopen it, so the next tests see the page as scanned.
    const reopened = await sendToBackground<ScanResult>(helper, { type: "SET_STATUS", tabId, fingerprints: [ignored!.fingerprint], status: "new" });
    expect((reopened.data as ScanResult).summary.excluded).toBe(0);

    // Numbered badges on the page; a click on a badge opens the issue in the panel.
    await panel.getByRole("button", { name: /Overlay on the page/ }).click();
    await panel.getByLabel(/Numbered badges/).check();
    await expect(overlay).toHaveCount(1);
    await shot(page, "page-badges");
    await panel.keyboard.press("Escape");

    // Reset returns to the landing view and clears the page.
    await panel.getByRole("button", { name: "Reset" }).click();
    await expect(panel.getByRole("button", { name: "Start scan" })).toBeVisible();
    await expect(overlay).toHaveCount(0);

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

    await panel.getByRole("tab", { name: /^Peer groups/ }).click();
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

  test("exports an HTML and a JSON report, with screenshots of the issues", async () => {
    const url = `${baseUrl}/dashboard-defects.html`;
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load" });
    const tabId = await findTabId(helper, url);
    const scan = await sendToBackground<ScanResult>(helper, { type: "SCAN_START", tabId, options: SCAN_OPTIONS });
    expect(scan.ok, scan.error).toBe(true);
    const result = scan.data as ScanResult;
    interface ReportFile {
      filename: string;
      mime: string;
      content: string;
      captured: number;
      skipped: number;
    }

    const html = (await sendToBackground<ReportFile>(helper, { type: "EXPORT_REPORT", tabId, format: "html" })).data as ReportFile;
    expect(html.filename).toBe("127.0.0.1_UI_Consistency_Report.html");
    expect(html.content).toContain("<title>UI consistency report: Dashboard fixture (defects)</title>");
    expect(html.content).toContain("Content inset differs between sections");
    expect(html.content).toContain("Needs review");
    expect(html.content).not.toContain("<figure");

    const json = (await sendToBackground<ReportFile>(helper, { type: "EXPORT_REPORT", tabId, format: "json" })).data as ReportFile;
    const doc = JSON.parse(json.content) as ScanResult & { tool: { name: string } };
    expect(doc.tool.name).toBe("PalTech UI Consistency Checker");
    expect(doc.scanId).toBe(result.scanId);
    expect(doc.findings).toHaveLength(result.findings.length);

    // Screenshots need the page to be the visible tab.
    await page.bringToFront();
    const shots = (await sendToBackground<ReportFile>(helper, { type: "EXPORT_REPORT", tabId, format: "html", screenshots: true })).data as ReportFile;
    const open = result.findings.filter((f) => f.status === "new").length;
    expect(shots.captured + shots.skipped).toBe(open);
    expect(shots.captured).toBeGreaterThan(0);
    expect((shots.content.match(/<figure class="shot">/g) ?? []).length).toBe(shots.captured);
    // What was drawn for the pictures is removed again.
    await expect(page.locator("#ui-consistency-checker-overlay")).toHaveCount(0);

    // The report opens as a page of its own, with nothing blocked or missing.
    if (process.env.UICHECK_E2E_SHOTS) {
      const { writeFileSync } = await import("node:fs");
      const file = path.join(process.env.UICHECK_E2E_SHOTS, "report.html");
      writeFileSync(file, shots.content);
      const report = await context.newPage();
      await report.goto(`file:///${file.replace(/\\/g, "/")}`);
      await report.setViewportSize({ width: 1200, height: 900 });
      await report.screenshot({ path: path.join(process.env.UICHECK_E2E_SHOTS, "report-summary.png") });
      await report.locator("#rule-lay-06").scrollIntoViewIfNeeded();
      await report.screenshot({ path: path.join(process.env.UICHECK_E2E_SHOTS, "report-details.png") });
      await report.close();
    }
    await page.close();
  });

  test("the side panel has an Export menu", async () => {
    const url = `${baseUrl}/grid-plain-defects.html`;
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load" });
    const tabId = await findTabId(helper, url);
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html?tabId=${tabId}`);
    await panel.getByRole("button", { name: "Start scan" }).click();
    await panel.getByRole("button", { name: "Export report" }).click();
    const download = panel.waitForEvent("download");
    await panel.getByRole("button", { name: /^JSON/ }).click();
    expect((await download).suggestedFilename()).toBe("127.0.0.1_UI_Consistency_Report.json");
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
