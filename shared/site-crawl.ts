/**
 * Site scan: types shared by the service worker and the side panel, and the pure
 * helpers that turn links and sitemaps into a list of pages to scan.
 *
 * Page discovery: the site's sitemap (robots.txt `Sitemap:` lines and /sitemap.xml),
 * then the links on each page, starting from the address the tester gives. Only pages
 * of the same origin are kept. Addresses are normalised (no #fragment, no tracking
 * parameters, sorted query) so one page is listed once, and pages that differ only by
 * an id or a slug under the same folder (/product/123, /blog/my-post) are grouped as
 * one template, of which only a few are scanned.
 */

import type { CrossPageFinding } from "./cross-page";

export type SitePageSource = "start" | "sitemap" | "link" | "manual";
export type SitePageStatus = "pending" | "scanning" | "done" | "failed" | "skipped";
export type SiteScanPhase = "idle" | "discovering" | "review" | "scanning" | "paused" | "done" | "stopped";

export interface SiteScanOptions {
  /** Most pages scanned in one run. */
  maxPages: number;
  /** Most link steps away from the start page. */
  maxDepth: number;
  /** Pages scanned per group of similar pages (same template); 0 = no limit. */
  perTemplate: number;
  /** Read robots.txt and sitemap.xml. */
  useSitemap: boolean;
  /** Skip addresses containing any of these (case-insensitive; * matches anything). */
  exclude: string[];
  /** Keep to pages whose path starts with this ("/hrms/"); empty = the whole origin. */
  within?: string;
  /** Not used by this extension: none of its checks act on the page. Kept so the options have the shape of the accessibility extension's. */
  quick?: boolean;
  /**
   * Follow every link. Off (the default): links in the site's navigation (menus, header, footer,
   * sidebars, tabs, breadcrumbs) are followed, and links in the content (product grids, article
   * lists) only add the first page of each kind; the rest are counted on that page (`similar`).
   */
  allLinks?: boolean;
  /**
   * Pages read at once while finding the pages of a script-built app, each in a scan window of
   * its own (1–3; default 2). Scanning itself always uses one window.
   */
  parallel?: number;
  /** Screenshot every failed element of each page while it is open, for the report (slower). */
  screenshots?: boolean;
  /** Width in CSS px of the page area of the scan window (1440, 1024, 768, 375...); default 1280. */
  width?: number;
}

/** A link found on a page, and whether it sits in the page's navigation. */
export interface LinkInfo {
  url: string;
  nav: boolean;
  /** Followed as navigation only because its page has no recognisable menu (not in a menu itself). */
  assumed?: boolean;
}

/**
 * Where a site's navigation lives. A link inside one of these is a way around the site; any
 * other link is content (a product card, an article teaser, a link in a paragraph).
 */
export const NAV_SELECTOR = [
  "nav",
  "header",
  "footer",
  "aside",
  "[role=navigation]",
  "[role=banner]",
  "[role=contentinfo]",
  "[role=complementary]",
  "[role=tablist]",
  "[role=menu]",
  "[role=menubar]",
  "[role=tree]",
  "[aria-label*=breadcrumb i]",
  ".breadcrumb",
  ".breadcrumbs",
].join(",");

/**
 * Words that mark a menu when they are a whole part of a class or id: "side-nav__list",
 * "navbar-expand", "mainMenu", "app-sidebar", "mat-sidenav". Parts are split at "-", "_" and
 * camelCase humps, so "canvas" or "unavailable" do not count. Many applications build their menus
 * from plain <div>s with such names instead of <nav>.
 */
export const MENU_WORDS = ["nav", "navs", "navbar", "navigation", "sidenav", "topnav", "subnav", "menu", "menus", "menubar", "submenu", "sidemenu", "sidebar", "drawer", "breadcrumb", "breadcrumbs"];

/** True when a class list or id contains a menu word (see `MENU_WORDS`). */
export function isMenuName(value: string | null | undefined): boolean {
  if (!value) return false;
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .split(/[\s_-]+/)
    .some((part) => MENU_WORDS.includes(part));
}

export interface SitePage {
  url: string;
  depth: number;
  source: SitePageSource;
  template: string;
  /** Ticked for scanning. */
  include: boolean;
  /** Why it starts unticked (a similar page is already included, or over the page limit). */
  note?: string;
  /** Ticked or unticked by the tester; automatic choices leave it alone. */
  userSet?: boolean;
  /** Content links to more pages like this one that were counted instead of listed. */
  similar?: number;
  /** The previous scan's figures, kept when the page is rescanned, to show what changed. */
  previous?: { score?: number; definite?: number; review?: number };
  status: SitePageStatus;
  error?: string;
  title?: string;
  /** Address after redirects, when different. */
  finalUrl?: string;
  score?: number;
  definite?: number;
  review?: number;
  durationMs?: number;
}

