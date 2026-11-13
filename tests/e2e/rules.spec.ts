/**
 * The consistency rules against real layout (PLAN.md, Phase 3A).
 *
 * Every fixture lists its seeded defects in its page. On the defects page each
 * defect of a built rule must be reported, by that rule, on the element the
 * defect names (or inside it). On the clean page nothing may be reported, under
 * any tolerance preset: any finding there is a bug in the rules.
 */
import { test, expect } from "@playwright/test";
import type { TolerancePreset } from "@shared/types";
import catalogue from "../../shared/ui-rules.json" with { type: "json" };
import { findFindings, fixtureUrl, type FoundFinding } from "./support/engine";

test.use({ viewport: { width: 1440, height: 900 } });

const FIXTURES = ["dashboard", "table", "compliance", "grid-plain", "grid-utility", "grid-hashed"] as const;
const PRESETS: TolerancePreset[] = ["strict", "normal", "relaxed"];
const BUILT = new Set(catalogue.rules.filter((r) => r.implemented).map((r) => r.id));

/**
 * Elements a seeded defect also changes, besides the target it names. A finding
 * there is a consequence of that defect, not a false positive.
 */
const ALSO_SEEDED: Record<string, Record<string, string>> = {
  compliance: {
    // D1 gives three section titles three sizes; the manifest names one of them.
    "title-chart": "D1",
    // D4 changes the gaps of both columns; the manifest names the right one. The left column has no data-fx.
    "": "D4",
  },
};

function describe(f: FoundFinding): string {
  return `${f.ruleId} on ${f.name}${f.within.length ? ` <${f.within[0]}>` : ""}: ${f.message}`;
}

