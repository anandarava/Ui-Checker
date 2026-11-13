/**
 * The scan pipeline. Each stage is filled in by a later phase (see PLAN.md):
 *
 *   1. snapshot   (Phase 1)  read every visible element's box, text box and styles
 *   2. grouping   (Phase 2)  find peer groups
 *   3. rules      (Phase 3)  compare the members of each group
 *
 * Built so far: the snapshot and the peer groups. Every rule is still reported
 * as "notImplemented". The result has the final shape, so the UI, the
 * reports and the tests can be built against it.
 *
 * Nothing in here may depend on a particular application: no selectors, class
 * names or text of any specific site.
 */
import { ENGINE_VERSION } from "@shared/constants";
import { RULES } from "@shared/rules";
import type { ElementRef, PeerGroup, RuleResult, ScanOptions, ScanResult } from "@shared/types";
import { outerHtmlSnippet, uniqueSelector } from "./dom-utils";
import { textSnippet } from "./fingerprint";
import { findPeerGroups, type RawGroup } from "./grouping";
import type { OverlayGroup } from "./overlay/overlay-root";
import { waitUntilReady, type ReadyReport } from "./ready";
import { takeSnapshot, type PageSnapshot } from "./snapshot";

export type ProgressFn = (percent: number, stage: string) => void;

/**
 * The root a scan covers: the whole page, or the element a selector points at.
 * Throws a readable error for a selector that is invalid or matches nothing.
 */
export function resolveScope(options: ScanOptions, doc: Document = document): Element {
  if (options.scope !== "selector" || !options.selector) return doc.body ?? doc.documentElement;
  let found: Element | null;
  try {
    found = doc.querySelector(options.selector);
  } catch {
    throw new Error(`"${options.selector}" is not a valid selector.`);
  }
  if (!found) throw new Error(`No element matches "${options.selector}" on this page.`);
  return found;
}

function ruleResults(options: ScanOptions): RuleResult[] {
  const off = new Set(options.disabledRules ?? []);
  const wanted = options.rules.length > 0 ? new Set(options.rules) : null;
  return RULES.map((rule) => {
    const selected = rule.enabled && !off.has(rule.id) && (!wanted || wanted.has(rule.id));
    if (!selected) return { id: rule.id, outcome: "disabled", groupsChecked: 0 };
    if (!rule.implemented) return { id: rule.id, outcome: "notImplemented", groupsChecked: 0 };
    return { id: rule.id, outcome: "notApplicable", groupsChecked: 0 };
  });
}

function readyWarnings(ready: ReadyReport): string[] {
  const out: string[] = [];
  if (!ready.fontsLoaded) out.push("Web fonts were still loading when the page was measured. Text sizes may be off: scan again once the page has loaded.");
  if (!ready.imagesLoaded) out.push("Some images in view were still loading when the page was measured.");
  if (!ready.settled) out.push("The page layout was still changing when it was measured.");
  return out;
}

/** The groups of the last scan with their live elements, for the on-page overlay. */
let lastGroups: OverlayGroup[] = [];

/** The groups to draw: all of them (null) or the ones asked for. */
export function overlayGroups(ids: string[] | null): OverlayGroup[] {
  if (ids === null) return lastGroups;
  const wanted = new Set(ids);
  return lastGroups.filter((g) => wanted.has(g.id));
}

export function forgetGroups(): void {
  lastGroups = [];
}

/** Turns the groups of snapshot indexes into what the UI and the reports read. */
function describeGroups(raw: RawGroup[], snapshot: PageSnapshot): PeerGroup[] {
  const refs = new Map<number, ElementRef>();
  const refOf = (i: number): ElementRef => {
    let ref = refs.get(i);
    if (!ref) {
      const node = snapshot.nodes[i];
      const el = snapshot.elements[i];
      ref = { selector: uniqueSelector(node), html: outerHtmlSnippet(node), text: textSnippet(node), box: el.box };
      if (el.frame > 0) ref.frameId = el.frame;
      if (el.state.length > 0) ref.state = el.state;
      refs.set(i, ref);
    }
    return ref;
  };
  const idOf = (index: number): string => `g${index + 1}`;
  lastGroups = raw.map((g, index) => ({ id: idOf(index), badge: `G${index + 1}`, nodes: g.members.map((m) => snapshot.nodes[m]) }));
  return raw.map((g, index) => {
    const group: PeerGroup = {
      id: idOf(index),
      kind: g.kind,
      label: g.label,
      members: g.members.map((m) => (m === g.guessedActive ? { ...refOf(m), state: ["active (guessed)"] } : refOf(m))),
    };
    if (g.parent >= 0) group.parentGroupId = idOf(g.parent);
    return group;
  });
}

function newScanId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function runScan(options: ScanOptions, onProgress: ProgressFn = () => undefined): Promise<ScanResult> {
  const started = performance.now();

  onProgress(5, "Waiting for the page to finish loading");
  const root = resolveScope(options);
  const ready = await waitUntilReady();

  onProgress(20, "Reading the page");
  const snapshot = takeSnapshot(root);

  onProgress(60, "Finding elements that should match");
  const groupingStarted = performance.now();
  const groups = describeGroups(findPeerGroups(snapshot.elements, { minGroupSize: options.minGroupSize }), snapshot);
  const groupingMs = Math.round(performance.now() - groupingStarted);

  onProgress(85, "Comparing");
  // Phase 3: consistency rules.

  onProgress(100, "Done");
  return {
    scanId: newScanId(),
    url: location.href,
    title: document.title,
    scannedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - started),
    engineVersion: ENGINE_VERSION,
    options,
    viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
    timings: { waitMs: ready.waitedMs, snapshotMs: Math.round(snapshot.durationMs), groupingMs },
    elementsScanned: snapshot.elements.length,
    groups,
    findings: [],
    rules: ruleResults(options),
    notScanned: snapshot.notScanned,
    warnings: readyWarnings(ready),
  };
}