export interface SiteScanState {
  id: string;
  startUrl: string;
  origin: string;
  options: SiteScanOptions;
  phase: SiteScanPhase;
  pages: SitePage[];
  /** Discovery counts, for the summary line. */
  /** `details`: detail pages (an id in the address) and repeat views of a listed screen, left out. */
  found: { sitemap: number; links: number; excluded: number; details?: number };
  /** Status line while discovering or scanning. */
  message?: string;
  /** What differs between the scanned pages in the parts they share; filled when a run ends. */
  crossPage?: CrossPageFinding[];
  startedAt?: string;
  finishedAt?: string;
}

/** Rules the quick mode leaves out: they move focus, resize or restyle the page, and take most of a scan's time. */
export const SLOW_RULE_IDS: string[] = [];

export const DEFAULT_EXCLUDES = [
  "logout",
  "log-out",
  "log_out",
  "signout",
  "sign-out",
  "sign_out",
  "logoff",
  "delete",
  "remove",
  "unsubscribe",
  "destroy",
  "deactivate",
  // Links that change the account's settings when opened, not pages
  "switchlang",
  "setlang",
  "changelang",
  "setlanguage",
  "setculture",
  "changeculture",
];

export const DEFAULT_SITE_SCAN_OPTIONS: SiteScanOptions = {
  maxPages: 100,
  maxDepth: 3,
  perTemplate: 1,
  useSitemap: true,
  exclude: DEFAULT_EXCLUDES,
  parallel: 2,
  // Off by default: a screenshot takes about half a second per issue.
  screenshots: false,
};

/** Most scan windows used at once while finding pages. */
export const MAX_PARALLEL = 3;

/** The number of windows to find pages with: `parallel` kept within 1…MAX_PARALLEL (default 2). */
export function parallelWindows(options: Pick<SiteScanOptions, "parallel">): number {
  const n = Math.round(Number(options.parallel ?? 2));
  return Number.isFinite(n) ? Math.min(MAX_PARALLEL, Math.max(1, n)) : 2;
}

/**
 * Run `work` over `items` with at most `workers.length` at a time, each worker taking the next
 * item as soon as it is free. `take` decides, when an item comes up, whether to run it (false
 * skips it; returning "stop" ends the run). Results are handed to `done` in the items' order,
 * whatever order they finish in, so the outcome does not depend on which page loaded first.
 * A worker whose `work` throws `WorkerGone` leaves the pool; its item is retried by another.
 */
export async function runPool<T, W, R>(
  items: T[],
  workers: W[],
  take: (item: T) => boolean | "stop",
  work: (item: T, worker: W) => Promise<R>,
  done: (item: T, result: R) => void,
): Promise<void> {
  const results = new Map<number, R | typeof SKIPPED>();
  let next = 0;
  let committed = 0;
  let stopped = false;
  const retry: number[] = [];
  const commit = () => {
    while (results.has(committed)) {
      const r = results.get(committed)!;
      results.delete(committed);
      if (r !== SKIPPED) done(items[committed], r as R);
      committed++;
    }
  };
  const runWorker = async (worker: W) => {
    for (;;) {
      let i: number;
      if (retry.length) i = retry.shift()!;
      else {
        if (stopped || next >= items.length) return;
        i = next++;
        const t = take(items[i]);
        if (t === "stop") {
          stopped = true;
          // Items not taken are skipped, so the ones before them still commit.
          for (let k = i; k < items.length; k++) results.set(k, SKIPPED);
          next = items.length;
          commit();
          return;
        }
        if (!t) {
          results.set(i, SKIPPED);
          commit();
          continue;
        }
      }
      try {
        results.set(i, await work(items[i], worker));
      } catch (e) {
        if (e instanceof WorkerGone) {
          retry.push(i);
          return;
        }
        throw e;
      }
      commit();
    }
  };
  await Promise.all(workers.map(runWorker));
  // Retried items whose every worker has gone: skipped.
  for (const i of retry) results.set(i, SKIPPED);
  commit();
}

const SKIPPED = Symbol("skipped");

