/**
 * The scan pipeline. Each stage is filled in by a later phase (see PLAN.md):
 *
 *   1. snapshot   (Phase 1)  read every visible element's box, text box and styles
 *   2. grouping   (Phase 2)  find peer groups
 *   3. rules      (Phase 3)  compare the members of each group
 *   4. audit      (Phase 5)  list the design scale of the page
 *
 * A rule whose check does not exist yet is reported as "notImplemented".
 *
 * Nothing in here may depend on a particular application: no selectors, class
 * names or text of any specific site.
 */
import { ENGINE_VERSION } from "@shared/constants";
import { RULES } from "@shared/rules";
import { withFindings } from "@shared/scoring";
import type { DesignAudit, ElementRef, Finding, PeerGroup, RuleResult, ScaleKind, ScanOptions, ScanResult, SharedPart } from "@shared/types";
import { createFacts } from "./facts";
import { findSharedParts } from "./parts";
import { buildAudit, type RawScaleList } from "./audit";
import { outerHtmlSnippet, uniqueSelector } from "./dom-utils";
import { fingerprint, textSnippet } from "./fingerprint";
import { findPeerGroups, type RawGroup } from "./grouping";
import type { OverlayFinding, OverlayGroup } from "./overlay/overlay-root";
import { waitUntilReady, type ReadyReport } from "./ready";
import { runRules, type RuleRun } from "./rules";
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

/** True when the user wants the rule: enabled, not switched off and (when rules are named) asked for. */
function selected(ruleId: string, enabled: boolean, options: ScanOptions): boolean {
  const off = options.disabledRules ?? [];
  return enabled && !off.includes(ruleId) && (options.rules.length === 0 || options.rules.includes(ruleId));
}

/** The rules this scan runs: wanted by the user and built. */
function rulesToRun(options: ScanOptions): string[] {
  return RULES.filter((rule) => rule.implemented && selected(rule.id, rule.enabled, options)).map((rule) => rule.id);
}

