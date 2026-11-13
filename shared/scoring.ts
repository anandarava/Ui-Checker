/**
 * Consistency score and summary counts, shared by the extension, the reports
 * and CI. Follows the shape of the PalTech Accessibility Testing extension's
 * shared/scoring.ts: a weighted pass rate, where only open, definite findings
 * count.
 *
 *   score = round(100 x (1 - weight of the units with open findings / weight of all units))
 *
 * - A **unit** is a peer group the scan compared, or the element of a finding
 *   that is not about one group (an edge that misses a shared line). A page
 *   with many groups is therefore not punished for its size: what counts is the
 *   share of its groups that are inconsistent.
 * - A unit with open findings is weighted by its most severe one: High 7,
 *   Medium 3, Low 1. A unit without open findings counts as passed at the full
 *   weight (7), so a High finding costs a whole group, a Low one a seventh.
 * - Findings for review, and findings that were ignored, baselined or marked
 *   intentional, do not count.
 * - A page with nothing to compare scores 100.
 */
import type { Finding, ScanResult, ScanSummary, Severity } from "./types";

export const SEVERITY_WEIGHTS: Record<Severity, number> = { High: 7, Medium: 3, Low: 1 };
const FULL_WEIGHT = SEVERITY_WEIGHTS.High;

/** Open and definite: the findings that count as issues. */
export function isOpenIssue(f: Finding): boolean {
  return f.status === "new" && f.type === "Definite";
}

/** The unit a finding belongs to in the score. */
function unitOf(f: Finding): string {
  return f.groupId ? `group:${f.groupId}` : `element:${f.element.selector}`;
}

export function computeScore(findings: Finding[], groupCount: number): number {
  const failed = new Map<string, Severity>();
  const loose = new Set<string>();
  for (const f of findings) {
    const unit = unitOf(f);
    // Elements of findings outside any group are units too, open or not, so that
    // ignoring a finding does not shrink the total.
    if (!f.groupId && f.type === "Definite") loose.add(unit);
    if (!isOpenIssue(f)) continue;
    const previous = failed.get(unit);
    if (!previous || SEVERITY_WEIGHTS[f.severity] > SEVERITY_WEIGHTS[previous]) failed.set(unit, f.severity);
  }
  const total = (groupCount + loose.size) * FULL_WEIGHT;
  if (total === 0) return 100;
  let lost = 0;
  for (const severity of failed.values()) lost += SEVERITY_WEIGHTS[severity];
  return Math.max(0, Math.round(100 * (1 - lost / total)));
}

export function summarize(findings: Finding[]): ScanSummary {
  const summary: ScanSummary = { high: 0, medium: 0, low: 0, review: 0, excluded: 0 };
  for (const f of findings) {
    if (f.status !== "new") {
      summary.excluded++;
    } else if (f.type === "Review") {
      summary.review++;
    } else if (f.severity === "High") {
      summary.high++;
    } else if (f.severity === "Medium") {
      summary.medium++;
    } else {
      summary.low++;
    }
  }
  return summary;
}

/** Recomputes the derived fields of a result after its findings (or their statuses) changed. */
export function withFindings(result: ScanResult, findings: Finding[]): ScanResult {
  const open = new Set(findings.filter(isOpenIssue).map((f) => f.ruleId));
  return {
    ...result,
    findings,
    score: computeScore(findings, result.groups.length),
    summary: summarize(findings),
    // A rule whose findings are all excluded or for review no longer counts as failed.
    rules: result.rules.map((rule) => {
      if (rule.outcome !== "failed" && rule.outcome !== "passed") return rule;
      if (rule.groupsChecked === 0) return rule;
      return { ...rule, outcome: open.has(rule.id) ? "failed" : "passed" };
    }),
  };
}

/** Lighthouse-style bands; the label keeps the meaning from being colour-only. */
export function scoreBand(score: number): "Good" | "Needs improvement" | "Poor" {
  if (score >= 90) return "Good";
  if (score >= 50) return "Needs improvement";
  return "Poor";
}
