/**
 * SPA / dynamic-page observer.
 *
 * Fires `onChange(reason)` (debounced by SPA_DEBOUNCE_MS, one call per burst
 * with the most significant reason: route > dialog > dom) when:
 *  - "route":  the address of the page changes: popstate / hashchange fire,
 *              or the address is different when the page next changes or on
 *              the next check (a content script cannot hear history.pushState);
 *  - "dialog": a `[role=dialog]`, `dialog[open]` or `[aria-modal=true]`
 *              becomes visible;
 *  - "dom":    the accumulated number of elements added/removed under <body>
 *              since the last baseline exceeds 20% of the baseline element
 *              count. Mutations inside extension nodes are ignored and this
 *              heuristic is muted for the first 1500 ms after start (page
 *              hydration, our own overlay mount, etc.).
 */
import { OVERLAY_HOST_ID, OWN_UI_ATTR as EXT_MARKER_ATTR, SPA_DEBOUNCE_MS } from "@shared/constants";

export type ChangeReason = "route" | "dialog" | "dom";

const DOM_WARMUP_MS = 1500;
const DOM_CHANGE_RATIO = 0.2;
/** How often the address is checked when nothing else on the page changes. */
const HREF_CHECK_MS = 1000;
const DIALOG_SELECTOR = "[role=dialog], dialog[open], [aria-modal=true]";
const PRIORITY: Record<ChangeReason, number> = { route: 3, dialog: 2, dom: 1 };

function isExtensionNode(node: Node | null): boolean {
  if (!node) return false;
  const el: Element | null = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!el) return false;
  if (el.id === OVERLAY_HOST_ID) return true;
  return el.closest(`[${EXT_MARKER_ATTR}]`) !== null;
}

function isVisible(el: Element): boolean {
  if (!el.isConnected) return false;
  if (el.getClientRects().length === 0) return false;
  try {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
  } catch {
    return false;
  }
  if (el.closest("[hidden], [aria-hidden=true]")) return false;
  return true;
}

/** Elements inside a node (including itself) that are not extension nodes. */
function elementCount(node: Node): number {
  if (node.nodeType !== Node.ELEMENT_NODE) return 0;
  const el = node as Element;
  if (isExtensionNode(el)) return 0;
  return 1 + el.getElementsByTagName("*").length;
}

function bodyElementCount(): number {
  const body = document.body;
  if (!body) return 0;
  let n = body.getElementsByTagName("*").length;
  // Subtract our own nodes if any live under body (normally they live under <html>).
  const ours = body.querySelectorAll(`[${EXT_MARKER_ATTR}], #${OVERLAY_HOST_ID}`);
  for (const el of Array.from(ours)) n -= 1 + el.getElementsByTagName("*").length;
  return Math.max(0, n);
}

