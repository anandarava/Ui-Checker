/**
 * Site scan: find the pages of a web application and scan them one after another.
 *
 * 1. Discover (SITE_SCAN_DISCOVER): robots.txt / sitemap.xml, then the links of the
 *    start page and the pages it links to, fetched with the tester's cookies (so pages
 *    behind a login are found while the tester is signed in). Ends in "review": the
 *    panel lists the pages, ticked by `choosePages`, for the tester to adjust.
 * 2. Scan (SITE_SCAN_START): a window of its own is opened and each ticked page is
 *    loaded in it and scanned with the normal scan. Links the rendered page shows (menus
 *    built by script, single-page-app routes) are added to the list as it goes.
 *    Pause / Stop take effect between pages.
 *
 * The state is kept in chrome.storage.local, each page's full result under its own key,
 * so the panel can be closed and a restarted service worker finds the run (paused).
 *
 * When a run ends the scanned pages are compared with each other in the parts they
 * share (shared/cross-page.ts).
 *
 * Copied from the PalTech Accessibility Testing extension; what differs is the scan
 * it calls and the cross-page comparison.
 */
import { crossPageFindings } from "@shared/cross-page";
import type { ExportFormat, ScanOptions, ScanResult } from "@shared/types";
import type { Message } from "@shared/messages";
import {
  SLOW_RULE_IDS,
  choosePages,
  extractLinks,
  isExcluded,
  isWithin,
  makePage,
  normalizeUrl,
  parseSitemap,
  rankPages,
  robotsSitemaps,
  sameOrigin,
  samePage,
  hashRoute,
  similarKey,
  parallelWindows,
  runPool,
  WorkerGone,
  templateKey,
  NAV_SELECTOR,
  MENU_WORDS,
  extractLinkInfo,
  type LinkInfo,
  type SitePage,
  type SiteScanOptions,
  type SiteScanState,
} from "@shared/site-crawl";

export interface SiteScanDeps {
  /** The normal page scan (service-worker startScan). */
  scan(tabId: number, options: ScanOptions): Promise<ScanResult>;
  /** Scan options from the current settings. */
  scanOptions(): Promise<ScanOptions>;
  /** Screenshot every failed element of a scanned page (the tab must be visible); the result with them. */
  photograph(tabId: number, result: ScanResult): Promise<ScanResult>;
  /** Build one report for several results; the panel saves the file. */
  exportResults(format: ExportFormat, results: ScanResult[]): Promise<{ filename: string; mime: string; content: string }>;
  broadcast(msg: Message): void;
  keepAlive(): () => void;
}

const STATE_KEY = "siteScan:state";
const resultKey = (id: string, index: number) => `siteScan:result:${id}:${index}`;
/** Page load limit and the pause after load for scripts to render. */
const LOAD_TIMEOUT_MS = 45_000;
const SETTLE_MS = 2_500;
const FETCH_TIMEOUT_MS = 15_000;
const FETCH_CONCURRENCY = 4;
const MAX_SITEMAPS = 6;
/** Most pages opened in the scan window during discovery of a script-built app. */
const MAX_RENDERED_DISCOVERY = 60;
/** Most pages taken from sitemaps (large sites list tens of thousands). */
const MAX_SITEMAP_PAGES = 5000;

let deps: SiteScanDeps | null = null;
let state: SiteScanState | null = null;
let loaded: Promise<void> | null = null;
/** Set by Pause / Stop; the loops check it between steps. */
let control: "run" | "pause" | "stop" = "run";
/** Read `control` afresh (it changes while a loop awaits; TypeScript would keep a narrowed value). */
const requested = (): "run" | "pause" | "stop" => control;
let running = false;
let workerWindowId: number | null = null;
let workerTabId: number | null = null;
/** Extra scan windows that read pages alongside the main one while finding pages (`parallel`). */
let helpers: { windowId: number; tabId: number }[] = [];
/** Named content pages listed per folder before further ones are only counted. */
const NAMED_PER_FOLDER = 3;
/** A rescan's pages: the run scans only these, not other pages still waiting. */
let onlyIndexes: Set<number> | null = null;
/** Detail pages and repeat views left out of the list, each address once. */
let leftOut = new Set<string>();
/** Content links already counted towards an example page (navigation-only discovery), with that page. */
let countedContent = new Map<string, string>();
/** The pages each content link was seen on: a link repeated on several pages is part of the site's menu. */
let seenOn = new Map<string, Set<string>>();
/** A content link seen on this many different pages counts as a menu link, whatever its HTML. */
const MENU_REPEAT_PAGES = 2;