/** Thrown by a pool worker that can take no more items (its window was closed). */
export class WorkerGone extends Error {}

/**
 * Files that are not web pages, by the extension of the address's last part. The extension may be
 * followed by junk a download page uses to test tools ("shell.txt jpg", "shell.txt::$DATA").
 */
const FILE_EXT_RE =
  /\.(pdf|zip|gz|tgz|tar|bz2|xz|rar|7z|dmg|exe|msi|apk|deb|rpm|jar|war|iso|bin|dat|tmp|log|jpe?g|png|gif|webp|avif|heic|svg|ico|bmp|tiff?|mp3|wav|ogg|m4a|mp4|m4v|mov|avi|wmv|flv|swf|webm|mkv|docx?|xlsx?|pptx?|odt|ods|odp|rtf|epub|md|csv|txt|xml|json|ya?ml|rss|atom|ics|vcf|eml|pfx|p12|cer|crt|pem|wsdl|wadl|woff2?|ttf|eot|css|js|sh|bat|ps1|py|rb|java|cs|cpp|h|sql|ini|cfg|conf|toml|ipynb|patch|diff)([\s:].*)?$/i;

/** The address's last part, decoded ("Hello%20World!.rtf" → "Hello World!.rtf"). */
function lastSegment(pathname: string): string {
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** News feeds (RSS / Atom), not pages: /feed, /feeds/posts/default, /rss, /comments/feed, ?feed=rss2. */
const FEED_PATH_RE = /(^|\/)(feeds?|rss|atom)(\/|$)/i;
const FEED_QUERY_RE = /(^|&)(feed|alt)=(rss2?|atom|json)(&|$)/i;

/** Web-service descriptions (SOAP ?wsdl, REST ?_wadl), which are XML, not pages. */
const SERVICE_QUERY_RE = /^_?(wsdl|wadl|disco|singlewsdl)$/i;
/** Machine addresses, not pages: JSON APIs under /api/… and Cloudflare's /cdn-cgi/ (e-mail protection, challenges). */
const MACHINE_PATH_RE = /^\/(?:[^/]+\/)?(api|cdn-cgi)\/./i;
/** Session ids some servers put in the path (Java ;jsessionid=, PHP ;PHPSESSID=): the same page. */
const PATH_SESSION_RE = /;(jsessionid|phpsessid|sid|sessionid)=[^/?#]*/gi;

/** Query parameters that only track where a visit came from. */
const TRACKING_PARAM_RE = /^(utm_[a-z]+|gclid|gbraid|wbraid|fbclid|msclkid|mc_cid|mc_eid|_ga|_gl|_hsenc|_hsmi|igshid|yclid|ref_src|spm)$/i;

/** `#/route` or `#!/route`: a page of a hash-routed app, unlike a plain `#section` anchor. */
const HASH_ROUTE_RE = /^#!?\//;

/** The hash route of an address ("#/leave/apply"), or "" when it has none. */
export function hashRoute(url: string): string {
  try {
    const h = new URL(url).hash;
    return HASH_ROUTE_RE.test(h) ? h : "";
  } catch {
    return "";
  }
}

/**
 * Canonical form of a link for de-duplication, or null when it is not a page we can scan:
 * other protocols (mailto:, tel:, javascript:), files, or an unparseable address.
 * A plain #fragment is dropped (same page); a hash route (#/leave, #!/leave) is kept, without a
 * trailing slash, because hash-routed apps (older Angular, Vue, Backbone) put every page there.
 */
export function normalizeUrl(href: string, base?: string): string | null {
  let u: URL;
  try {
    u = base ? new URL(href.trim(), base) : new URL(href.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.pathname = u.pathname.replace(PATH_SESSION_RE, "");
  if (FILE_EXT_RE.test(lastSegment(u.pathname))) return null;
  if (MACHINE_PATH_RE.test(u.pathname)) return null;
  if ([...u.searchParams.keys()].some((k) => SERVICE_QUERY_RE.test(k))) return null;
  if (FEED_PATH_RE.test(u.pathname) || FEED_QUERY_RE.test(u.search.slice(1))) return null;
  let route = HASH_ROUTE_RE.test(u.hash) ? u.hash.replace(/\/+$/, "").replace(/\/+(\?)/, "$1") : "";
  // "#/" and "#!/" are the app's root route: the same page as no hash
  if (route === "#" || route === "#!") route = "";
  u.hash = "";
  u.username = "";
  u.password = "";
  const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAM_RE.test(k)).sort(([a], [b]) => a.localeCompare(b));
  u.search = "";
  for (const [k, v] of params) u.searchParams.append(k, v);
  // "/docs/" and "/docs" are one page on almost every site
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.replace(/\/+$/, "");
  return u.toString() + route;
}

/**
 * Folder an application lives in, from its start address: the first path segment when the
 * address is at least two levels deep (https://apps.example.com/hrms/dashboard -> "/hrms/").
 * Shallower addresses (a site's home page, /about) give "" (the whole site).
 */
export function defaultWithin(startUrl: string): string {
  try {
    const segs = new URL(startUrl).pathname.split("/").filter(Boolean);
    return segs.length >= 2 ? `/${segs[0]}/` : "";
  } catch {
    return "";
  }
}

/** True when the page is inside the `within` folder (always true when it is empty). */
export function isWithin(url: string, within: string | undefined): boolean {
  if (!within) return true;
  try {
    const path = new URL(url).pathname;
    const folder = within.endsWith("/") ? within : `${within}/`;
    return path === folder.slice(0, -1) || path.startsWith(folder);
  } catch {
    return false;
  }
}

export function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/** True when the address matches an exclude pattern (case-insensitive substring; `*` matches anything). */
export function isExcluded(url: string, patterns: string[]): boolean {
  let target: string;
  try {
    const u = new URL(url);
    target = (u.pathname + u.search + hashRoute(url)).toLowerCase();
  } catch {
    target = url.toLowerCase();
  }
  return patterns.some((raw) => {
    const p = raw.trim().toLowerCase();
    if (!p) return false;
    if (!p.includes("*")) return target.includes(p);
    const re = new RegExp(p.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*"));
    return re.test(target);
  });
}

const LOCALE_SEGMENT_RE = /^[a-z]{2}([-_][a-z]{2,4})?$/i;
/**
 * An id in a path segment: a number, UUID or hash; a code with digits (ab12cd34); a slug ending in
 * an id (a-light-in-the-attic_1000, travel_2, blue-shirt-48213); or a page of a list (page-2).
 * A short number after a hyphen (step-2, level-1) is a name, not an id.
 */
const ID_SEGMENT_RE = /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{12,}|[a-z0-9_-]*\d[a-z0-9_-]{5,}|[a-z0-9-]*_\d+|[a-z0-9_-]+-\d{3,}|page[-_]?\d+)$/i;

/**
 * Template of a page from its address alone: ids (numbers, UUIDs, hashes, codes with digits)
 * become `*`, query values are dropped and only the parameter names kept. /product/123 and
 * /product/456 share /product/*. Folders of many named pages (/blog/my-post) are grouped
 * later, by `choosePages`, once the number of siblings is known.
 */
export function templateKey(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const generic = (path: string) =>
    path
      .split("/")
      .filter(Boolean)
      .map((seg) => {
        // An id with a file extension (/product/123.html) is still an id.
        const ext = /\.[a-z0-9]{1,5}$/i.exec(seg)?.[0] ?? "";
        return ID_SEGMENT_RE.test(seg.slice(0, seg.length - ext.length)) ? "*" + ext : seg;
      });
  // The query is ignored: /report/display?id=1 and ?id=2, or a list and its filtered views
  // (?status=3), are one screen. Case is ignored too (ASP.NET serves /SAML/x and /Saml/x alike).
  const base = "/" + generic(u.pathname).join("/");
  // A hash route is the page's real path: #/employee/123 and #/employee/456 share one template.
  const route = hashRoute(url);
  if (!route) return base.toLowerCase();
  const routePath = route.replace(HASH_ROUTE_RE, "").split("?")[0];
  return `${base}#/${generic(routePath).join("/")}`.toLowerCase();
}

/**
 * The same page, ignoring the case of the address (servers such as IIS treat /SAML and /Saml alike)
 * and a folder's index file (/shop/index.html is /shop/).
 */
export function samePage(a: string | undefined, b: string): boolean {
  const key = (u: string) =>
    u
      .toLowerCase()
      .replace(/\/(index|default)\.(html?|php|aspx?|jsp)(?=$|[?#])/, "/")
      .replace(/\/+(?=$|[?#])/, "");
  return !!a && key(a) === key(b);
}

/** A folder with at least this many listed pages is treated as one template (a blog, a product catalogue). */
export const SIBLING_THRESHOLD = 8;

/** The folder a template sits in, or null for top-level pages (and pages right under a language prefix). */
function folderOf(template: string): string | null {
  const hashAt = template.indexOf("#/");
  if (hashAt >= 0) {
    const inner = folderOf(template.slice(hashAt + 1));
    return inner === null ? null : template.slice(0, hashAt) + "#" + inner;
  }
  const [path, query] = template.split("?");
  const segs = path.split("/").filter(Boolean);
  const folderStart = segs.length > 0 && LOCALE_SEGMENT_RE.test(segs[0]) ? 1 : 0;
  if (segs.length - folderStart < 2) return null;
  return "/" + segs.slice(0, -1).join("/") + "/*" + (query ? "?" + query : "");
}

/**
 * Templates with crowded folders folded into `folder/*`, for pages taken from the sitemap only
 * (a sitemap lists every blog post). Pages reached from the site's menus are distinct screens
 * even when they share a folder: /UserData/Accounts and /UserData/Holdings in an MVC app.
 */
export function groupTemplates(pages: SitePage[]): SitePage[] {
  const perFolder = new Map<string, number>();
  for (const p of pages) {
    if (p.source !== "sitemap") continue;
    const f = folderOf(templateKey(p.url));
    if (f) perFolder.set(f, (perFolder.get(f) ?? 0) + 1);
  }
  return pages.map((p) => {
    const own = templateKey(p.url);
    const f = p.source === "sitemap" ? folderOf(own) : null;
    const template = f && (perFolder.get(f) ?? 0) >= SIBLING_THRESHOLD ? f : own;
    return template === p.template ? p : { ...p, template };
  });
}

/** href values of <a> and <area> elements in an HTML string, resolved against the page (and its <base>). */
export function extractLinks(html: string, pageUrl: string): string[] {
  return extractLinkInfo(html, pageUrl).map((l) => l.url);
}

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

/** Where the element whose start tag ends at `openEnd` closes, or -1 when it does not. */
function elementEnd(html: string, tag: string, openEnd: number): number {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, "gi");
  re.lastIndex = openEnd;
  let depth = 1;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[1]) depth--;
    else if (!m[2]) depth++;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

/** Parts of an HTML page that are menus: <nav>, <header>, <footer>, <aside>, and elements with a menu-like class or id. */
function menuRanges(html: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const blockRe = /<(nav|header|footer|aside)\b[\s\S]*?<\/\1\s*>/gi;
  for (let m = blockRe.exec(html); m; m = blockRe.exec(html)) ranges.push([m.index, m.index + m[0].length]);
  const openRe = /<([a-z][a-z0-9-]*)\b([^>]*)>/gi;
  let coveredTo = -1;
  for (let m = openRe.exec(html); m; m = openRe.exec(html)) {
    if (m.index < coveredTo) continue; // inside a menu already found
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    if (VOID_TAGS.has(tag) || attrs.trimEnd().endsWith("/")) continue;
    const value = (name: string) => {
      const a = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(attrs);
      return a ? (a[1] ?? a[2]) : undefined;
    };
    if (!isMenuName(value("class")) && !isMenuName(value("id"))) continue;
    const end = elementEnd(html, tag, m.index + m[0].length);
    if (end < 0) continue;
    ranges.push([m.index, end]);
    coveredTo = end;
  }
  return ranges;
}

/** Like `extractLinks`, noting which links sit in a menu (<nav>, <header>, <footer>, <aside>, or a menu-like class or id). */
export function extractLinkInfo(html: string, pageUrl: string): LinkInfo[] {
  const navRanges = menuRanges(html);
  const inNav = (i: number) => navRanges.some(([a, b]) => i >= a && i < b);
  let base = pageUrl;
  const baseTag = /<base\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(html);
  if (baseTag) {
    try {
      base = new URL(decodeEntities(baseTag[1] ?? baseTag[2] ?? baseTag[3] ?? ""), pageUrl).toString();
    } catch {
      // keep the page address
    }
  }
  const out: LinkInfo[] = [];
  const re = /<(?:a|area)\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const href = decodeEntities(m[1] ?? m[2] ?? m[3] ?? "").trim();
    // "#section" points into this same page; "#/route" is a page of a hash-routed app.
    if (href.startsWith("#") && !HASH_ROUTE_RE.test(href)) continue;
    const n = normalizeUrl(href, base);
    if (n) out.push({ url: n, nav: inNav(m.index) });
  }
  return out;
}

/**
 * The kind of page a content link leads to, for keeping one example of each: pages one folder
 * deeper than the application's root that share a folder are one kind (/product/123 and
 * /product/456, /products/blue-shirt and /products/red-shoes). Pages directly under the root
 * (or under `within`, or a language prefix) each stay their own kind, since those are usually
 * distinct screens (/about, /hrms/leave).
 */
export function similarKey(url: string, within = ""): string {
  const t = templateKey(url);
  const folderKey = (pathAndQuery: string, skip: string[]): string => {
    const [path, query] = pathAndQuery.split("?");
    const segs = path.split("/").filter(Boolean);
    let start = skip.length && skip.every((s, i) => segs[i] === s) ? skip.length : 0;
    if (segs[start] && LOCALE_SEGMENT_RE.test(segs[start])) start++;
    if (segs.length - start < 2) return pathAndQuery;
    return "/" + segs.slice(0, -1).join("/") + "/*" + (query ? "?" + query : "");
  };
  const withinSegs = within.split("/").filter(Boolean);
  const hashAt = t.indexOf("#/");
  if (hashAt >= 0) return t.slice(0, hashAt) + "#" + folderKey(t.slice(hashAt + 1), []);
  return folderKey(t, withinSegs);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

/** Page addresses and child sitemaps listed in a sitemap or sitemap index. */
export function parseSitemap(xml: string): { pages: string[]; sitemaps: string[] } {
  const pages: string[] = [];
  const sitemaps: string[] = [];
  const blockRe = /<(url|sitemap)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  for (let m = blockRe.exec(xml); m; m = blockRe.exec(xml)) {
    const loc = /<loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/loc>/i.exec(m[2]);
    if (!loc) continue;
    const value = decodeEntities(loc[1].trim());
    (m[1].toLowerCase() === "sitemap" ? sitemaps : pages).push(value);
  }
  return { pages, sitemaps };
}

/** `Sitemap:` lines of a robots.txt. */
export function robotsSitemaps(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => /^\s*sitemap\s*:\s*(\S+)/i.exec(l)?.[1])
    .filter((s): s is string => !!s);
}

/**
 * Tick the pages to scan, in discovery order: the start page always, then pages until
 * `maxPages`, at most `perTemplate` per template. The rest stay listed, unticked, with the reason.
 * Pages already scanned or ticked by hand keep their choice.
 */
export function choosePages(pages: SitePage[], options: SiteScanOptions): SitePage[] {
  const perTemplate = new Map<string, number>();
  let included = 0;
  return groupTemplates(pages).map((p) => {
    if (p.status !== "pending" || p.source === "manual" || p.userSet) {
      if (p.include) {
        included++;
        perTemplate.set(p.template, (perTemplate.get(p.template) ?? 0) + 1);
      }
      return p;
    }
    const seen = perTemplate.get(p.template) ?? 0;
    if (p.source !== "start" && options.perTemplate > 0 && seen >= options.perTemplate) {
      return { ...p, include: false, note: `Similar to ${seen} page${seen === 1 ? "" : "s"} already listed (${p.template})` };
    }
    // Counted even when the limit leaves it unticked: a later copy of this template is then
    // labelled "Similar", and "Over the page limit" is kept for genuinely different screens.
    perTemplate.set(p.template, seen + 1);
    if (p.source !== "start" && included >= options.maxPages) return { ...p, include: false, note: "Over the page limit" };
    included++;
    return { ...p, include: true, note: undefined };
  });
}

/**
 * Order in which pages are offered for scanning: the start page, then pages linked from it
 * (its menus), then deeper links, then pages only the sitemap lists, shallower paths first.
 * Stable, so discovery order breaks ties.
 */
export function rankPages(pages: SitePage[]): SitePage[] {
  const segments = (url: string) => {
    try {
      return new URL(url).pathname.split("/").filter(Boolean).length;
    } catch {
      return 99;
    }
  };
  const key = (p: SitePage): number[] => [p.source === "start" ? 0 : 1, p.source === "sitemap" ? 1 : 0, p.depth, segments(p.url)];
  return pages
    .map((p, i) => ({ p, i, k: key(p) }))
    .sort((a, b) => {
      for (let j = 0; j < a.k.length; j++) if (a.k[j] !== b.k[j]) return a.k[j] - b.k[j];
      return a.i - b.i;
    })
    .map((x) => x.p);
}

export function makePage(url: string, depth: number, source: SitePageSource): SitePage {
  return { url, depth, source, template: templateKey(url), include: false, status: "pending" };
}