export function startSpaObserver(onChange: (reason: ChangeReason) => void): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: ChangeReason | null = null;
  let observer: MutationObserver | null = null;
  let observedBody: HTMLElement | null = null;
  let rootWatcher: MutationObserver | null = null;
  let warmupTimer: ReturnType<typeof setTimeout> | null = null;
  let baseline = 0;
  let changed = 0;
  let warm = false;
  let batchScheduled = false;
  let queued: MutationRecord[] = [];
  let visibleDialogs = new WeakSet<Element>();
  let lastHref = location.href;
  let hrefTimer: ReturnType<typeof setInterval> | null = null;

  const schedule = (reason: ChangeReason): void => {
    if (stopped) return;
    if (pending === null || PRIORITY[reason] > PRIORITY[pending]) pending = reason;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const r = pending;
      pending = null;
      if (stopped || r === null) return;
      // Whatever happened, the page is considered re-baselined once we report it.
      baseline = bodyElementCount();
      changed = 0;
      try {
        onChange(r);
      } catch {
        /* never let a listener error break the observer */
      }
    }, SPA_DEBOUNCE_MS);
  };

  const onRoute = (): void => {
    lastHref = location.href;
    ensureBodyObserved();
    schedule("route");
  };

  /** history.pushState gives no event in this world: notice the new address instead. */
  const checkHref = (): void => {
    if (!stopped && location.href !== lastHref) onRoute();
  };

  const snapshotDialogs = (): WeakSet<Element> => {
    const set = new WeakSet<Element>();
    for (const el of Array.from(document.querySelectorAll(DIALOG_SELECTOR))) {
      if (!isExtensionNode(el) && isVisible(el)) set.add(el);
    }
    return set;
  };

  const processBatch = (): void => {
    batchScheduled = false;
    if (stopped) return;
    checkHref();
    const records = queued;
    queued = [];

    let sawPageMutation = false;
    let dialogCandidate = false;
    for (const rec of records) {
      if (isExtensionNode(rec.target)) continue;
      if (rec.type === "childList") {
        let delta = 0;
        for (const n of Array.from(rec.addedNodes)) delta += elementCount(n);
        for (const n of Array.from(rec.removedNodes)) delta += elementCount(n);
        if (delta === 0 && rec.addedNodes.length + rec.removedNodes.length > 0) {
          // Only extension nodes (or text nodes) moved: not a page change.
          if (Array.from(rec.addedNodes).concat(Array.from(rec.removedNodes)).every((n) => n.nodeType !== Node.ELEMENT_NODE || isExtensionNode(n))) continue;
        }
        sawPageMutation = true;
        if (delta > 0) {
          changed += delta;
          dialogCandidate = true;
        }
      } else if (rec.type === "attributes") {
        sawPageMutation = true;
        dialogCandidate = true;
      }
    }
    if (!sawPageMutation) return;

    // Dialog detection: any dialog visible now that was not visible before.
    if (dialogCandidate) {
      const now = snapshotDialogs();
      let opened = false;
      for (const el of Array.from(document.querySelectorAll(DIALOG_SELECTOR))) {
        if (now.has(el) && !visibleDialogs.has(el)) {
          opened = true;
          break;
        }
      }
      visibleDialogs = now;
      if (opened) schedule("dialog");
    }

    // Large DOM change detection (muted during warm-up).
    if (warm) {
      const threshold = Math.max(1, Math.floor(baseline * DOM_CHANGE_RATIO));
      if (changed > threshold) {
        changed = 0;
        baseline = bodyElementCount();
        schedule("dom");
      }
    } else {
      changed = 0;
    }
  };

  const onMutations = (records: MutationRecord[]): void => {
    if (stopped) return;
    for (const r of records) queued.push(r);
    if (!batchScheduled) {
      batchScheduled = true;
      // Coalesce bursts of mutations into one pass per frame.
      requestAnimationFrame(processBatch);
    }
  };

  const observeBody = (): void => {
    if (stopped || observer) return;
    const body = document.body;
    if (!body) return;
    baseline = bodyElementCount();
    visibleDialogs = snapshotDialogs();
    observedBody = body;
    observer = new MutationObserver(onMutations);
    observer.observe(body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open", "role", "aria-modal", "hidden", "aria-hidden", "style", "class"],
    });
    // Turbo / htmx style navigations can replace <body> wholesale, orphaning the observer above.
    if (!rootWatcher && document.documentElement) {
      rootWatcher = new MutationObserver(() => ensureBodyObserved(true));
      rootWatcher.observe(document.documentElement, { childList: true });
    }
  };

  /** Re-attach the body observer when document.body is no longer the element being observed. */
  const ensureBodyObserved = (report = false): void => {
    if (stopped || !observer || document.body === observedBody || !document.body) return;
    observer.disconnect();
    observer = null;
    observeBody();
    if (report) schedule("dom");
  };

  const onReady = (): void => {
    document.removeEventListener("DOMContentLoaded", onReady);
    observeBody();
  };

  hrefTimer = setInterval(checkHref, HREF_CHECK_MS);
  window.addEventListener("popstate", onRoute);
  window.addEventListener("hashchange", onRoute);

  if (document.body) observeBody();
  else document.addEventListener("DOMContentLoaded", onReady);

  warmupTimer = setTimeout(() => {
    warmupTimer = null;
    if (stopped) return;
    warm = true;
    baseline = bodyElementCount();
    changed = 0;
  }, DOM_WARMUP_MS);

  return (): void => {
    if (stopped) return;
    stopped = true;
    if (hrefTimer !== null) clearInterval(hrefTimer);
    hrefTimer = null;
    window.removeEventListener("popstate", onRoute);
    window.removeEventListener("hashchange", onRoute);
    document.removeEventListener("DOMContentLoaded", onReady);
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (rootWatcher) {
      rootWatcher.disconnect();
      rootWatcher = null;
    }
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (warmupTimer !== null) {
      clearTimeout(warmupTimer);
      warmupTimer = null;
    }
    pending = null;
    queued = [];
  };
}
