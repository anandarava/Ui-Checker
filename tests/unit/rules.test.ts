import { describe, expect, it } from "vitest";
import { CATEGORY_LABEL, RULES, getRule, rulesToRun, toleranceFor } from "@shared/rules";

describe("rule catalogue", () => {
  it("has unique, well-formed ids", () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^(TYP|LAY|GRP|BOX)-\d{2}$/);
  });

  it("gives every rule a name, a description, a fix and a known category", () => {
    for (const rule of RULES) {
      expect(rule.name.length, rule.id).toBeGreaterThan(3);
      expect(rule.description.length, rule.id).toBeGreaterThan(10);
      expect(rule.fix.length, rule.id).toBeGreaterThan(10);
      expect(Object.keys(CATEGORY_LABEL), rule.id).toContain(rule.category);
      expect(["High", "Medium", "Low"], rule.id).toContain(rule.severity);
    }
  });

  it("puts the id prefix and the category in step", () => {
    const prefix = { typography: "TYP", layout: "LAY", group: "GRP", box: "BOX" } as const;
    for (const rule of RULES) expect(rule.id.startsWith(prefix[rule.category]), rule.id).toBe(true);
  });

  it("marks exactly the core rules of the plan as phase 3A", () => {
    const core = RULES.filter((r) => r.phase === "3A").map((r) => r.id).sort();
    expect(core).toEqual(["LAY-01", "LAY-02", "LAY-03", "LAY-04", "LAY-05", "LAY-06", "TYP-01", "TYP-02", "TYP-03", "TYP-05"]);
  });

  it("uses positive tolerances, and ratios above 1", () => {
    for (const rule of RULES) {
      if (!rule.tolerance) continue;
      expect(rule.tolerance.value, rule.id).toBeGreaterThan(0);
      if (rule.tolerance.unit === "ratio") expect(rule.tolerance.value, rule.id).toBeGreaterThan(1);
    }
  });
});

describe("toleranceFor", () => {
  const px = getRule("LAY-01")!;
  const ratio = getRule("LAY-02")!;
  const exact = getRule("TYP-01")!;

  it("scales a px tolerance with the preset", () => {
    expect(toleranceFor(px, "strict")).toBe(1);
    expect(toleranceFor(px, "normal")).toBe(2);
    expect(toleranceFor(px, "relaxed")).toBe(4);
  });

  it("scales only the part of a ratio above 1", () => {
    expect(toleranceFor(ratio, "strict")).toBe(1.25);
    expect(toleranceFor(ratio, "normal")).toBe(1.5);
    expect(toleranceFor(ratio, "relaxed")).toBe(2);
  });

  it("has no tolerance for exact-match rules", () => {
    expect(toleranceFor(exact, "normal")).toBeUndefined();
  });
});

describe("rulesToRun", () => {
  it("runs every enabled rule by default", () => {
    expect(rulesToRun({ disabledRules: [] })).toHaveLength(RULES.filter((r) => r.enabled).length);
  });

  it("leaves out rules the user switched off", () => {
    const ids = rulesToRun({ disabledRules: ["TYP-02"] }).map((r) => r.id);
    expect(ids).not.toContain("TYP-02");
    expect(ids).toContain("TYP-01");
  });

  it("narrows to the rules asked for", () => {
    expect(rulesToRun({ disabledRules: ["LAY-01"] }, ["LAY-01", "LAY-02"]).map((r) => r.id)).toEqual(["LAY-02"]);
  });
});
