/**
 * Side panel state (zustand). Field and action names follow the PalTech
 * Accessibility Testing extension's store, so components copied from it work
 * with few changes.
 *
 * All cross-component state lives here so the chrome.runtime.onMessage
 * listener (hooks/useBackgroundEvents.ts) can update it through
 * `useStore.getState()` without stale closures.
 */
import { create } from "zustand";
import { withFindings } from "@shared/scoring";
import { getRule } from "@shared/rules";
import { DEFAULT_SETTINGS, type Finding, type FindingStatus, type RuleCategory, type ScanResult, type Settings, type Severity } from "@shared/types";

export type View = "list" | "detail";

/** Result tabs: every finding, one tab per category, needs review, the rules, and the peer groups. */
export type ResultTab = "all" | RuleCategory | "review" | "failed" | "passed" | "groups";

/** What a scan covers: the whole page, or one element and everything inside it. */
export interface ScanScope {
  kind: "page" | "selector";
  selector?: string;
}

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: number;
  kind: ToastKind;
  title?: string;
  message: string;
  link?: { href: string; label: string };
  /** When false the toast stays until dismissed. Defaults to true. */
  autoDismiss?: boolean;
}

export interface Progress {
  percent: number;
  stage: string;
}

export interface Filters {
  /** Empty means "all severities". */
  severities: Severity[];
  /** Finding statuses to show; empty means every status. Defaults to open findings only. */
  statuses: FindingStatus[];
  /** Free-text search over rule, message, selector and HTML. */
  search: string;
  /** Show only the findings of this peer group; null means every group. */
  groupId: string | null;
}

export const DEFAULT_FILTERS: Filters = { severities: [], statuses: ["new"], search: "", groupId: null };

interface State {
  tabId: number | null;
  settings: Settings;
  scanning: boolean;
  progress: Progress | null;
  result: ScanResult | null;
  toast: Toast | null;
  view: View;
  selectedIssueId: string | null;
  filters: Filters;
  resultTab: ResultTab;
  /** Rule groups that are expanded (they start collapsed). */
  expandedRules: string[];
  /** Numbered badges are drawn on the page. */
  showBadges: boolean;
  /** Scroll to and outline the element whenever a finding is opened. */
  autoHighlight: boolean;
  /** What the next scan covers. */
  scope: ScanScope;
  /** The element picker is running on the page. */
  picking: boolean;

  setScope(scope: ScanScope): void;
  setPicking(v: boolean): void;
  setTabId(tabId: number | null): void;
  setSettings(settings: Settings): void;
  setScanning(scanning: boolean): void;
  setProgress(progress: Progress | null): void;
  setResult(result: ScanResult | null): void;
  showToast(toast: Omit<Toast, "id">): void;
  dismissToast(): void;
  setView(view: View): void;
  selectIssue(id: string | null): void;
  setFilters(patch: Partial<Filters>): void;
  setResultTab(tab: ResultTab): void;
  toggleRuleExpanded(ruleId: string): void;
  expandRule(ruleId: string): void;
  setShowBadges(v: boolean): void;
  setAutoHighlight(v: boolean): void;
  /** Map every finding through `fn` and recompute score, counts and rule outcomes. */
  updateIssues(fn: (finding: Finding) => Finding): void;
}

let toastCounter = 0;

export const useStore = create<State>((set, get) => ({
  tabId: null,
  settings: { ...DEFAULT_SETTINGS },
  scanning: false,
  progress: null,
  result: null,
  toast: null,
  view: "list",
  selectedIssueId: null,
  filters: DEFAULT_FILTERS,
  resultTab: "all",
  expandedRules: [],
  showBadges: false,
  autoHighlight: true,
  scope: { kind: "page" },
  picking: false,
  setScope: (scope) => set({ scope }),
  setPicking: (picking) => set({ picking }),

  // Another tab has its own result: drop the one on screen until it is restored for the new tab.
  setTabId: (tabId) => {
    if (get().tabId === tabId) return;
    set({ tabId, result: null, scanning: false, progress: null, view: "list", selectedIssueId: null, filters: DEFAULT_FILTERS, resultTab: "all", expandedRules: [], showBadges: false, scope: { kind: "page" }, picking: false });
  },
  setSettings: (settings) => set({ settings }),
  setScanning: (scanning) => set({ scanning }),
  setProgress: (progress) => set({ progress }),
  setResult: (result) =>
    set((s) => {
      const ids = new Set(result?.findings.map((f) => f.id) ?? []);
      const selectedIssueId = s.selectedIssueId && ids.has(s.selectedIssueId) ? s.selectedIssueId : null;
      // A new scan (another scanId) clears what the last one drew on the page.
      const sameScan = Boolean(result && s.result && result.scanId === s.result.scanId);
      return {
        result,
        selectedIssueId,
        view: s.view === "detail" && !selectedIssueId ? "list" : s.view,
        scanning: false,
        progress: null,
        showBadges: sameScan ? s.showBadges : false,
        filters: sameScan ? s.filters : { ...s.filters, groupId: null },
      };
    }),
  showToast: (toast) => set({ toast: { ...toast, id: ++toastCounter } }),
  dismissToast: () => set({ toast: null }),
  setView: (view) => set({ view }),
  selectIssue: (selectedIssueId) => set({ selectedIssueId }),
  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  setResultTab: (resultTab) => set({ resultTab }),
  toggleRuleExpanded: (ruleId) =>
    set((s) => ({ expandedRules: s.expandedRules.includes(ruleId) ? s.expandedRules.filter((k) => k !== ruleId) : [...s.expandedRules, ruleId] })),
  expandRule: (ruleId) => set((s) => (s.expandedRules.includes(ruleId) ? {} : { expandedRules: [...s.expandedRules, ruleId] })),
  setShowBadges: (showBadges) => set({ showBadges }),
  setAutoHighlight: (autoHighlight) => set({ autoHighlight }),
  updateIssues: (fn) => {
    const { result } = get();
    if (!result) return;
    set({ result: withFindings(result, result.findings.map(fn)) });
  },
}));