export function initSiteScan(d: SiteScanDeps): void {
  deps = d;
  void load();
  chrome.windows.onRemoved.addListener((id) => {
    // A helper window closed by the tester: its worker leaves the pool, the others go on.
    helpers = helpers.filter((h) => h.windowId !== id);
    if (id !== workerWindowId) return;
    workerWindowId = null;
    workerTabId = null;
    if (running) control = "pause";
  });
}

function load(): Promise<void> {
  loaded ??= chrome.storage.local.get(STATE_KEY).then((r) => {
    const s = r[STATE_KEY] as SiteScanState | undefined;
    if (!s) return;
    // A run cut off by a service-worker restart: keep what was done and let the tester resume.
    if (s.phase === "scanning") {
      s.phase = "paused";
      s.message = "The scan was interrupted. Resume to scan the remaining pages.";
      for (const p of s.pages) if (p.status === "scanning") p.status = "pending";
    } else if (s.phase === "discovering") {
      s.phase = "review";
      s.message = "Page discovery was interrupted; the list may be incomplete.";
    }
    state = s;
  });
  return loaded;
}

async function save(): Promise<void> {
  if (state) await chrome.storage.local.set({ [STATE_KEY]: state });
  deps?.broadcast({ type: "SITE_SCAN_STATE", state });
}

function update(patch: Partial<SiteScanState>): Promise<void> {
  if (!state) return Promise.resolve();
  state = { ...state, ...patch };
  return save();
}

async function clearStored(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k === STATE_KEY || k.startsWith("siteScan:result:"));
  if (keys.length) await chrome.storage.local.remove(keys);
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

async function fetchText(url: string, accept: string): Promise<{ text: string; finalUrl: string; type: string } | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { credentials: "include", redirect: "follow", signal: ctrl.signal, headers: { Accept: accept } });
    if (!res.ok) return null;
    return { text: await res.text(), finalUrl: res.url || url, type: res.headers.get("content-type") ?? "" };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Page addresses from robots.txt Sitemap: lines and /sitemap.xml (following sitemap indexes). */
async function sitemapPages(origin: string): Promise<string[]> {
  const queue: string[] = [];
  const robots = await fetchText(`${origin}/robots.txt`, "text/plain");
  if (robots) queue.push(...robotsSitemaps(robots.text));
  if (queue.length === 0) queue.push(`${origin}/sitemap.xml`);
  const seen = new Set<string>();
  const pages: string[] = [];
  while (queue.length && seen.size < MAX_SITEMAPS && control === "run") {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    const res = await fetchText(url, "application/xml,text/xml");
    if (!res || !/<(urlset|sitemapindex)\b/i.test(res.text)) continue;
    const parsed = parseSitemap(res.text);
    pages.push(...parsed.pages);
    queue.push(...parsed.sitemaps);
  }
  return pages;
}

/**
 * A link's page address. A "#/…" link counts as a page of a hash-routed app only on the app's own
 * page (the start page's address without its hash); elsewhere it is a section of one page (an API
 * reference's #/Account), so the page itself is listed.
 */
function pageAddress(url: string): string | null {
  const n = normalizeUrl(url);
  if (!n || !state || !hashRoute(n)) return n;
  const base = (u: string | undefined) => (u ?? "").split("#")[0].toLowerCase();
  const apps = [state.startUrl, state.pages[0]?.finalUrl].map(base);
  return apps.includes(base(n)) ? n : n.split("#")[0];
}

/** List a page; returns its address when it was newly listed (or upgraded to a linked page), else null. */
function addPage(url: string, depth: number, source: SitePage["source"], inMenu = false): string | null {
  if (!state) return null;
  const n = source === "start" || source === "manual" ? normalizeUrl(url) : pageAddress(url);
  if (!n || !sameOrigin(n, state.origin)) return null;
  const existing = state.pages.findIndex((p) => samePage(p.url, n) || samePage(p.finalUrl, n));
  if (existing >= 0) {
    // A sitemap page the site also links to is a menu page: rank it as linked.
    const p = state.pages[existing];
    if (p.source === "sitemap" && source === "link" && p.status === "pending") {
      state.pages[existing] = { ...p, source: "link", depth: Math.min(p.depth, depth) };
      state.found.sitemap--;
      state.found.links++;
      return n;
    }
    return null;
  }
  if (source !== "manual" && source !== "start" && (isExcluded(n, state.options.exclude) || !isWithin(n, state.options.within))) {
    state.found.excluded++;
    return null;
  }
  if (source !== "manual" && source !== "start") {
    // One row per screen. A detail page (an id in the address: /products/1, /Event/EventDetails/226492)
    // is left out, so the list keeps the screens themselves (/products); so is another view of a
    // listed screen (/Report/Status?status=3 when /Report/Status is listed). Both can be added by hand.
    // A menu link with an id (/PreClear/RuleTypes/1, /p/download-files_25.html) is how the menu
    // reaches that screen, so the first of its kind is listed as the example to scan.
    const template = templateKey(n);
    const kindListed = state.pages.some((p) => templateKey(p.url) === template);
    // Pages of a list (/page/2, /catalogue/page-2.html) are not another screen, even from a <nav>.
    const listPage = /\/page[-_/]?\d+(\.[a-z]+)?$/i.test(new URL(n).pathname);
    if (kindListed || (template.includes("*") && (!inMenu || listPage))) {
      leftOut.add(n.toLowerCase());
      state.found.details = leftOut.size;
      return null;
    }
    if (leftOut.delete(n.toLowerCase())) state.found.details = leftOut.size;
  }
  state.pages.push(makePage(n, depth, source));
  if (source === "sitemap") state.found.sitemap++;
  if (source === "link") state.found.links++;
  return n;
}