test.describe("rules", () => {
  test("ten core rules are built", () => {
    expect(Array.from(BUILT).sort()).toEqual(["LAY-01", "LAY-02", "LAY-03", "LAY-04", "LAY-05", "LAY-06", "TYP-01", "TYP-02", "TYP-03", "TYP-05"]);
  });

  for (const name of FIXTURES) {
    test(`${name}-defects: every seeded defect of a built rule is found`, async ({ page }) => {
      await page.goto(fixtureUrl(`${name}-defects`));
      const { findings, expected } = await findFindings(page);
      const seeded = expected.filter((e) => e.rule !== null && BUILT.has(e.rule) && !e.review);
      expect(seeded.length, "the fixture must seed at least one defect of a built rule").toBeGreaterThan(0);

      for (const defect of seeded) {
        const hit = findings.find((f) => f.ruleId === defect.rule && f.within.includes(defect.target));
        expect(hit, `${defect.id}: ${defect.rule} must report <${defect.target}>. Reported:\n${findings.map(describe).join("\n")}`).toBeDefined();
        expect(hit?.type).toBe("Definite");
      }
    });

    test(`${name}-defects: nothing is reported outside the seeded defects`, async ({ page }) => {
      await page.goto(fixtureUrl(`${name}-defects`));
      const { findings, expected } = await findFindings(page);
      const targets = new Set(expected.map((e) => e.target));
      const also = ALSO_SEEDED[name] ?? {};
      for (const f of findings) {
        const seeded = f.within.some((fx) => targets.has(fx) || fx in also) || (f.within.length === 0 && "" in also && f.ruleId === "LAY-03");
        expect(seeded, `Not a seeded defect: ${describe(f)}`).toBe(true);
      }
      // One finding per rule and element.
      const keys = findings.map((f) => `${f.ruleId}|${f.element}`);
      expect(new Set(keys).size).toBe(keys.length);
    });

    for (const preset of PRESETS) {
      test(`${name}-clean: no finding (${preset})`, async ({ page }) => {
        await page.goto(fixtureUrl(`${name}-clean`));
        const { findings, checked } = await findFindings(page, preset);
        expect(findings.map(describe)).toEqual([]);
        // "No finding" must mean the rules looked and found nothing.
        expect(Object.values(checked).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
      });
    }
  }

  test("the three card grids give the same findings", async ({ page }) => {
    const results: string[] = [];
    for (const name of ["grid-plain", "grid-utility", "grid-hashed"]) {
      await page.goto(fixtureUrl(`${name}-defects`));
      const { findings } = await findFindings(page);
      results.push(JSON.stringify(findings.map(({ name: _name, ...f }) => f)));
    }
    expect(results[1]).toBe(results[0]);
    expect(results[2]).toBe(results[0]);
  });

  test("the findings say what was expected and what was found", async ({ page }) => {
    await page.goto(fixtureUrl("dashboard-defects"));
    const { findings } = await findFindings(page);
    const by = (rule: string, target: string): FoundFinding => {
      const f = findings.find((x) => x.ruleId === rule && x.within.includes(target));
      if (!f) throw new Error(`${rule} on <${target}> not found`);
      return f;
    };
    expect(by("TYP-02", "who-name")).toMatchObject({ kind: "outlier", severity: "High", property: "font size", actual: "22px", expected: "17px" });
    expect(by("LAY-01", "card-org")).toMatchObject({ kind: "outlier", severity: "High", actual: "top 29px", expected: "top 20px" });
    expect(by("LAY-02", "card-details")).toMatchObject({ actual: "bottom 68px, top 20px" });
    expect(by("LAY-05", "avatar-2")).toMatchObject({ actual: "44 × 44px", expected: "40 × 40px" });
    expect(by("LAY-06", "holiday-grid")).toMatchObject({ actual: "70px", expected: "20px" });
    expect(by("LAY-03", "holiday-grid").actual).toBe("68px between columns, 19px between rows");
    expect(by("LAY-04", "who").message).toBe("The top edge of this element is 4px lower than its 2 peers.");
    expect(by("LAY-04", "page-title").message).toContain("4px to the right of the edge that");
    expect(by("TYP-05", "ev-loc-1")).toMatchObject({ actual: "rgb(11, 74, 143)", expected: "rgb(17, 17, 17)" });
  });

  test("a relaxed preset keeps the clear defects and drops the small ones", async ({ page }) => {
    await page.goto(fixtureUrl("dashboard-defects"));
    const normal = (await findFindings(page, "normal")).findings.map((f) => `${f.ruleId}|${f.within[0]}`);
    await page.goto(fixtureUrl("dashboard-defects"));
    const relaxed = (await findFindings(page, "relaxed")).findings.map((f) => `${f.ruleId}|${f.within[0]}`);
    // 4px misalignments are within the relaxed tolerance; the 50px inset and the font size are not.
    expect(normal).toContain("LAY-04|page-title");
    expect(relaxed).not.toContain("LAY-04|page-title");
    expect(relaxed).toContain("LAY-06|holiday-grid");
    expect(relaxed).toContain("TYP-02|who-name");
    for (const key of relaxed) expect(normal).toContain(key);
  });

  test("runs on 5,000 elements well inside the scan budget", async ({ page }) => {
    await page.setContent(`<!doctype html>
      <style>
        body { margin: 0; font: 14px/1.4 Arial, sans-serif; }
        main { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; padding: 16px; }
        article { padding: 12px; border: 1px solid #ccc; border-radius: 8px; }
        .row { display: flex; gap: 8px; align-items: center; }
      </style>
      <main></main>
      <script>
        const card = '<article><h3>Card title</h3><p>Some text with a <a href="#">link</a>.</p>' +
          '<div class="row"><span>One</span><span>Two</span><button type="button">Go</button></div></article>';
        document.querySelector("main").innerHTML = card.repeat(650);
      </script>`);
    const { findings, durationMs } = await findFindings(page);
    expect(findings.map(describe)).toEqual([]);
    // Snapshot (1.5 s), grouping and rules must fit in 3 s together (PLAN.md, Success measures).
    expect(durationMs).toBeLessThan(1000);
  });
});