// ---------- Pure selectors / helpers ----------

export const SEVERITIES: Severity[] = ["High", "Medium", "Low"];

const SEVERITY_RANK: Record<Severity, number> = { High: 0, Medium: 1, Low: 2 };
export function severityRank(severity: Severity): number {
  return SEVERITY_RANK[severity];
}

/** A finding listed for the tester to judge; shown only in the Needs review tab. */
export function isNeedsReviewIssue(finding: Finding): boolean {
  return finding.type === "Review";
}

export function categoryOf(finding: Finding): RuleCategory | undefined {
  return getRule(finding.ruleId)?.category;
}

export function matchesTab(finding: Finding, tab: ResultTab): boolean {
  if (tab === "review") return isNeedsReviewIssue(finding);
  if (isNeedsReviewIssue(finding)) return false;
  if (tab === "all") return true;
  if (tab === "failed" || tab === "passed" || tab === "groups") return false;
  return categoryOf(finding) === tab;
}

function matchesSearch(finding: Finding, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const rule = getRule(finding.ruleId);
  const hay = [finding.ruleId, rule?.name ?? "", finding.message, finding.property, finding.element.selector, finding.element.html, finding.element.text].join("\n").toLowerCase();
  return q.split(/\s+/).every((term) => hay.includes(term));
}

export function matchesFilters(finding: Finding, f: Filters, tab: ResultTab = "all"): boolean {
  if (!matchesTab(finding, tab)) return false;
  if (f.statuses.length > 0 && !f.statuses.includes(finding.status)) return false;
  if (f.severities.length > 0 && !f.severities.includes(finding.severity)) return false;
  if (f.groupId !== null && finding.groupId !== f.groupId) return false;
  return matchesSearch(finding, f.search);
}

export interface FailedRule {
  ruleId: string;
  title: string;
  category: RuleCategory | undefined;
  /** Most severe instance. */
  severity: Severity;
  count: number;
  firstIssueId: string;
}

/**
 * Rules with at least one finding, most severe first. Honours the status
 * filter (like the tab counts) but not severity, group or search. Findings for
 * review do not make a rule fail.
 */
export function failedRules(result: ScanResult | null, f: Filters): FailedRule[] {
  if (!result) return [];
  const statusOnly: Filters = { ...DEFAULT_FILTERS, statuses: f.statuses };
  const byRule = new Map<string, FailedRule>();
  for (const finding of result.findings) {
    if (!matchesFilters(finding, statusOnly, "all")) continue;
    const existing = byRule.get(finding.ruleId);
    if (existing) {
      existing.count++;
      if (severityRank(finding.severity) < severityRank(existing.severity)) existing.severity = finding.severity;
      continue;
    }
    const rule = getRule(finding.ruleId);
    byRule.set(finding.ruleId, { ruleId: finding.ruleId, title: rule?.name ?? finding.ruleId, category: rule?.category, severity: finding.severity, count: 1, firstIssueId: finding.id });
  }
  return [...byRule.values()].sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || b.count - a.count || a.title.localeCompare(b.title));
}

/**
 * Badge numbers shown in the list MUST equal the numbers drawn by the on-page
 * overlay. The overlay numbers findings by their index in `result.findings`
 * (the content script holds the same order), so the number is always
 * `index + 1` in the unfiltered array, whatever the filters.
 */
export function issueNumbers(result: ScanResult | null): Map<string, number> {
  const map = new Map<string, number>();
  result?.findings.forEach((finding, index) => map.set(finding.id, index + 1));
  return map;
}