/**
 * Add a link found on a page. Navigation links (and every link when `allLinks` is on) are listed;
 * a content link is listed only when it is the first of its kind, otherwise it is counted on the
 * example page already listed. Returns true when a page was listed.
 */
function addLink(link: LinkInfo, depth: number, from: string): string | null {
  if (!state) return null;
  // Only a link in a recognised menu (not one assumed to be) lists an example of an id-style page.
  if (link.nav || state.options.allLinks) return addPage(link.url, depth, "link", link.nav && !link.assumed);
  const n = pageAddress(link.url);
  if (!n || !sameOrigin(n, state.origin)) return null;
  if (state.pages.some((p) => samePage(p.url, n) || samePage(p.finalUrl, n))) return null;
  // A link on several pages is a menu link, however the menu is built (a <div class="x7k-panel">):
  // list it, and take it off the example page it was counted on.
  const pages = seenOn.get(n) ?? new Set<string>();
  pages.add(from.toLowerCase());
  seenOn.set(n, pages);
  if (pages.size >= MENU_REPEAT_PAGES) {
    const example = countedContent.get(n);
    countedContent.delete(n);
    const i = example ? state.pages.findIndex((p) => p.url === example) : -1;
    if (i >= 0 && state.pages[i].similar) state.pages[i] = { ...state.pages[i], similar: state.pages[i].similar! - 1 || undefined };
    return addPage(n, depth, "link");
  }
  // Addresses that differ only by an id (/product/123) are copies: one example. Named pages in a
  // shared folder (/auth/login, /auth/register) are usually different screens: up to
  // NAMED_PER_FOLDER of them, which still stops a grid of name-style products (/products/blue-shirt).
  const within = state.options.within;
  const template = templateKey(n);
  const byId = template.includes("*");
  const key = byId ? template : similarKey(n, within);
  if (!byId && key === template) return addPage(n, depth, "link"); // a top-level page: its own kind
  const sameKind = (p: SitePage) => (byId ? templateKey(p.url) === key : similarKey(p.url, within) === key);
  const listed = state.pages.filter(sameKind).length;
  if (listed < (byId ? 1 : NAMED_PER_FOLDER)) return addPage(n, depth, "link");
  const example = state.pages.findIndex(sameKind);
  if (!countedContent.has(n)) {
    countedContent.set(n, state.pages[example].url);
    state.pages[example] = { ...state.pages[example], similar: (state.pages[example].similar ?? 0) + 1 };
  }
  return null;
}

/** A page's links as followed: when it has no navigation at all, every link counts as navigation. */
function asFollowed(links: LinkInfo[]): LinkInfo[] {
  return links.some((l) => l.nav) ? links : links.map((l) => ({ ...l, nav: true, assumed: true }));
}

/** How many candidate pages discovery collects before it stops looking. */
function candidateCap(o: SiteScanOptions): number {
  return Math.min(1000, Math.max(100, o.maxPages * 4));
}

/** Validate and set up a new discovery; returns the new state at once, the work goes on in `discover`. */
function beginDiscovery(startUrl: string, options: SiteScanOptions): SiteScanState {
  const start = normalizeUrl(startUrl);
  if (!start) throw new Error("Enter a web address starting with http:// or https://.");
  if (running) throw new Error("A site scan is already running. Stop it first.");
  control = "run";
  running = true;
  countedContent = new Map();
  seenOn = new Map();
  leftOut = new Set();
  state = {
    id: `site_${Date.now().toString(36)}`,
    startUrl: start,
    origin: new URL(start).origin,
    options,
    phase: "discovering",
    pages: [makePage(start, 0, "start")],
    found: { sitemap: 0, links: 0, excluded: 0 },
    message: "Looking for pages…",
  };
  return state;
}

