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
import type { SavedScanMeta, ScanOptions, ScanResult } from "@shared/types";
import { DEFAULT_SITE_SCAN_OPTIONS, type SiteScanState } from "@shared/site-crawl";
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

/**
 * A small made-up application of twenty pages under /site/, for the site scan.
 * Every page has the same header, page title, side navigation and cards.
 * Three pages differ from the others in a part they share, and one page has
 * an inconsistency of its own:
 *   invoices   the page title starts 6px further right
 *   reports    the page title is 32px instead of 28px
 *   settings   the first navigation item shows no label
 *   products   one of its three cards has more padding
 */
const SITE_PAGES = ["home", "orders", "customers", "products", "invoices", "payments", "reports", "settings", "profile", "teams", "projects", "tasks", "calendar", "messages", "documents", "billing", "audit", "integrations", "support", "about"];

function sitePage(name: string): string {
  const title = name.charAt(0).toUpperCase() + name.slice(1);
  const nav = SITE_PAGES.map((p, i) => `<a href="/site/${p}.html"><span class="ic"></span>${name === "settings" && i === 0 ? "" : `<span>${p.charAt(0).toUpperCase() + p.slice(1)}</span>`}</a>`).join("");
  const card = (n: number): string => `<section class="card"${name === "products" && n === 2 ? ' style="padding: 30px 16px"' : ""}><h2>Summary ${n}</h2><p>Made-up text for the ${name} page.</p></section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title} · Example app</title><style>
    * { box-sizing: border-box; } body { margin: 0; font: 15px/1.4 system-ui, sans-serif; color: #1c2b33; background: #f3f4f6; display: flex; }
    nav { width: 200px; flex: none; min-height: 100vh; background: #14315c; padding: 16px 0; }
    nav a { display: flex; align-items: center; gap: 10px; height: 34px; padding: 0 16px; color: #fff; text-decoration: none; font-size: 14px; }
    .ic { width: 16px; height: 16px; flex: none; border-radius: 3px; background: #9fb6d9; }
    .main { flex: 1; min-width: 0; }
    header { height: 64px; background: #fff; display: flex; align-items: center; padding: 0 24px; }
    h1 { margin: 0 0 0 ${name === "invoices" ? 6 : 0}px; font-size: ${name === "reports" ? 32 : 28}px; font-weight: 600; }
    .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; padding: 24px; }
    .card { background: #fff; border: 1px solid #d5d9dc; border-radius: 8px; padding: 16px; } h2 { margin: 0 0 8px; font-size: 18px; } p { margin: 0; }
  </style></head><body><nav aria-label="Main">${nav}</nav><div class="main"><header><h1>${title}</h1></header><div class="cards">${card(1)}${card(2)}${card(3)}</div></div></body></html>`;
}

function serveFixtures(req: IncomingMessage, res: ServerResponse): void {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const site = /^\/site\/([a-z]+)\.html$/.exec(url.pathname);
    if (site && SITE_PAGES.includes(site[1])) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(sitePage(site[1]));
      return;
    }
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

