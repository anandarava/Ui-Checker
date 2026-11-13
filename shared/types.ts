/**
 * Shared data model: what a scan produces and what the UI, the reports and CI read.
 *
 * Nothing here is specific to one application. A finding always describes a
 * difference between an element and its peers on the same page.
 */

export type Severity = "High" | "Medium" | "Low";

/** Result tabs: Typography / Layout & spacing / Group structure / Box style. */
export type RuleCategory = "typography" | "layout" | "group" | "box";

/** "3A" core rules are built first, "3B" is the second wave (see PLAN.md, Phase 3). */
export type RulePhase = "3A" | "3B";

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
  /** Parts of the page the scan could not read (closed shadow roots, cross-origin frames, canvas...). */
  notScanned: string[];
  /** Things that make the measurements less reliable (fonts still loading, layout still changing). */
  warnings: string[];
}

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
}

export const DEFAULT_SETTINGS: Settings = {
  reportPreparedBy: "",
  reportOrganisation: "",
  tolerancePreset: "normal",
  disabledRules: [],
  minGroupSize: 2,
};