async function discover(): Promise<void> {
  if (!state) return;
  const { startUrl: start, origin, options } = state;
  await closeWorker();
  await clearStored();
  await save();
  const stopKeepAlive = deps!.keepAlive();
  try {
    if (options.useSitemap) {
      await update({ message: "Reading the sitemap…" });
      for (const url of (await sitemapPages(origin)).slice(0, MAX_SITEMAP_PAGES)) addPage(url, 1, "sitemap");
    }
    // Follow links breadth-first until the depth, or the cap on link-found pages (counted apart from
    // the sitemap's, so a big sitemap does not stop the start page's menus being read).
    const cap = candidateCap(options);
    const sameSite = (links: LinkInfo[]) => new Set(links.map((l) => normalizeUrl(l.url)).filter((u): u is string => !!u && sameOrigin(u, origin)));

    // Read the start page twice: its raw HTML and the rendered page. When the rendered page shows
    // many more links than the HTML, the site builds its pages with script (a single-page app such
    // as an Angular or React application): every page is then read rendered, in the scan window,
    // because their HTML is an empty shell.
    await update({ message: "Opening the start page…" });
    const startHtml = await fetchText(start, "text/html");
    const htmlLinks = startHtml && /html/i.test(startHtml.type) ? extractLinkInfo(startHtml.text, startHtml.finalUrl) : [];
    let tabId: number | null = null;
    let renderedStart: LinkInfo[] = [];
    try {
      tabId = await ensureWorker(start);
      const final = await navigate(tabId, start, true);
      if (!sameOrigin(final, origin)) {
        state.message = `The start page went to ${final}. Sign in to the application in this browser, then find pages again.`;
      } else {
        await new Promise((r) => setTimeout(r, SETTLE_MS));
        renderedStart = await renderedLinks(tabId);
      }
    } catch {
      tabId = null; // read with fetch only
    }
    const renderedCount = sameSite(renderedStart).size;
    const scripted = tabId !== null && renderedCount >= 3 && renderedCount > sameSite(htmlLinks).size * 2;
    let rendered = 0;

    /** Same-site links of one page, rendered in a scan window (`tab`) or from its HTML. */
    const linksOf = async (url: string, tab: number | null): Promise<LinkInfo[]> => {
      if (scripted && tab !== null && rendered < MAX_RENDERED_DISCOVERY) {
        rendered++;
        const tabId = tab;
        try {
          await navigate(tabId, url, false);
          await new Promise((r) => setTimeout(r, SETTLE_MS));
          // Read the address after the pause: script redirects happen after the load.
          const final = await currentUrl(tabId, url);
          if (!sameOrigin(final, origin)) return [];
          // A route that only redirects (/me -> /me/time-sheet) is the same screen as where it lands:
          // list the landing page and leave the redirecting address out, so the screen is scanned once.
          const landed = normalizeUrl(final);
          if (landed && landed !== url) {
            addPage(landed, state!.pages.find((p) => p.url === url)?.depth ?? 1, "link");
            const i = state!.pages.findIndex((p) => p.url === url && p.status === "pending");
            if (i >= 0) state!.pages[i] = { ...state!.pages[i], status: "skipped", include: false, error: `Redirects to ${landed.replace(origin, "")}` };
          }
          return renderedLinks(tabId);
        } catch {
          // The window was closed: this worker stops and another one reads the page.
          if (!(await tabExists(tabId))) {
            rendered--;
            throw new WorkerGone();
          }
          return [];
        }
      }
      const res = await fetchText(url, "text/html");
      return res && /html/i.test(res.type) && sameOrigin(res.finalUrl, origin) ? extractLinkInfo(res.text, res.finalUrl) : [];
    };

    try {
      const read = new Set<string>([start]);
      // Pages of one template (/product/123, /product/456) share their menus: open only as many
      // of them as will be scanned ("Similar pages"); the others stay listed, unopened.
      const readPerTemplate = new Map<string, number>();
      const perTemplate = options.perTemplate > 0 ? options.perTemplate : Infinity;
      const worthReading = (u: string): boolean => {
        const t = templateKey(u);
        const n = readPerTemplate.get(t) ?? 0;
        if (n >= perTemplate) return false;
        readPerTemplate.set(t, n + 1);
        return true;
      };
      let level: string[] = [];
      for (const link of [...asFollowed(renderedStart), ...asFollowed(htmlLinks)]) {
        const added = addLink(link, 1, start);
        if (added) level.push(added);
      }
      // Readers: a script-built app's pages are opened in scan windows, `parallel` of them at a
      // time (the main one plus helpers); other sites' HTML is fetched, a few at a time.
      let readers: (number | null)[] = Array.from({ length: FETCH_CONCURRENCY }, () => null);
      if (scripted && tabId !== null) {
        await openHelpers(parallelWindows(options) - 1, start);
        readers = [tabId, ...helpers.map((h) => h.tabId)];
      }
      for (let depth = 1; depth < options.maxDepth && level.length && control === "run"; depth++) {
        const next: string[] = [];
        await runPool(
          level,
          readers,
          (u) => {
            if (state!.found.links >= cap || requested() !== "run") return "stop";
            if (read.has(u) || !worthReading(u)) return false;
            read.add(u);
            void update({ message: `${scripted ? "Opening pages of the app" : "Following links"}: ${read.size} pages read, ${state!.pages.length} found` });
            return true;
          },
          linksOf,
          (u, links) => {
            for (const link of asFollowed(links)) {
              if (state!.found.links >= cap) break;
              const added = addLink(link, depth + 1, u);
              if (added) next.push(added);
            }
          },
        );
        level = next;
      }
    } finally {
      await closeHelpers();
      await closeWorker();
    }
    state.pages = choosePages(rankPages(state.pages), options);
    const stopped = control !== "run";
    await update({
      phase: "review",
      message: stopped ? "Discovery stopped; the list may be incomplete." : state.message?.startsWith("The start page went") ? state.message : undefined,
    });
  } finally {
    running = false;
    control = "run";
    stopKeepAlive();
  }
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

/** Width of the page area of the scan window when none is asked for. */
const DEFAULT_WIDTH = 1280;

/**
 * Makes the page area of the scan window as wide as asked for: the window is
 * wider than its page by its frame and scrollbar, so the page is measured and
 * the window resized by the difference. A browser that cannot make a window
 * that narrow leaves it wider; every result says the width it was scanned at.
 */
async function fitWidth(tabId: number, wanted: number): Promise<void> {
  if (workerWindowId === null) return;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: () => window.innerWidth });
      const inner = typeof res?.result === "number" ? res.result : wanted;
      if (Math.abs(inner - wanted) <= 1) return;
      const win = await chrome.windows.get(workerWindowId);
      if (typeof win.width !== "number") return;
      await chrome.windows.update(workerWindowId, { width: Math.max(100, win.width + wanted - inner) });
      await new Promise((r) => setTimeout(r, 300));
    }
  } catch {
    /* the page cannot be scripted, or the window is gone: scan at the width it has */
  }
}