/** `viewport` null lets every window have the size it was opened with, as in a real browser. */
async function launchWithExtension(extensionDir: string, viewport: { width: number; height: number } | null = { width: 1440, height: 900 }): Promise<{ context: BrowserContext; userDataDir: string }> {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "ui-check-profile-"));
  const headed = process.env.UICHECK_E2E_HEADED === "1";
  const args = [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, "--no-first-run", "--no-default-browser-check"];
  try {
    // The "chromium" channel is the full Chromium build, which supports
    // extensions in headless mode (the default headless shell does not).
    const context = await chromium.launchPersistentContext(userDataDir, { channel: "chromium", headless: !headed, args, viewport });
    return { context, userDataDir };
  } catch {
    const context = await chromium.launchPersistentContext(userDataDir, { headless: false, args, viewport });
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

/** Sends a message to the content script of a tab (top frame). */
async function sendToTab<T>(panel: Page, tabId: number, msg: Message): Promise<Response<T>> {
  return panel.evaluate(
    async ({ id, m }) => {
      try {
        const response = (await chrome.tabs.sendMessage(id, m, { frameId: 0 })) as Response<T> | undefined;
        return response ?? { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    { id: tabId, m: msg },
  );
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
    // For review: the two card styles, the navigation item without a label and the two link styles.
    await expect(panel.getByRole("tab", { name: /^Needs review 3$/ })).toBeVisible();
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

  test("the side panel lists the design scale, shows where a value is used and checks it against design tokens", async () => {
    const url = `${baseUrl}/dashboard-defects.html`;
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load" });
    const tabId = await findTabId(helper, url);
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html?tabId=${tabId}`);
    await panel.getByRole("button", { name: "Start scan" }).click();

    // The new rules have their own tab.
    await panel.getByRole("tab", { name: /^Text & content/ }).click();
    await expect(panel.getByRole("tabpanel")).toContainText("Text shortened in different ways");

    await panel.getByRole("tab", { name: /^Design scale/ }).click();
    const scale = panel.getByTestId("design-scale");
    await expect(scale).toContainText("Font sizes (9)");
    await expect(scale).toContainText("Font families (1)");
    await expect(scale).toContainText("load your design tokens under Rules");
    await expect(scale).toContainText("Used once");
    await expect(scale).toContainText("Near-duplicate");
    await shot(panel, "panel-scale");

    // Selecting a value outlines every element that uses it; selecting it again removes the outlines.
    const overlay = page.locator("#ui-consistency-checker-overlay");
    const size = scale.getByRole("button", { name: /^22px/ });
    await expect(overlay).toHaveCount(0);
    await size.click();
    await expect(size).toHaveAttribute("aria-pressed", "true");
    await expect(overlay).toHaveCount(1);
    await shot(page, "page-uses");
    const drawn = await sendToTab<number>(helper, tabId, { type: "CS_SHOW_USES", tabId, kind: "fontSize", value: "22px" });
    expect(drawn.data).toBe(6); // five card titles and the name the defect made 22px
    await size.click();
    await expect(overlay).toHaveCount(0);

    // Design tokens are loaded on the options page.
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/src/options/index.html`);
    const tokens = options.getByRole("region", { name: "Design tokens" });
    await expect(tokens).toContainText("No token file is loaded.");
    await options.getByLabel("Design token file").setInputFiles({ name: "empty.json", mimeType: "application/json", buffer: Buffer.from('{ "radius": { "card": "12px" } }') });
    await expect(options.getByRole("alert")).toContainText("No font, spacing or colour tokens were found");
    await options.getByLabel("Design token file").setInputFiles(path.resolve("fixtures", "tokens", "dashboard.tokens.json"));
    await expect(options.getByTestId("token-summary")).toHaveText("dashboard.tokens.json: 8 colours, 15 spacing values, 9 font sizes, 3 font weights, 1 font family.");

    // The next scan checks the scale against them.
    const checked = (await sendToBackground<ScanResult>(helper, { type: "SCAN_START", tabId, options: SCAN_OPTIONS })).data as ScanResult;
    expect(checked.audit?.tokenFile).toBe("dashboard.tokens.json");
    const off = checked.audit!.lists.flatMap((l) => l.values.filter((v) => v.flags.some((f) => f.kind === "notToken")).map((v) => v.value));
    // The grey of the holiday tiles is not listed: it cannot be told from the page grey, which is a token.
    expect(off).toEqual(["19px", "29px", "39px", "50px", "68px"]);
    await expect(scale).toContainText("Checked against the design tokens of dashboard.tokens.json");
    await expect(scale).toContainText("Not a token");
    await expect(scale).toContainText("typography.card-title.fontSize");
    await expect(panel.getByRole("tab", { name: /^Design scale 5$/ })).toBeVisible();

    // The report has the scale too.
    const report = (await sendToBackground<{ content: string }>(helper, { type: "EXPORT_REPORT", tabId, format: "html" })).data!;
    expect(report.content).toContain("design tokens of <strong>dashboard.tokens.json</strong>");
    expect(report.content).toContain("Not a design token. The closest is space.7 (28px).");

    // Without the tokens the page is judged against itself again.
    await tokens.getByRole("button", { name: "Remove the tokens" }).click();
    await expect(tokens).toContainText("No token file is loaded.");
    const plain = (await sendToBackground<ScanResult>(helper, { type: "SCAN_START", tabId, options: SCAN_OPTIONS })).data as ScanResult;
    expect(plain.audit?.tokenFile).toBeUndefined();

    await options.close();
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

  test("scans part of a page: by selector, and by picking an element on the page", async () => {
    const url = `${baseUrl}/dashboard-defects.html`;
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load" });
    const tabId = await findTabId(helper, url);
    const whole = (await sendToBackground<ScanResult>(helper, { type: "SCAN_START", tabId, options: SCAN_OPTIONS })).data as ScanResult;

    // By selector, through the service worker: only the holidays grid.
    const part = await sendToBackground<ScanResult>(helper, { type: "SCAN_START", tabId, options: { ...SCAN_OPTIONS, scope: "selector", selector: ".holiday-grid" } });
    expect(part.ok, part.error).toBe(true);
    const partial = part.data as ScanResult;
    expect(partial.elementsScanned).toBeLessThan(whole.elementsScanned);
    expect(partial.elementsScanned).toBe(19); // the grid, 6 tiles, 12 texts
    expect(partial.findings.map((x) => x.ruleId)).toEqual(["LAY-03"]);
    const missing = await sendToBackground(helper, { type: "SCAN_START", tabId, options: { ...SCAN_OPTIONS, scope: "selector", selector: "#nope" } });
    expect(missing.ok).toBe(false);
    expect(missing.error).toMatch(/No element matches/);

    // In the panel: choose "Part of page", type a selector, scan.
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html?tabId=${tabId}`);
    await expect(panel.getByRole("button", { name: "Rescan page" })).toBeVisible();
    await panel.getByRole("button", { name: /Scan scope: Full page/ }).click();
    await panel.getByText("Part of page", { exact: true }).click();
    await panel.getByLabel("CSS selector").fill("!!");
    await panel.getByRole("button", { name: "Scan", exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText("is not a valid CSS selector");
    await panel.getByLabel("CSS selector").fill(".holiday-grid");
    await panel.getByRole("button", { name: "Scan", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Rescan part" })).toBeVisible();
    await expect
      .poll(async () => ((await sendToBackground<ScanResult>(helper, { type: "GET_LAST_RESULT", tabId })).data as ScanResult).options.selector)
      .toBe(".holiday-grid");

    // Pick an element on the page: the picker outlines it and the panel scans it.
    await panel.getByRole("button", { name: "Pick an element on the page" }).click();
    await expect(panel.getByRole("button", { name: "Cancel picking" })).toBeVisible();
    await page.bringToFront();
    await page.locator(".event").first().click({ position: { x: 5, y: 5 } });
    await expect
      .poll(async () => ((await sendToBackground<ScanResult>(helper, { type: "GET_LAST_RESULT", tabId })).data as ScanResult).options.selector ?? "")
      .toMatch(/event/);
    const picked = (await sendToBackground<ScanResult>(helper, { type: "GET_LAST_RESULT", tabId })).data as ScanResult;
    expect(await page.locator(picked.options.selector!).count()).toBe(1);
    // The picker took its own drawing off the page, and the click did not reach the page.
    await expect(page.locator("[data-ui-consistency-checker]")).toHaveCount(0);

    await panel.close();
    await page.close();
  });

  test("the options page sets tolerances, the group size and report details, and lists the baselines", async () => {
    const url = `${baseUrl}/dashboard-defects.html`;
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load" });
    const tabId = await findTabId(helper, url);
    const rules = (r: ScanResult) => r.findings.map((x) => x.ruleId);
    const before = (await sendToBackground<ScanResult>(helper, { type: "SCAN_START", tabId, options: SCAN_OPTIONS })).data as ScanResult;
    expect(rules(before)).toContain("LAY-04");

    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/src/options/index.html`);
    for (const heading of ["General", "Rules", "Baselines", "Import / Export", "Privacy"]) {
      await expect(options.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    }

    // A tolerance of 10px for LAY-04: the 4px misalignments are no longer reported.
    await options.getByLabel(/Tolerance of LAY-04/).fill("10");
    await options.getByLabel("Organisation").fill("Example Ltd");
    await options.getByLabel("Prepared by").fill("QA team");
    await expect.poll(async () => (await sendToBackground<{ ruleTolerances: Record<string, number> }>(helper, { type: "GET_SETTINGS" })).data?.ruleTolerances["LAY-04"]).toBe(10);
    const loose = (await sendToBackground<ScanResult>(helper, { type: "SCAN_START", tabId, options: SCAN_OPTIONS })).data as ScanResult;
    expect(rules(loose)).not.toContain("LAY-04");
    expect(loose.options.tolerances).toEqual({ "LAY-04": 10 });
    const report = (await sendToBackground<{ content: string }>(helper, { type: "EXPORT_REPORT", tabId, format: "html" })).data!;
    expect(report.content).toContain("Example Ltd");
    expect(report.content).toContain("QA team");

    // A minimum group size of 3 drops the pairs.
    await options.getByLabel("Minimum group size").fill("3");
    await expect.poll(async () => (await sendToBackground<{ minGroupSize: number }>(helper, { type: "GET_SETTINGS" })).data?.minGroupSize).toBe(3);
    const noPairs = (await sendToBackground<ScanResult>(helper, { type: "SCAN_START", tabId, options: SCAN_OPTIONS })).data as ScanResult;
    expect(noPairs.groups.every((g) => g.members.length >= 3)).toBe(true);

    // An empty tolerance goes back to the preset.
    await options.getByLabel(/Tolerance of LAY-04/).fill("");
    await options.getByLabel("Minimum group size").fill("2");
    await expect.poll(async () => (await sendToBackground<{ ruleTolerances: Record<string, number>; minGroupSize: number }>(helper, { type: "GET_SETTINGS" })).data).toMatchObject({ ruleTolerances: {}, minGroupSize: 2 });
    const again = (await sendToBackground<ScanResult>(helper, { type: "SCAN_START", tabId, options: SCAN_OPTIONS })).data as ScanResult;
    expect(rules(again)).toEqual(rules(before));

    // Baselines: a finding added to the baseline is listed for the site and can be removed.
    const target = again.findings.find((x) => x.ruleId === "LAY-06")!;
    await sendToBackground(helper, { type: "SET_STATUS", tabId, fingerprints: [target.fingerprint], status: "baselined", reason: "Accepted until the redesign" });
    await options.reload();
    const baselines = options.getByRole("region", { name: "Baselines" });
    await expect(baselines).toContainText("LAY-06");
    await expect(baselines).toContainText("Accepted until the redesign");
    await baselines.getByRole("button", { name: /^Remove LAY-06/ }).click();
    await expect(baselines).toContainText("Nothing is excluded on any site.");
    const reopened = (await sendToBackground<ScanResult>(helper, { type: "SCAN_START", tabId, options: SCAN_OPTIONS })).data as ScanResult;
    expect(reopened.findings.find((x) => x.ruleId === "LAY-06")?.status).toBe("new");

    await options.getByLabel("Organisation").fill("");
    await options.getByLabel("Prepared by").fill("");
    await options.close();
    await page.close();
  });

  test("saves a scan, opens it read-only and compares it with the page after a fix", async () => {
    const url = `${baseUrl}/dashboard-defects.html`;
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load" });
    const tabId = await findTabId(helper, url);
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html?tabId=${tabId}`);

    // Saved scans can be opened before anything is scanned.
    await panel.getByRole("button", { name: "Saved Scans" }).click();
    const saved = panel.getByTestId("saved-scans");
    await expect(saved.getByRole("heading", { name: "No saved scans yet" })).toBeVisible();
    await saved.getByRole("button", { name: "Back to results" }).click();

    await panel.getByRole("button", { name: "Start scan" }).click();
    await expect(panel.getByText(/Consistency score \d+ \/ 100/)).toBeVisible();
    const before = (await sendToBackground<ScanResult>(helper, { type: "GET_LAST_RESULT", tabId })).data as ScanResult;

    // Save from the footer: a name is required, and the date is added to it.
    await panel.getByRole("button", { name: "Save scan" }).click();
    await panel.getByRole("button", { name: "Save", exact: true }).click();
    await expect(panel.getByRole("alert")).toHaveText("Enter a name for this scan.");
    await panel.getByPlaceholder("e.g. Checkout page").fill("Before the fix");
    await panel.getByLabel("Include screenshots").uncheck();
    await panel.getByRole("button", { name: "Save", exact: true }).click();
    await expect(saved).toBeVisible();
    await expect(saved).toContainText("Before the fix");
    await expect(saved).toContainText("Tolerance: normal");
    await expect(saved).toContainText(`${before.summary.high} high`);
    const list = (await sendToBackground<SavedScanMeta[]>(helper, { type: "SAVED_SCANS_LIST" })).data!;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ url, score: before.score, issueCount: before.findings.filter((f) => f.type === "Definite").length });
    expect(list[0].name).toMatch(/^Before the fix – /);
    await shot(panel, "panel-saved");

    // Fix one seeded defect on the page and scan again: the holiday grid starts where the other content starts.
    await page.locator("[data-fx='holiday-grid']").evaluate((el) => ((el as HTMLElement).style.margin = "0"));
    await saved.getByRole("button", { name: "Back to results" }).click();
    await panel.getByRole("button", { name: "Rescan page" }).click();
    await expect
      .poll(async () => ((await sendToBackground<ScanResult>(helper, { type: "GET_LAST_RESULT", tabId })).data as ScanResult).findings.some((f) => f.ruleId === "LAY-06"))
      .toBe(false);

    // Compare the saved scan with the current one.
    await panel.getByRole("button", { name: "Saved Scans" }).click();
    await saved.getByRole("checkbox", { name: /^Select "Before the fix/ }).check({ force: true });
    await expect(saved).toContainText("compares with the current scan");
    await saved.getByRole("button", { name: "Compare", exact: true }).click();
    const compare = panel.getByTestId("compare-view");
    await expect(compare.getByRole("heading", { name: "Compare scans" })).toBeVisible();
    await expect(compare).toContainText("Before: Before the fix");
    await expect(compare).toContainText("After: Current scan");
    await expect(compare.getByText(/^Fixed issues \(\d+\)$/)).not.toHaveText("Fixed issues (0)");
    await expect(compare.locator("details", { hasText: "Fixed issues" })).toContainText("Content inset differs between sections");
    await expect(compare.getByText("New issues (0)")).toBeVisible();
    await shot(panel, "panel-compare");
    await compare.getByRole("button", { name: "Back to saved scans" }).click();

    // Open the saved scan: read-only, with a banner, and the live result comes back afterwards.
    await saved.getByRole("button", { name: "Open", exact: true }).click();
    await expect(panel.getByText("Viewing saved scan:")).toBeVisible();
    const rule = panel.getByTestId("issue-list").getByRole("button", { name: /Content inset differs between sections \(1\)/ });
    await rule.click();
    await panel.getByTestId("issue-list").getByRole("button", { name: /Issue number \d+.*holiday-grid/ }).click();
    await expect(panel.getByTestId("issue-detail")).toContainText("This is a saved scan: it is read-only.");
    await expect(panel.getByTestId("issue-detail").getByRole("button", { name: /Ignore/ })).toBeHidden();
    await panel.getByRole("button", { name: "Back to live results" }).click();
    await expect(panel.getByText("Viewing saved scan:")).toHaveCount(0);
    await expect(panel.getByTestId("issue-list").getByRole("button", { name: /Content inset differs between sections/ })).toHaveCount(0);

    // A saved scan exports as a report, and can be renamed and deleted.
    const report = (await sendToBackground<{ filename: string; content: string }>(helper, { type: "SAVED_SCAN_EXPORT", id: list[0].id, format: "html" })).data!;
    expect(report.filename).toMatch(/_UI_Consistency_Report\.html$/);
    expect(report.content).toContain("Content inset differs between sections");
    const renamed = (await sendToBackground<SavedScanMeta>(helper, { type: "SAVED_SCAN_RENAME", id: list[0].id, name: "Sprint 12" })).data!;
    expect(renamed.name).toBe("Sprint 12");
    await sendToBackground(helper, { type: "SAVED_SCAN_DELETE", id: list[0].id });
    expect((await sendToBackground<SavedScanMeta[]>(helper, { type: "SAVED_SCANS_LIST" })).data).toEqual([]);
    expect((await sendToBackground(helper, { type: "SAVED_SCAN_GET", id: list[0].id })).ok).toBe(false);

    await panel.close();
    await page.close();
  });

  test("offers a rescan when a single-page app goes to another route or opens a dialog", async () => {
    const url = `${baseUrl}/dashboard-clean.html`;
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load" });
    const tabId = await findTabId(helper, url);
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html?tabId=${tabId}`);
    await panel.getByRole("button", { name: "Start scan" }).click();
    await expect(panel.getByText(/Consistency score \d+ \/ 100/)).toBeVisible();
    const first = (await sendToBackground<ScanResult>(helper, { type: "GET_LAST_RESULT", tabId })).data as ScanResult;

    // Nothing is said while the page stays as it was scanned, also when the extension draws on it.
    await panel.getByRole("tab", { name: /^Peer groups/ }).click();
    await panel.getByRole("button", { name: "Show all on page" }).click();
    await page.waitForTimeout(1500);
    await expect(panel.getByText("Page changed")).toHaveCount(0);

    // The app goes to another route without loading a page.
    await page.evaluate(() => history.pushState({}, "", "#/orders"));
    await expect(panel.getByText("The page navigated to a new route.")).toBeVisible();
    await panel.getByRole("button", { name: "Dismiss page changed notice" }).click();
    await expect(panel.getByText("Page changed")).toHaveCount(0);

    // A dialog opens: the banner offers a rescan, which scans the page as it is now.
    await page.evaluate(() => {
      const dialog = document.createElement("div");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.style.cssText = "position:fixed; left:200px; top:120px; width:420px; padding:24px; background:#fff; border:1px solid #999";
      dialog.innerHTML = "<h2>Confirm</h2><p>Are you sure?</p><button type='button'>Yes</button><button type='button'>No</button>";
      document.body.appendChild(dialog);
    });
    await expect(panel.getByText("A dialog opened on the page.")).toBeVisible();
    await panel.getByRole("status").filter({ hasText: "Page changed" }).getByRole("button", { name: "Rescan" }).click();
    await expect(panel.getByText("Page changed")).toHaveCount(0);
    await expect
      .poll(async () => ((await sendToBackground<ScanResult>(helper, { type: "GET_LAST_RESULT", tabId })).data as ScanResult).elementsScanned)
      .toBeGreaterThan(first.elementsScanned);

    await panel.close();
    await page.close();
  });

  test("a 20-page site scan finishes, compares the pages and gives one report", async () => {
    test.setTimeout(420_000);
    const site = async (): Promise<SiteScanState | null> => (await sendToBackground<SiteScanState | null>(helper, { type: "SITE_SCAN_GET" })).data ?? null;
    await sendToBackground(helper, { type: "SITE_SCAN_CLEAR" });

    // The panel starts it: the address of the application, then the pages it found.
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html?tabId=0`);
    await panel.getByRole("button", { name: "Site Scan" }).click();
    const view = panel.getByTestId("site-scan");
    await expect(view.getByRole("heading", { name: "Site scan" })).toBeVisible();
    await view.getByLabel("Application address").fill(`${baseUrl}/site/home.html`);
    await view.getByRole("button", { name: /Find pages|Look for pages|Start/ }).first().click();
    await expect.poll(async () => (await site())?.phase, { timeout: 120_000 }).toBe("review");
    const found = (await site())!;
    expect(found.pages.filter((p) => p.include).map((p) => new URL(p.url).pathname).sort()).toEqual(SITE_PAGES.map((p) => `/site/${p}.html`).sort());
    await expect(view).toContainText("20 pages found");
    await shot(panel, "panel-site-review");

    // Scan them: each page is opened in a window of its own and scanned with the normal scan.
    await sendToBackground(helper, { type: "SITE_SCAN_START" });
    await expect.poll(async () => (await site())?.phase, { timeout: 360_000, intervals: [2000] }).toBe("done");
    const done = (await site())!;
    expect(done.pages.filter((p) => p.status === "done")).toHaveLength(20);
    expect(done.pages.every((p) => typeof p.score === "number")).toBe(true);
    // One page has an inconsistency of its own; the others have none.
    const withIssues = done.pages.filter((p) => (p.definite ?? 0) > 0).map((p) => new URL(p.url).pathname);
    expect(withIssues).toEqual(["/site/products.html"]);

    // Across pages: the three pages that differ in a shared part, and nothing else.
    const cross = done.crossPage ?? [];
    const differing = (property: RegExp): string[] => cross.filter((f) => property.test(f.property)).flatMap((f) => f.pages.filter((p) => p.differs).map((p) => new URL(p.url).pathname));
    expect(differing(/^left edge$/)).toEqual(["/site/invoices.html"]);
    expect(differing(/^font size$/)).toEqual(["/site/reports.html"]);
    expect(differing(/^label of item 1/)).toEqual(["/site/settings.html"]);
    const title = cross.find((f) => f.part === "Page title" && f.property === "left edge")!;
    expect(title).toMatchObject({ type: "Definite", severity: "High", expected: "224px" });
    expect(title.message).toBe("Page title left edge is 230px on 1 page; 19 of the 20 pages have 224px.");
    expect(cross.filter((f) => f.type === "Definite").map((f) => `${f.part}: ${f.property}`).sort()).toEqual(
      ['Page title: font size', 'Page title: left edge', 'Side navigation: label of item 1 ("Home")'].sort(),
    );

    // The panel shows the result and the comparison.
    await expect(view).toContainText("20 pages scanned");
    const across = view.getByTestId("across-pages");
    await expect(across).toContainText("3 differences");
    await expect(across).toContainText("Page title: left edge");
    await shot(panel, "panel-site-done");

    // One page, read-only, and back.
    await view.getByRole("button", { name: "View results for /site/products.html" }).click();
    await expect(panel.getByText("Site scan · Products · Example app")).toBeVisible();
    await expect(panel.getByTestId("issue-list")).toContainText("Inner padding differs");
    await panel.getByRole("button", { name: "Back to site scan" }).click();
    await expect(view.getByRole("heading", { name: "Site scan" })).toBeVisible();

    // One report for the whole site.
    const html = (await sendToBackground<{ filename: string; content: string }>(helper, { type: "SITE_SCAN_EXPORT", format: "html" })).data!;
    expect(html.filename).toBe("127.0.0.1_UI_Consistency_Site_Report.html");
    expect(html.content).toContain("20 pages");
    expect(html.content).toContain("Page title: left edge");
    expect(html.content).toContain('id="page-20"');
    const json = JSON.parse((await sendToBackground<{ content: string }>(helper, { type: "SITE_SCAN_EXPORT", format: "json" })).data!.content) as { pageCount: number; crossPage: unknown[]; pages: ScanResult[] };
    expect(json.pageCount).toBe(20);
    expect(json.crossPage.length).toBe(cross.length);
    if (process.env.UICHECK_E2E_SHOTS) {
      const { writeFileSync } = await import("node:fs");
      const file = path.join(process.env.UICHECK_E2E_SHOTS, "site-report.html");
      writeFileSync(file, html.content);
      const report = await context.newPage();
      await report.goto(`file://${file.replace(/\\/g, "/")}`);
      await report.screenshot({ path: path.join(process.env.UICHECK_E2E_SHOTS, "site-report.png") });
      await report.locator("#h-cross").scrollIntoViewIfNeeded();
      await report.screenshot({ path: path.join(process.env.UICHECK_E2E_SHOTS, "site-report-cross.png") });
      await report.close();
    }

    await sendToBackground(helper, { type: "SITE_SCAN_CLEAR" });
    expect(await site()).toBeNull();
    await panel.close();
  });

  test("a site scan runs at the screen width asked for, and saved scans export as one report", async () => {
    test.setTimeout(240_000);
    const site = async (): Promise<SiteScanState | null> => (await sendToBackground<SiteScanState | null>(helper, { type: "SITE_SCAN_GET" })).data ?? null;
    await sendToBackground(helper, { type: "SITE_SCAN_CLEAR" });

    // Two pages, at the width of a tablet. The other tests run with every window forced to 1440px;
    // this part needs a browser whose windows keep their own size.
    const own = await launchWithExtension(DIST, null);
    try {
      const ownWorker = await waitForServiceWorker(own.context);
      const ownHelper = await own.context.newPage();
      await ownHelper.goto(`chrome-extension://${new URL(ownWorker.url()).host}/src/options/index.html`);
      const ownSite = async (): Promise<SiteScanState | null> => (await sendToBackground<SiteScanState | null>(ownHelper, { type: "SITE_SCAN_GET" })).data ?? null;
      await sendToBackground(ownHelper, { type: "SITE_SCAN_DISCOVER", url: `${baseUrl}/site/home.html`, options: { ...DEFAULT_SITE_SCAN_OPTIONS, maxPages: 2, width: 768 } });
      await expect.poll(async () => (await ownSite())?.phase, { timeout: 120_000 }).toBe("review");
      expect((await ownSite())!.pages.filter((p) => p.include)).toHaveLength(2);
      await sendToBackground(ownHelper, { type: "SITE_SCAN_START" });
      await expect.poll(async () => (await ownSite())?.phase, { timeout: 120_000, intervals: [1000] }).toBe("done");
      const done = (await ownSite())!;
      const scanned = done.pages.map((p, index) => ({ p, index })).filter(({ p }) => p.status === "done");
      expect(scanned).toHaveLength(2);
      const results: ScanResult[] = [];
      for (const { index } of scanned) results.push((await sendToBackground<ScanResult>(ownHelper, { type: "SITE_SCAN_RESULT", index })).data!);
      expect(results.map((r) => r.viewport.width)).toEqual([768, 768]);
      // Every page gives the parts it shares with the others.
      expect(results[0].parts?.map((p) => p.key)).toEqual(["pageTitle", "header", "navigation:side:1"]);
    } finally {
      await own.context.close();
      rmSync(own.userDataDir, { recursive: true, force: true });
    }

    // Two saved scans of different pages, ticked together, give one report that compares them.
    const ids: string[] = [];
    for (const name of ["home", "invoices"]) {
      const url = `${baseUrl}/site/${name}.html`;
      const page = await context.newPage();
      await page.goto(url, { waitUntil: "load" });
      const tabId = await findTabId(helper, url);
      await sendToBackground(helper, { type: "SCAN_START", tabId, options: SCAN_OPTIONS });
      ids.push((await sendToBackground<SavedScanMeta>(helper, { type: "SAVED_SCAN_SAVE", tabId, name })).data!.id);
      await page.close();
    }
    const report = (await sendToBackground<{ filename: string; content: string }>(helper, { type: "SAVED_SCANS_EXPORT", ids, format: "html" })).data!;
    expect(report.filename).toBe("127.0.0.1_UI_Consistency_Site_Report.html");
    expect(report.content).toContain("Page title left edge differs between the two pages: 224px and 230px.");

    // The same from the panel: tick both, Export.
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html?tabId=0`);
    await panel.getByRole("button", { name: "Saved Scans" }).first().click();
    const saved = panel.getByTestId("saved-scans");
    await saved.getByText("Select all").click();
    await expect(saved).toContainText("2 of 2 selected");
    const download = panel.waitForEvent("download");
    await saved.getByRole("button", { name: "Export 2 selected scans" }).click();
    await panel.getByRole("menuitem", { name: "HTML report" }).click();
    expect((await download).suggestedFilename()).toBe("127.0.0.1_UI_Consistency_Site_Report.html");

    for (const id of ids) await sendToBackground(helper, { type: "SAVED_SCAN_DELETE", id });
    await panel.close();
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