function ruleResults(options: ScanOptions, run: RuleRun): RuleResult[] {
  const failed = new Set(run.findings.filter((f) => f.type === "Definite").map((f) => f.ruleId));
  return RULES.map((rule) => {
    if (!selected(rule.id, rule.enabled, options)) return { id: rule.id, outcome: "disabled", groupsChecked: 0 };
    // Honest results: a rule without a check never counts as passed.
    if (!rule.implemented) return { id: rule.id, outcome: "notImplemented", groupsChecked: 0 };
    const groupsChecked = run.checked.get(rule.id) ?? 0;
    if (failed.has(rule.id)) return { id: rule.id, outcome: "failed", groupsChecked };
    return { id: rule.id, outcome: groupsChecked > 0 ? "passed" : "notApplicable", groupsChecked };
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

/** The findings of the last scan with their live elements, for the on-page overlay. */
let lastFindings: OverlayFinding[] = [];

/** The findings to draw badges for: all of them (null) or the ones asked for. */
export function overlayFindings(ids: string[] | null): OverlayFinding[] {
  if (ids === null) return lastFindings;
  const wanted = new Set(ids);
  return lastFindings.filter((f) => wanted.has(f.id));
}

export function overlayFinding(id: string): OverlayFinding | undefined {
  return lastFindings.find((f) => f.id === id);
}

/** The elements that use each value of the design scale in the last scan, for the on-page overlay. */
let lastUses = new Map<string, Element[]>();

/** The elements that use a value of the design scale, as a group to outline. */
export function overlayUses(kind: ScaleKind, value: string): OverlayGroup | undefined {
  const nodes = lastUses.get(`${kind}|${value}`);
  return nodes ? { id: `uses-${kind}`, badge: value, nodes } : undefined;
}

export function forgetGroups(): void {
  lastGroups = [];
  lastFindings = [];
  lastUses = new Map();
}

/** Elements shown per value in the panel and the reports; the page can outline all of them. */
const SAMPLES = 3;

/** Turns the audit of snapshot indexes into what the UI and the reports read. */
function describeAudit(raw: RawScaleList[], snapshot: PageSnapshot, refOf: (i: number) => ElementRef, options: ScanOptions): DesignAudit {
  lastUses = new Map();
  const lists = raw.map((list) => ({
    kind: list.kind,
    ...(list.note ? { note: list.note } : {}),
    values: list.values.map((v) => {
      lastUses.set(`${list.kind}|${v.value}`, v.elements.map((i) => snapshot.nodes[i]));
      return {
        value: v.value,
        count: v.elements.length,
        ...(v.detail ? { detail: v.detail } : {}),
        samples: v.elements.slice(0, SAMPLES).map(refOf),
        flags: v.flags,
        ...(v.token ? { token: v.token } : {}),
      };
    }),
  }));
  return { lists, ...(options.tokens ? { tokenFile: options.tokens.name } : {}) };
}

/** Describes snapshot elements for the UI and the reports; each element is described once. */
function describer(snapshot: PageSnapshot): (i: number) => ElementRef {
  const refs = new Map<number, ElementRef>();
  return (i: number): ElementRef => {
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
}

const idOf = (index: number): string => `g${index + 1}`;

/** Turns the groups of snapshot indexes into what the UI and the reports read. */
function describeGroups(raw: RawGroup[], snapshot: PageSnapshot, refOf: (i: number) => ElementRef): PeerGroup[] {
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

/** Turns the rule findings into what the UI and the reports read. */
function describeFindings(run: RuleRun, refOf: (i: number) => ElementRef, rawGroups: RawGroup[], snapshot: PageSnapshot): Finding[] {
  const used = new Map<string, number>();
  lastFindings = [];
  return run.findings.map((f, index) => {
    const element = refOf(f.element);
    // Stable across scans of the same page: rule, element and what was compared.
    const print = fingerprint(f.ruleId, element.selector, `${f.property}|${element.text}`);
    const n = (used.get(print) ?? 0) + 1;
    used.set(print, n);
    const id = n === 1 ? print : `${print}-${n}`;
    lastFindings.push({
      id,
      number: index + 1,
      severity: f.severity,
      review: f.type === "Review",
      node: snapshot.nodes[f.element],
      peers: f.group >= 0 ? rawGroups[f.group].members.map((m) => snapshot.nodes[m]) : [],
      marks: f.marks ?? [],
    });
    return {
      id,
      fingerprint: print,
      ruleId: f.ruleId,
      severity: f.severity,
      type: f.type,
      status: "new",
      kind: f.kind,
      groupId: f.group >= 0 ? idOf(f.group) : "",
      element,
      property: f.property,
      expected: f.expected,
      actual: f.actual,
      values: f.values,
      message: f.message,
      ...(f.marks && f.marks.length > 0 ? { marks: f.marks } : {}),
    };
  });
}

/** The parts the page shares with the other pages of its site, for the cross-page comparison of a site scan. */
function describeParts(snapshot: PageSnapshot, refOf: (i: number) => ElementRef): SharedPart[] {
  const facts = createFacts(snapshot.elements);
  return findSharedParts(snapshot.elements, facts).map((part) => {
    const s = snapshot.elements[part.styled].style;
    return {
      key: part.key,
      kind: part.kind,
      name: part.name,
      element: refOf(part.element),
      ...(part.text ? { text: part.text } : {}),
      style: { fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight, color: s.color, backgroundColor: facts.backdropOf(part.element) },
      ...(part.items ? { items: part.items } : {}),
    };
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
  const rawGroups = findPeerGroups(snapshot.elements, { minGroupSize: options.minGroupSize });
  const groupingMs = Math.round(performance.now() - groupingStarted);

  onProgress(85, "Comparing");
  const rulesStarted = performance.now();
  const run = runRules(snapshot.elements, rawGroups, options, rulesToRun(options));
  const rawAudit = buildAudit(snapshot.elements, options.tokens ?? null);
  const rulesMs = Math.round(performance.now() - rulesStarted);

  const refOf = describer(snapshot);
  const groups = describeGroups(rawGroups, snapshot, refOf);
  const findings = describeFindings(run, refOf, rawGroups, snapshot);
  const audit = describeAudit(rawAudit, snapshot, refOf, options);

  onProgress(100, "Done");
  const result: ScanResult = {
    scanId: newScanId(),
    url: location.href,
    title: document.title,
    scannedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - started),
    engineVersion: ENGINE_VERSION,
    score: 100,
    summary: { high: 0, medium: 0, low: 0, review: 0, excluded: 0 },
    options,
    viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
    timings: { waitMs: ready.waitedMs, snapshotMs: Math.round(snapshot.durationMs), groupingMs, rulesMs },
    elementsScanned: snapshot.elements.length,
    groups,
    findings,
    rules: ruleResults(options, run),
    audit,
    // Only a scan of the whole page can be compared with other pages.
    ...(options.scope === "page" ? { parts: describeParts(snapshot, refOf) } : {}),
    notScanned: snapshot.notScanned,
    warnings: readyWarnings(ready),
  };
  // Score and counts; the service worker computes them again after it has applied the tester's ignores and baselines.
  return withFindings(result, findings);
}