async function ensureWorker(url: string): Promise<number> {
  if (workerTabId !== null) {
    try {
      await chrome.tabs.get(workerTabId);
      return workerTabId;
    } catch {
      workerTabId = null;
    }
  }
  // A normal window of its own: pages in a background tab are throttled (timers, animation
  // frames), which the focus checks depend on. The tester can keep working in their window.
  const win = await chrome.windows.create({ url, focused: true, type: "normal", width: state?.options.width ?? DEFAULT_WIDTH, height: 900 });
  const tab = win?.tabs?.[0];
  if (!win?.id || tab?.id === undefined) throw new Error("Could not open a window for the site scan.");
  workerWindowId = win.id;
  workerTabId = tab.id;
  return tab.id;
}

/** Open `count` extra scan windows for finding pages. */
async function openHelpers(count: number, url: string): Promise<void> {
  for (let k = 0; k < count; k++) {
    try {
      // Not focused: the main scan window keeps the focus; each helper is a window of its own
      // because pages in background tabs are throttled. Chrome staggers new windows itself.
      const win = await chrome.windows.create({ url: "about:blank", focused: false, type: "normal", width: 1100, height: 800 });
      const tab = win?.tabs?.[0];
      if (win?.id !== undefined && tab?.id !== undefined) helpers.push({ windowId: win.id, tabId: tab.id });
    } catch {
      break; // fewer windows: still works, only slower
    }
  }
}

async function closeHelpers(): Promise<void> {
  const ids = helpers.map((h) => h.windowId);
  helpers = [];
  await Promise.all(ids.map((id) => chrome.windows.remove(id).catch(() => undefined)));
}

async function tabExists(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch {
    return false;
  }
}

async function closeWorker(): Promise<void> {
  const id = workerWindowId;
  workerWindowId = null;
  workerTabId = null;
  if (id !== null) await chrome.windows.remove(id).catch(() => undefined);
}

