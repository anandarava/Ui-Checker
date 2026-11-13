/**
 * Compares two scans by finding fingerprint: what is new, what was fixed and
 * what is unchanged (PLAN.md, Phase 6). Used by the Compare view of the panel;
 * pure, so it also runs in tests and in CI.
 */
import type { Finding, ScanResult } from "./types";

export interface ScanDiff {
  /** In the later scan only. */
  added: Finding[];
  /** In the earlier scan only. */
  fixed: Finding[];
  /** In both; the findings of the later scan. */
  unchanged: Finding[];
}

/** Only findings that count: open, and not listed for review. */
export function activeFindings(result: ScanResult): Finding[] {
  return result.findings.filter((f) => f.status === "new" && f.type === "Definite");
}

/** `before` is the earlier scan, `after` the later one. */
export function diffScans(before: ScanResult, after: ScanResult): ScanDiff {
  const earlier = activeFindings(before);
  // Match by occurrence: two findings sharing a fingerprint need two on the other side to be "unchanged".
  const unmatched = new Map<string, Finding[]>();
  for (const f of earlier) {
    const list = unmatched.get(f.fingerprint);
    if (list) list.push(f);
    else unmatched.set(f.fingerprint, [f]);
  }
  const added: Finding[] = [];
  const unchanged: Finding[] = [];
  for (const f of activeFindings(after)) {
    const list = unmatched.get(f.fingerprint);
    if (list && list.length > 0) {
      list.pop();
      unchanged.push(f);
    } else {
      added.push(f);
    }
  }
  const left = new Set([...unmatched.values()].flat());
  return { added, fixed: earlier.filter((f) => left.has(f)), unchanged };
}
