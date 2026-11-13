/**
 * Consistency rules (PLAN.md, Phase 3). Each rule compares the members of the
 * peer groups and reports the ones that differ from the others. Rules read the
 * snapshot and the groups only; they never touch the live DOM.
 *
 * Built: the core rules of Phase 3A. A rule without a check is not run and is
 * reported as "notImplemented" by the scanner.
 */
import { getRule, toleranceFor } from "@shared/rules";
import { PRESET_FACTOR, type FindingKind, type FindingType, type ScanOptions, type Severity } from "@shared/types";
import { createFacts, type Facts } from "../facts";
import type { RawGroup } from "../grouping";
import type { ElementSnapshot } from "../snapshot";
import type { Verdict } from "./compare";
import { runLayoutRules } from "./layout";
import { runTypographyRules } from "./typography";

/** A finding before the element is described for the UI. */
export interface RawFinding {
  ruleId: string;
  /** Snapshot index of the element the finding points at. */
  element: number;
  /** Index of the peer group that was compared; -1 for a check that is not about one group. */
  group: number;
  kind: FindingKind;
  severity: Severity;
  type: FindingType;
  property: string;
  expected: string | null;
  actual: string;
  values: Array<{ value: string; count: number }>;
  message: string;
}

export interface RuleRun {
  findings: RawFinding[];
  /** Rule id -> number of peer groups (or containers) the rule looked at. */
  checked: Map<string, number>;
}

export interface RuleContext {
  elements: ElementSnapshot[];
  groups: RawGroup[];
  /** Group indexes, largest group first: a finding in a large group is not repeated by a group inside it. */
  order: number[];
  facts: Facts;
  /** True when the rule is built, enabled and asked for. */
  runs(ruleId: string): boolean;
  /** The rule's tolerance under the scan's preset. */
  tolerance(ruleId: string): number;
  /** Multiplier of the scan's preset: 0.5 strict, 1 normal, 2 relaxed. */
  factor: number;
  /** Counts one group (or container) as looked at by the rule. */
  looked(ruleId: string): void;
  /** True when the rule already reported this element. */
  reported(ruleId: string, element: number): boolean;
  report(finding: Omit<RawFinding, "severity" | "type"> & { severity?: Severity; type?: FindingType }): void;
  /** Severity of a finding of this rule, from how clear the verdict is. */
  severity(ruleId: string, verdict: Verdict<unknown>): Severity;
}

const ORDER: Severity[] = ["Low", "Medium", "High"];

function cap(severity: Severity, max: Severity): Severity {
  return ORDER.indexOf(severity) > ORDER.indexOf(max) ? max : severity;
}

export function runRules(elements: ElementSnapshot[], groups: RawGroup[], options: ScanOptions, ruleIds: string[]): RuleRun {
  const active = new Set(ruleIds);
  const findings: RawFinding[] = [];
  const checked = new Map<string, number>();
  const seen = new Set<string>();
  const factor = PRESET_FACTOR[options.tolerancePreset] ?? 1;

  const context: RuleContext = {
    elements,
    groups,
    order: groups.map((_, i) => i).sort((a, b) => groups[b].members.length - groups[a].members.length || a - b),
    facts: createFacts(elements),
    runs: (ruleId) => active.has(ruleId),
    tolerance: (ruleId) => {
      const rule = getRule(ruleId);
      return rule ? (toleranceFor(rule, options.tolerancePreset) ?? 0) : 0;
    },
    factor,
    looked: (ruleId) => checked.set(ruleId, (checked.get(ruleId) ?? 0) + 1),
    reported: (ruleId, element) => seen.has(`${ruleId}|${element}`),
    report: (finding) => {
      const key = `${finding.ruleId}|${finding.element}`;
      if (seen.has(key) || !active.has(finding.ruleId)) return;
      seen.add(key);
      findings.push({ severity: getRule(finding.ruleId)?.severity ?? "Medium", type: "Definite", ...finding });
    },
    severity: (ruleId, verdict) => {
      const base = getRule(ruleId)?.severity ?? "Medium";
      // A clear outlier keeps the rule's severity; anything less certain is Medium at most.
      return verdict.kind === "outlier" && verdict.strong ? base : cap(base, "Medium");
    },
  };

  runTypographyRules(context);
  runLayoutRules(context);

  // Document order, so the list reads top to bottom.
  findings.sort((a, b) => a.element - b.element || a.ruleId.localeCompare(b.ruleId));
  return { findings, checked };
}