/** Load `url` in the tab and wait for it to finish (or the time limit); returns the final address. */
function navigate(tabId: number, url: string, alreadyThere: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      fn();
    };
    const finalUrl = () =>
      chrome.tabs.get(tabId).then(
        (t) => t.url ?? url,
        () => url,
      );
    /**
     * For a hash-route change the hash update itself may report "complete"; only the reload's
     * completion counts, recognised by the "loading" that follows the reload request.
     */
    let armed = true;
    let reloadRequested = false;
    const onUpdated = (id: number, info: { status?: string }) => {
      if (id !== tabId) return;
      if (!armed && reloadRequested && info.status === "loading") armed = true;
      if (armed && info.status === "complete") finish(() => void finalUrl().then(resolve));
    };
    const timer = setTimeout(() => finish(() => void finalUrl().then(resolve)), LOAD_TIMEOUT_MS);
    chrome.tabs.onUpdated.addListener(onUpdated);
    if (alreadyThere) {
      // The new window is already loading this page.
      void chrome.tabs.get(tabId).then(
        (t) => {
          if (t.status === "complete") finish(() => resolve(t.url ?? url));
        },
        (e) => finish(() => reject(e)),
      );
    } else {
      void (async () => {
        // Moving to another hash route of the same document loads nothing: reload so every route
        // gets a fresh page, as a tester opening that address would.
        const before = await currentUrl(tabId, "");
        const sameDocument = before !== "" && before.split("#")[0] === url.split("#")[0];
        if (sameDocument) armed = false;
        await chrome.tabs.update(tabId, { url });
        if (sameDocument) {
          // Reload only once the tab shows the new route: a reload issued earlier reloads the old one.
          for (let i = 0; i < 30 && (await currentUrl(tabId, "")) !== url; i++) await new Promise((r) => setTimeout(r, 100));
          reloadRequested = true;
          await chrome.tabs.reload(tabId);
        }
      })().catch((e) => finish(() => reject(e)));
    }
  });
}

/** The tab's address now (a single-page app may have moved on since it loaded). */
async function currentUrl(tabId: number, fallback: string): Promise<string> {
  try {
    return (await chrome.tabs.get(tabId)).url ?? fallback;
  } catch {
    return fallback;
  }
}

/** Links in the rendered page, including ones built by script, and whether each is in its navigation. */
async function renderedLinks(tabId: number): Promise<LinkInfo[]> {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      args: [NAV_SELECTOR, MENU_WORDS],
      func: async (navSelector: string, menuWords: string[]) => {
        // As `isMenuName` (shared/site-crawl.ts), which cannot be passed into the page.
        const menuName = (v: string | null) =>
          !!v &&
          v
            .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
            .toLowerCase()
            .split(/[\s_-]+/)
            .some((part) => menuWords.includes(part));
        const inMenu = (a: Element): boolean => {
          if (a.closest(navSelector)) return true;
          for (let el: Element | null = a; el && el !== document.body; el = el.parentElement) {
            if (menuName(el.getAttribute("class")) || menuName(el.id)) return true;
          }
          return false;
        };
        const anchors = () => [...document.querySelectorAll<HTMLAnchorElement | HTMLAreaElement>("a[href], area[href]")];
        // Parts of a page (dashboard widgets, menus fetched after load) can arrive seconds later:
        // wait until the links stop changing (three equal counts half a second apart), at most 10 s.
        let last = -1;
        let steady = 0;
        for (let waited = 0; waited < 10_000 && steady < 3; waited += 500) {
          await new Promise((r) => setTimeout(r, 500));
          const n = anchors().length;
          steady = n === last ? steady + 1 : 0;
          last = n;
        }
        // A plain "#section" link points into this same page; "#/route" links are pages of a hash-routed app.
        return anchors()
          .filter((a) => !/^#(?!!?\/)/.test(a.getAttribute("href") ?? ""))
          .map((a) => ({ url: a.href, nav: inMenu(a) }));
      },
    });
    return Array.isArray(res?.result) ? (res.result as LinkInfo[]) : [];
  } catch {
    return [];
  }
}

function countFindings(r: ScanResult): { definite: number; review: number } {
  let definite = 0;
  let review = 0;
  for (const f of r.findings) {
    if (f.status !== "new") continue;
    if (f.type === "Review") review++;
    else definite++;
  }
  return { definite, review };
}

