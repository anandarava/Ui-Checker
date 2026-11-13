import { describe, expect, it } from "vitest";
import { computeScore, scoreBand, summarize, withFindings } from "@shared/scoring";
import type { Finding, FindingStatus, FindingType, ScanResult, Severity } from "@shared/types";

let next = 0;
function finding(severity: Severity, groupId: string, extra: { status?: FindingStatus; type?: FindingType; ruleId?: string } = {}): Finding {
  next++;
  return {
    id: `f${next}`,
    fingerprint: `f${next}`,
    ruleId: extra.ruleId ?? "TYP-02",
    severity,
    type: extra.type ?? "Definite",
    status: extra.status ?? "new",
    kind: "outlier",
    groupId,
    element: { selector: `#el${next}`, html: "<p>", text: "", box: { x: 0, y: 0, width: 10, height: 10 } },
    property: "font size",
    expected: "16px",
    actual: "18px",
    values: [],
    message: "",
  };
}

describe("computeScore", () => {
  it("is 100 when nothing is open, and when there is nothing to compare", () => {
    expect(computeScore([], 10)).toBe(100);
    expect(computeScore([], 0)).toBe(100);
  });

  it("is the share of consistent groups, weighted by the most severe open finding of each group", () => {
    // 10 groups, one with a High finding: a whole group lost.
    expect(computeScore([finding("High", "g1")], 10)).toBe(90);
    // A Medium finding costs 3/7 of a group, a Low one 1/7.
    expect(computeScore([finding("Medium", "g1")], 10)).toBe(96);
    expect(computeScore([finding("Low", "g1")], 10)).toBe(99);
    // Several findings in one group count once, at the most severe.
    expect(computeScore([finding("High", "g1"), finding("Low", "g1"), finding("Medium", "g1")], 10)).toBe(90);
    // Every group with a High finding: 0.
    expect(computeScore([finding("High", "g1"), finding("High", "g2")], 2)).toBe(0);
  });

  it("does not punish a page for its size", () => {
    expect(computeScore([finding("High", "g1")], 10)).toBe(computeScore([finding("High", "g1"), finding("High", "g2")], 20));
  });

  it("leaves out findings for review and findings that were ignored, baselined or marked intentional", () => {
    const excluded: FindingStatus[] = ["ignored", "baselined", "intentional"];
    for (const status of excluded) expect(computeScore([finding("High", "g1", { status })], 10)).toBe(100);
    expect(computeScore([finding("High", "g1", { type: "Review" })], 10)).toBe(100);
  });

  it("counts the element of a finding outside any group as a unit of its own", () => {
    // 9 groups and one loose element: 10 units, one failed.
    expect(computeScore([finding("High", "")], 9)).toBe(90);
    // Ignoring it does not shrink the total: 10 units, none failed.
    expect(computeScore([finding("High", "", { status: "ignored" })], 9)).toBe(100);
  });
});

describe("summarize and withFindings", () => {
  it("counts open findings by severity, and the rest as review or excluded", () => {
    const findings = [finding("High", "g1"), finding("Medium", "g1"), finding("Medium", "g2"), finding("Low", "g3"), finding("Low", "g3", { type: "Review" }), finding("High", "g4", { status: "baselined" })];
    expect(summarize(findings)).toEqual({ high: 1, medium: 2, low: 1, review: 1, excluded: 1 });
  });

  it("recomputes the score, the counts and the rule outcomes", () => {
    const base: ScanResult = {
      scanId: "s",
      url: "https://example.test/",
      title: "",
      scannedAt: "",
      durationMs: 0,
      timings: { waitMs: 0, snapshotMs: 0, groupingMs: 0, rulesMs: 0 },
      engineVersion: "",
      score: 100,
      summary: { high: 0, medium: 0, low: 0, review: 0, excluded: 0 },
      options: { scope: "page", tolerancePreset: "normal", rules: [] },
      viewport: { width: 0, height: 0, devicePixelRatio: 1 },
      elementsScanned: 0,
      groups: Array.from({ length: 5 }, (_, i) => ({ id: `g${i + 1}`, kind: "sibling" as const, label: "", members: [] })),
      findings: [],
      rules: [
        { id: "TYP-02", outcome: "passed", groupsChecked: 3 },
        { id: "TYP-03", outcome: "passed", groupsChecked: 3 },
        { id: "LAY-09", outcome: "notApplicable", groupsChecked: 0 },
      ],
      notScanned: [],
      warnings: [],
    };
    const open = withFindings(base, [finding("High", "g1", { ruleId: "TYP-02" })]);
    expect(open.score).toBe(80);
    expect(open.summary.high).toBe(1);
    expect(open.rules.map((r) => r.outcome)).toEqual(["failed", "passed", "notApplicable"]);

    // Ignored: the rule passes again and the score is back at 100.
    const ignored = withFindings(open, open.findings.map((f) => ({ ...f, status: "ignored" as const })));
    expect(ignored.score).toBe(100);
    expect(ignored.summary).toMatchObject({ high: 0, excluded: 1 });
    expect(ignored.rules[0].outcome).toBe("passed");
  });

  it("names the score bands", () => {
    expect(scoreBand(95)).toBe("Good");
    expect(scoreBand(70)).toBe("Needs improvement");
    expect(scoreBand(30)).toBe("Poor");
  });
});
