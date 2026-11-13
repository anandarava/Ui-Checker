/**
 * Shared data model: what a scan produces and what the UI, the reports and CI read.
 *
 * Nothing here is specific to one application. A finding always describes a
 * difference between an element and its peers on the same page.
 */

export type Severity = "High" | "Medium" | "Low";

/** Result tabs: Typography / Layout & spacing / Group structure / Box style / Text & content. */
export type RuleCategory = "typography" | "layout" | "group" | "box" | "content";

/** "3A" core rules are built first, "3B" is the second wave (PLAN.md, Phase 3); "5" came with the page-wide audit, "6" with the broken-image check. */
export type RulePhase = "3A" | "3B" | "5" | "6";

export type ToleranceUnit = "px" | "ratio" | "deltaE" | "exact";

export type TolerancePreset = "strict" | "normal" | "relaxed";

/** Multiplier each preset applies to every rule's default tolerance. */
export const PRESET_FACTOR: Record<TolerancePreset, number> = { strict: 0.5, normal: 1, relaxed: 2 };

/** One entry of the rule catalogue (shared/ui-rules.json). */
export interface RuleDef {
  id: string;
  name: string;
  category: RuleCategory;
  phase: RulePhase;
  /** What the rule checks, in one sentence. */
  description: string;
  /** How to fix a finding of this rule. */
  fix: string;
  severity: Severity;
  /** Absent for rules that have nothing to tune. */
  tolerance?: { value: number; unit: ToleranceUnit };
  /** On by default. */
  enabled: boolean;
  /** False until the rule's check exists in the engine; such rules are reported as "notImplemented". */
  implemented: boolean;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A page element as the UI and reports refer to it. */
export interface ElementRef {
  selector: string;
  /** Opening tag and a short part of the content. */
  html: string;
  /** Trimmed text, at most 40 characters. */
  text: string;
  /** Position in page coordinates (CSS px). */
  box: Box;
  /** Frame the element is in; 0 or absent = top frame. */
  frameId?: number;
  /**
   * States that make the element look different from its peers on purpose,
   * read from ARIA and standard attributes: "selected", "current", "pressed",
   * "checked", "expanded", "disabled". "active (guessed)" marks the one member
   * of a group of links or buttons that has no such attribute but differs in
   * several style properties at once.
   */
  state?: string[];
}

/**
 * How a peer group was found (PLAN.md, Phase 2):
 *  sibling - same parent, same structure
 *  cousin  - same structure at the same depth, different parents
 *  level   - same layout level and same kind of box, different content
 *  role    - the same part ("title", "date line") inside the members of another group
 */
export type PeerGroupKind = "sibling" | "cousin" | "level" | "role";

export interface PeerGroup {
  id: string;
  kind: PeerGroupKind;
  /** Short description for the UI, e.g. "6 boxes in a grid". Built from structure, never from app text. */
  label: string;
  members: ElementRef[];
  /** Group this one was derived from (role groups). */
  parentGroupId?: string;
}

/** "Definite" counts toward the score; "Review" is listed on the Needs review tab only. */
export type FindingType = "Definite" | "Review";

export type FindingStatus = "new" | "ignored" | "baselined" | "intentional";

/**
 * What a finding is about:
 *  outlier    - a clear majority exists and this element differs from it
 *  pair       - a group of two whose members differ (no "expected" value)
 *  noMajority - the group has no consistent value at all
 */
export type FindingKind = "outlier" | "pair" | "noMajority";

/** A stretch that a rule measured, drawn on the page as a redline. */
export interface Mark {
  /** Page coordinates (CSS px) of the top document. */
  box: Box;
  /** The size that was measured, e.g. "29px". */
  label?: string;
}

export interface Finding {
  id: string;
  /** Stable across scans of the same page: baselines and scan comparison key on it. */
  fingerprint: string;
  ruleId: string;
  severity: Severity;
  type: FindingType;
  status: FindingStatus;
  kind: FindingKind;
  /** The peer group that was compared; empty for a check that is not about one group. */
  groupId: string;
  element: ElementRef;
  /** What was compared, e.g. "font-size", "left inset". */
  property: string;
  /** The majority value; null for "pair" and "noMajority" findings. */
  expected: string | null;
  actual: string;
  /** Every value in the group with its count, e.g. [{ value: "16px", count: 5 }, { value: "18px", count: 1 }]. */
  values: Array<{ value: string; count: number }>;
  /** Plain-language sentence shown in the list. */
  message: string;
  /** Findings on descendants that this finding explains (same offset) and that were folded into it. */
  foldedCount?: number;
  /** Why the tester ignored it, baselined it or marked it intentional. */
  reason?: string;
  /** What was measured, for the redline overlay and the report screenshots. */
  marks?: Mark[];
  /** Screenshot taken for a report. */
  evidence?: Evidence;
}

/** What the design-scale audit lists (PLAN.md, Phase 5). */
export type ScaleKind = "fontFamily" | "fontSize" | "fontWeight" | "spacing" | "color";

/**
 * Why a value of the scale stands out:
 *  once          - used by a single element
 *  offGrid       - a spacing value that is not a multiple of the grid the page follows
 *  nearDuplicate - a colour that is almost another, more used colour
 *  notToken      - not one of the team's design tokens (only when a token file is loaded)
 */
export type ScaleFlagKind = "once" | "offGrid" | "nearDuplicate" | "notToken";

export interface ScaleFlag {
  kind: ScaleFlagKind;
  /** Plain-language sentence, e.g. "Close to rgb(11, 74, 143), which is used 12 times". */
  message: string;
}

/** One value of the page's scale, with how often it is used. */
export interface ScaleValue {
  /** As shown: "16px", "Arial", "600", "rgb(11, 74, 143)". */
  value: string;
  /** Elements that use it. */
  count: number;
  /** Where it is used when that matters, e.g. "text 12, background 3" or "padding 8, gap 2". */
  detail?: string;
  /** The first few elements that use it; the page can outline all of them. */
  samples: ElementRef[];
  flags: ScaleFlag[];
  /** Name of the design token it matches (only when a token file is loaded). */
  token?: string;
}

export interface ScaleList {
  kind: ScaleKind;
  /** Most used first, except sizes and spacing, which go from small to large. */
  values: ScaleValue[];
  /** What the list was checked against, e.g. "This page follows a 4px grid (92% of the spacing values)". */
  note?: string;
}

/** The page-wide inventory of fonts, sizes, weights, spacing and colours. */
export interface DesignAudit {
  lists: ScaleList[];
  /** Name of the token file the values were checked against; absent when none is loaded. */
  tokenFile?: string;
}

/** One design token of the team's token file, already read into a comparable value. */
export interface DesignToken {
  /** Path in the token file, e.g. "color.brand.primary". */
  name: string;
  /** Lengths in px, weights as numbers, colours as "rgb(r, g, b)", families as written. */
  value: string | number;
}

/** The team's design tokens, by what they describe. A kind with no tokens is not checked. */
export interface DesignTokens {
  /** File name, shown in the UI and the reports. */
  name: string;
  fontFamily: DesignToken[];
  fontSize: DesignToken[];
  fontWeight: DesignToken[];
  spacing: DesignToken[];
  color: DesignToken[];
}

export interface Evidence {
  /** PNG data URL of the element, cropped, with the measurement drawn on it. */
  screenshot?: string;
  capturedAt?: string;
}

export type ExportFormat = "html" | "json";

export type RuleOutcome = "passed" | "failed" | "notApplicable" | "notImplemented" | "disabled";

export interface RuleResult {
  id: string;
  outcome: RuleOutcome;
  /** Number of peer groups the rule looked at. */
  groupsChecked: number;
}

/** Counts of the findings of a scan. Only open findings are counted by severity. */
export interface ScanSummary {
  high: number;
  medium: number;
  low: number;
  /** Open findings listed for review; not counted as issues. */
  review: number;
  /** Ignored, baselined or marked intentional. */
  excluded: number;
}

/** A finding the tester excluded, remembered for the site so later scans keep the decision. */
export interface StoredStatus {
  fingerprint: string;
  ruleId: string;
  selector: string;
  status: Exclude<FindingStatus, "new">;
  reason: string;
  createdAt: string;
}

export interface ScanOptions {
  scope: "page" | "selector";
  selector?: string;
  tolerancePreset: TolerancePreset;
  /** Rule ids to run; empty means all enabled rules. */
  rules: string[];
  /** Rule ids the user switched off. */
  disabledRules?: string[];
  minGroupSize?: number;
  /** Tolerances set for single rules, by rule id; they override the preset. */
  tolerances?: Record<string, number>;
  /** The team's design tokens: the design scale is checked against them instead of the page's own majority. */
  tokens?: DesignTokens | null;
}

export interface ScanResult {
  scanId: string;
  url: string;
  title: string;
  /** ISO timestamp. */
  scannedAt: string;
  durationMs: number;
  /** Parts of `durationMs`: waiting for the page to be ready, reading it, finding the peer groups and running the rules. */
  timings: { waitMs: number; snapshotMs: number; groupingMs: number; rulesMs: number };
  engineVersion: string;
  /** Consistency score, 0 to 100 (shared/scoring.ts). */
  score: number;
  summary: ScanSummary;
  options: ScanOptions;
  viewport: { width: number; height: number; devicePixelRatio: number };
  /** Visible elements measured. */
  elementsScanned: number;
  groups: PeerGroup[];
  findings: Finding[];
  rules: RuleResult[];
  /** The design scale of the page (PLAN.md, Phase 5); absent in results of older scans. */
  audit?: DesignAudit;
  /** The parts the page shares with the other pages of its site; a site scan compares them across pages. */
  parts?: SharedPart[];
  /** Parts of the page the scan could not read (closed shadow roots, cross-origin frames, canvas...). */
  notScanned: string[];
  /** Things that make the measurements less reliable (fonts still loading, layout still changing). */
  warnings: string[];
}

/**
 * A part a page shares with the other pages of its site: the page title, the
 * header, the navigation, the footer or a tab bar (src/content/parts.ts).
 */
export interface SharedPart {
  /** The same part has the same key on every page: "pageTitle", "navigation:side:1"... */
  key: string;
  kind: "pageTitle" | "header" | "navigation" | "footer" | "tabs";
  /** As shown: "Page title", "Side navigation". */
  name: string;
  element: ElementRef;
  /** The text of a page title. */
  text?: string;
  /** Text style of the part (of its first item with text, for a navigation or tab bar) and the background behind it. */
  style: { fontFamily: string; fontSize: number; fontWeight: number; color: string; backgroundColor: string };
  /** The links, buttons or tabs of a navigation or tab bar, in order. */
  items?: Array<{ text: string; icon: boolean }>;
}

/** What the list of saved scans shows; the full result is loaded only when a scan is opened. */
export interface SavedScanMeta {
  id: string;
  name: string;
  url: string;
  title: string;
  /** When the scan ran. */
  scannedAt: string;
  /** When it was saved. */
  savedAt: string;
  score: number;
  summary: ScanSummary;
  tolerancePreset: TolerancePreset;
  scope: ScanOptions["scope"];
  /** Open issues (not for review, not excluded). */
  issueCount: number;
}

export interface SavedScan {
  meta: SavedScanMeta;
  result: ScanResult;
}

/** Why the panel offers a rescan: the page went to another route, opened a dialog, or changed a lot. */
export type PageChangeReason = "route" | "dialog" | "dom";

export interface Settings {
  /** Name shown as "Prepared by" on HTML reports. */
  reportPreparedBy: string;
  /** Organisation (client or company) shown on HTML reports. */
  reportOrganisation: string;
  tolerancePreset: TolerancePreset;
  /** Rule ids switched off by the user. */
  disabledRules: string[];
  /** Smallest number of members a peer group needs before it is compared. */
  minGroupSize: number;
  /** Tolerances the user set for single rules, by rule id; they override the preset. */
  ruleTolerances: Record<string, number>;
}

export const DEFAULT_SETTINGS: Settings = {
  reportPreparedBy: "",
  reportOrganisation: "",
  tolerancePreset: "normal",
  disabledRules: [],
  minGroupSize: 2,
  ruleTolerances: {},
};
