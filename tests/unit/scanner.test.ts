import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RULES } from "@shared/rules";
import type { ScanOptions } from "@shared/types";
import { resolveScope, runScan } from "@src/content/scanner";

const OPTIONS: ScanOptions = { scope: "page", tolerancePreset: "normal", rules: [] };

/** jsdom does no layout: give every element a 10 x 10 box, except those marked data-zero. */
function stubLayout(): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const size = this.hasAttribute("data-zero") ? 0 : 10;
    return { x: 0, y: 0, top: 0, left: 0, right: size, bottom: size, width: size, height: size, toJSON: () => ({}) } as DOMRect;
  });
}

beforeEach(() => {
  stubLayout();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("resolveScope", () => {
  it("is the body for a full-page scan", () => {
    expect(resolveScope(OPTIONS)).toBe(document.body);
  });

  it("is the matched element for a selector scan", () => {
    document.body.innerHTML = `<main id="part"></main>`;
    expect(resolveScope({ ...OPTIONS, scope: "selector", selector: "#part" }).id).toBe("part");
  });

  it("explains a selector that matches nothing or is invalid", () => {
    expect(() => resolveScope({ ...OPTIONS, scope: "selector", selector: "#missing" })).toThrow(/No element matches/);
    expect(() => resolveScope({ ...OPTIONS, scope: "selector", selector: "!!" })).toThrow(/not a valid selector/);
  });
});

describe("runScan", () => {
  it("returns a complete result with one entry per rule of the catalogue", async () => {
    document.body.innerHTML = `<div><p>a</p><p>b</p></div>`;
    const stages: number[] = [];
    const result = await runScan(OPTIONS, (percent) => stages.push(percent));

    expect(result.scanId).toBeTruthy();
    expect(result.elementsScanned).toBe(4); // body, div, p, p
    expect(result.findings).toEqual([]);
    // The two paragraphs are peers.
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({ id: "g1", kind: "sibling" });
    expect(result.groups[0].members.map((m) => m.text)).toEqual(["a", "b"]);
    expect(result.groups[0].members[0].selector).toBe("p:nth-of-type(1)");
    expect(result.warnings).toEqual([]);
    expect(result.timings.snapshotMs).toBeGreaterThanOrEqual(0);
    expect(result.rules.map((r) => r.id)).toEqual(RULES.map((r) => r.id));
    expect(stages.at(-1)).toBe(100);
    expect(Number.isNaN(Date.parse(result.scannedAt))).toBe(false);
  });

  it("never reports a rule as passed before its check exists", async () => {
    const result = await runScan(OPTIONS);
    for (const rule of RULES.filter((r) => !r.implemented)) {
      expect(result.rules.find((r) => r.id === rule.id)?.outcome, rule.id).toBe("notImplemented");
    }
  });

  it("reports rules that are switched off or not asked for as disabled", async () => {
    const off = await runScan({ ...OPTIONS, disabledRules: ["TYP-01"] });
    expect(off.rules.find((r) => r.id === "TYP-01")?.outcome).toBe("disabled");

    const only = await runScan({ ...OPTIONS, rules: ["LAY-01"] });
    expect(only.rules.filter((r) => r.outcome !== "disabled").map((r) => r.id)).toEqual(["LAY-01"]);
  });
});