async function scanPages(): Promise<void> {
  if (!state || !deps) throw new Error("Find the pages of a site first.");
  if (running) return;
  running = true;
  control = "run";
  const stopKeepAlive = deps.keepAlive();
  const s = state;
  let pauseReason: string | undefined;
  await update({ phase: "scanning", startedAt: s.startedAt ?? new Date().toISOString(), finishedAt: undefined, message: undefined });
  try {
    const base = await deps.scanOptions();
    const options: ScanOptions = { ...base, scope: "page", selector: undefined };
    for (;;) {
      if (control !== "run" || !state || state.id !== s.id) break;
      const only = onlyIndexes;
      const index = state.pages.findIndex((p, i) => p.include && p.status === "pending" && (!only || only.has(i)));
      if (index < 0) break;
      const page = state.pages[index];
      const inRun = (p: SitePage, i: number) => p.include && (!only || only.has(i));
      const total = state.pages.filter(inRun).length;
      const doneCount = state.pages.filter((p, i) => inRun(p, i) && p.status !== "pending").length;
      state.pages[index] = { ...page, status: "scanning" };
      await update({ message: `Scanning page ${doneCount + 1} of ${total}: ${page.url}` });
      const started = Date.now();
      let patch: Partial<SitePage>;
      try {
        const fresh = workerTabId === null;
        const tabId = await ensureWorker(page.url);
        await navigate(tabId, page.url, fresh);
        if (fresh) await fitWidth(tabId, state.options.width ?? DEFAULT_WIDTH);
        await new Promise((r) => setTimeout(r, SETTLE_MS));
        // After the pause: a single-page app redirects (to a default tab, to sign-in) after the load.
        const final = await currentUrl(tabId, page.url);
        const finalNorm = normalizeUrl(final) ?? final;
        if (!sameOrigin(final, state.origin)) {
          patch = { status: "skipped", error: `Went to another site: ${final}`, finalUrl: final };
        } else if (finalNorm !== page.url && state.pages.some((p, i) => i !== index && p.status === "done" && (p.url === finalNorm || p.finalUrl === finalNorm))) {
          patch = { status: "skipped", error: `Same page as ${finalNorm} (redirect)`, finalUrl: finalNorm };
        } else {
          if (page.depth < state.options.maxDepth) {
            let added = false;
            for (const link of asFollowed(await renderedLinks(tabId))) if (addLink(link, page.depth + 1, page.url)) added = true;
            if (added) state.pages = choosePages(state.pages, state.options);
          }
          if (requested() === "stop") {
            patch = { status: "pending" };
          } else {
            let result = await deps.scan(tabId, options);
            // Screenshots while the page is open in the scan window, for the report and View.
            if (state.options.screenshots) {
              await update({ message: `Taking screenshots of the issues on page ${doneCount + 1} of ${total}` });
              result = await deps.photograph(tabId, result);
            }
            await chrome.storage.local.set({ [resultKey(state.id, index)]: result });
            patch = {
              status: "done",
              title: result.title,
              finalUrl: finalNorm !== page.url ? finalNorm : undefined,
              score: result.score,
              ...countFindings(result),
              durationMs: Date.now() - started,
            };
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // The scanning window was closed: pause instead of failing every remaining page.
        if (workerTabId === null || /No tab with id|closed/i.test(msg)) {
          control = "pause";
          patch = { status: "pending" };
          pauseReason = "The scanning window was closed. Resume to continue.";
        } else {
          patch = { status: "failed", error: msg };
        }
      }
      if (!state || state.id !== s.id) break;
      state.pages[index] = { ...state.pages[index], ...patch };
      await save();
    }
    if (state && state.id === s.id) {
      const now = requested();
      const finished = now === "run";
      // Compare the pages scanned so far in the parts they share.
      if (now !== "pause") state.crossPage = crossPageFindings(await results());
      await update({
        phase: now === "pause" ? "paused" : finished ? "done" : "stopped",
        finishedAt: now === "pause" ? undefined : new Date().toISOString(),
        message: now === "pause" ? (pauseReason ?? "Paused. Resume to scan the remaining pages.") : undefined,
      });
      if (now !== "pause") await closeWorker();
    }
  } finally {
    running = false;
    control = "run";
    onlyIndexes = null;
    stopKeepAlive();
  }
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

async function results(): Promise<ScanResult[]> {
  if (!state) return [];
  const keys = state.pages.map((p, i) => (p.status === "done" ? resultKey(state!.id, i) : null)).filter((k): k is string => !!k);
  if (!keys.length) return [];
  const stored = await chrome.storage.local.get(keys);
  return keys.map((k) => stored[k] as ScanResult | undefined).filter((r): r is ScanResult => !!r);
}

export async function handleSiteScanMessage(msg: Message): Promise<unknown> {
  await load();
  switch (msg.type) {
    case "SITE_SCAN_GET":
      return state;

    case "SITE_SCAN_DISCOVER": {
      // Answer straight away; progress arrives as SITE_SCAN_STATE.
      const started = beginDiscovery(msg.url, msg.options);
      void discover().catch(async (e) => {
        running = false;
        await update({ phase: "review", message: e instanceof Error ? e.message : String(e) });
      });
      return started;
    }

    case "SITE_SCAN_SET_PAGES": {
      if (!state) throw new Error("No site scan.");
      if (state.phase === "discovering") throw new Error("Wait for page discovery to finish.");
      for (const raw of msg.add ?? []) {
        const n = normalizeUrl(raw);
        if (!n) throw new Error(`Not a web address: ${raw}`);
        if (!sameOrigin(n, state.origin)) throw new Error(`${n} is not on ${state.origin}.`);
        // Adding a page that is already listed ticks it.
        const listed = state.pages.findIndex((p) => samePage(p.url, n) || samePage(p.finalUrl, n));
        if (listed >= 0) {
          if (state.pages[listed].status === "pending") state.pages[listed] = { ...state.pages[listed], include: true, userSet: true, note: undefined };
        } else if (addPage(n, 1, "manual")) {
          const p = state.pages[state.pages.length - 1];
          state.pages[state.pages.length - 1] = { ...p, include: true, userSet: true };
        }
      }
      for (const [url, include] of Object.entries(msg.include ?? {})) {
        const i = state.pages.findIndex((p) => p.url === url);
        if (i >= 0 && state.pages[i].status === "pending") state.pages[i] = { ...state.pages[i], include, userSet: true, note: include ? undefined : state.pages[i].note };
      }
      await save();
      return state;
    }

    case "SITE_SCAN_START":
      void scanPages().catch(async (e) => {
        await update({ phase: "paused", message: e instanceof Error ? e.message : String(e) });
      });
      return state;

    case "SITE_SCAN_RESCAN": {
      if (!state) throw new Error("No site scan.");
      if (running) throw new Error("Wait for the current run to finish, or pause it.");
      const wanted = msg.indexes ? new Set(msg.indexes) : null;
      let count = 0;
      const chosen = new Set<number>();
      state.pages = state.pages.map((p, i) => {
        if (wanted ? !wanted.has(i) : !(p.status === "done" || p.status === "failed")) return p;
        if (p.status !== "done" && p.status !== "failed") return p;
        count++;
        chosen.add(i);
        // Keep the last figures to show what changed; the new result replaces the stored one.
        const previous = p.status === "done" ? { score: p.score, definite: p.definite, review: p.review } : p.previous;
        return { ...p, status: "pending", include: true, userSet: true, error: undefined, previous };
      });
      if (count === 0) throw new Error("No scanned pages to rescan.");
      onlyIndexes = chosen;
      // Scanning from this moment, so nobody reads the finished state of the last run meanwhile.
      state.phase = "scanning";
      state.finishedAt = undefined;
      await save();
      void scanPages().catch(async (e) => {
        await update({ phase: "paused", message: e instanceof Error ? e.message : String(e) });
      });
      return state;
    }

    case "SITE_SCAN_PAUSE":
      if (running) control = "pause";
      return state;

    case "SITE_SCAN_STOP":
      if (running) control = "stop";
      else if (state && state.phase === "paused") {
        await closeWorker();
        await update({ phase: "stopped", finishedAt: new Date().toISOString(), message: undefined });
      }
      return state;

    case "SITE_SCAN_RESULT": {
      if (!state) throw new Error("No site scan.");
      const stored = await chrome.storage.local.get(resultKey(state.id, msg.index));
      const r = stored[resultKey(state.id, msg.index)] as ScanResult | undefined;
      if (!r) throw new Error("That page has no scan result.");
      return r;
    }

    case "SITE_SCAN_EXPORT": {
      const all = await results();
      if (!all.length) throw new Error("No scanned pages to export yet.");
      return deps!.exportResults(msg.format, all);
    }

    case "SITE_SCAN_CLEAR":
      if (running) throw new Error("Stop the site scan first.");
      await closeWorker();
      await clearStored();
      state = null;
      await save();
      return null;

    default:
      throw new Error(`Unexpected site-scan message: ${msg.type}`);
  }
}

/** The tab the site scan loads pages in. */
export function isSiteScanTab(tabId: number): boolean {
  return tabId === workerTabId || helpers.some((h) => h.tabId === tabId);
}

export function isSiteScanMessage(msg: Message): boolean {
  return msg.type.startsWith("SITE_SCAN_") && msg.type !== "SITE_SCAN_STATE";
}
