/**
 * The consistency rules against real layout (PLAN.md, Phase 3A).
 *
 * Every fixture lists its seeded defects in its page. On the defects page each
 * defect must be reported, by its rule, on the element the defect names (or
 * inside it): as a definite finding, or for review when the fixture says so.
 * On the clean page no definite finding may be reported, under any tolerance
 * preset: any such finding is a bug in the rules. The only findings allowed
 * there are the ones the fixture lists as intentional, for review.
 */
import { test, expect } from "@playwright/test";
import type { TolerancePreset } from "@shared/types";
import catalogue from "../../shared/ui-rules.json" with { type: "json" };
import { readFileSync } from "node:fs";
import path from "node:path";
import { findAudit, findFindings, fixtureUrl, ROOT, type FoundFinding } from "./support/engine";

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
  },
};

/** Rules whose finding lands on an element without a data-fx name, because the defect changes more than its target. */
const UNNAMED: Record<string, string[]> = {
  // D4 changes the gaps of both columns; the manifest names the right one.
  compliance: ["LAY-03"],
  // D6 moves the location item of both event cards; the manifest names the first.
  dashboard: ["LAY-07"],
};

function describe(f: FoundFinding): string {
  return `${f.ruleId} on ${f.name}${f.within.length ? ` <${f.within[0]}>` : ""}: ${f.message}`;
}

test.describe("rules", () => {
  test("every rule of the catalogue is built", () => {
    expect(BUILT.size).toBe(catalogue.rules.length);
    expect(BUILT.size).toBe(27);
  });

  for (const name of FIXTURES) {
    test(`${name}-defects: every seeded defect of a built rule is found`, async ({ page }) => {
      await page.goto(fixtureUrl(`${name}-defects`));
      const { findings, expected } = await findFindings(page);
      const seeded = expected.filter((e) => e.rule !== null && BUILT.has(e.rule));
      expect(seeded.length, "the fixture must seed at least one defect of a built rule").toBeGreaterThan(0);

      for (const defect of seeded) {
        const hit = findings.find((f) => f.ruleId === defect.rule && f.within.includes(defect.target));
        expect(hit, `${defect.id}: ${defect.rule} must report <${defect.target}>. Reported:\n${findings.map(describe).join("\n")}`).toBeDefined();
        // A defect the fixture calls intentional is listed for review; every other one is a definite finding.
        expect(hit?.type, `${defect.id} ${defect.rule}`).toBe(defect.review ? "Review" : "Definite");
      }
    });

    test(`${name}-defects: nothing is reported outside the seeded defects`, async ({ page }) => {
      await page.goto(fixtureUrl(`${name}-defects`));
      const { findings, expected } = await findFindings(page);
      const targets = new Set(expected.map((e) => e.target));
      const also = ALSO_SEEDED[name] ?? {};
      for (const f of findings) {
        const seeded = f.within.some((fx) => targets.has(fx) || fx in also) || (f.within.length === 0 && (UNNAMED[name] ?? []).includes(f.ruleId));
        expect(seeded, `Not a seeded defect: ${describe(f)}`).toBe(true);
      }
      // One finding per rule and element.
      const keys = findings.map((f) => `${f.ruleId}|${f.element}`);
      expect(new Set(keys).size).toBe(keys.length);
    });

    for (const preset of PRESETS) {
      test(`${name}-clean: no definite finding (${preset})`, async ({ page }) => {
        await page.goto(fixtureUrl(`${name}-clean`));
        const { findings, expected, checked } = await findFindings(page, preset);
        expect(findings.filter((f) => f.type === "Definite").map(describe)).toEqual([]);
        // For review: only what the fixture lists as an intentional difference, and all of it.
        const intended = expected.filter((e) => e.both && e.review);
        const review = findings.filter((f) => f.type === "Review");
        for (const f of review) {
          expect(intended.some((e) => e.rule === f.ruleId && f.within.includes(e.target)), `Not listed by the fixture: ${describe(f)}`).toBe(true);
        }
        for (const e of intended) {
          expect(review.some((f) => f.ruleId === e.rule && f.within.includes(e.target)), `${e.id}: ${e.rule} must list <${e.target}> for review`).toBe(true);
        }
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
    // A grid may be spaced differently across and down: listed for review, not as a defect.
    expect(by("LAY-03", "holiday-grid")).toMatchObject({ type: "Review", severity: "Low", actual: "68px between columns, 19px between rows" });
    expect(by("LAY-03", "tile-5")).toMatchObject({ type: "Definite", kind: "outlier", property: "gap between part 1 and part 2", actual: "12px", expected: "4px" });
    // The tile is taller because of that gap, and the two tiles of its row with it: no size finding on top.
    expect(findings.filter((f) => f.ruleId === "LAY-05").map((f) => f.within[0])).toEqual(["avatar-2"]);
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

  test("the new findings say what was expected and what was found", async ({ page }) => {
    const by = (findings: FoundFinding[], rule: string, target: string): FoundFinding => {
      const f = findings.find((x) => x.ruleId === rule && x.within[0] === target);
      if (!f) throw new Error(`${rule} on <${target}> not found`);
      return f;
    };
    await page.goto(fixtureUrl("dashboard-defects"));
    const dashboard = (await findFindings(page)).findings;
    expect(by(dashboard, "TXT-03", "person-name-2")).toMatchObject({ kind: "outlier", type: "Definite", actual: 'typed " ..."', expected: "shortened by the browser" });
    expect(by(dashboard, "TYP-07", "ev-loc-1")).toMatchObject({ kind: "pair", type: "Review", group: -1, message: "Link underline differs between these two links: underlined, not underlined." });

    await page.goto(fixtureUrl("table-defects"));
    const table = (await findFindings(page)).findings;
    expect(by(table, "FMT-01", "date-7")).toMatchObject({ kind: "outlier", type: "Definite", property: "date format", actual: "Mon D, YYYY", expected: "DD/MM/YYYY" });
    expect(by(table, "TXT-03", "job-3").actual).toBe('typed " ..."');
    // Shortened text with no tooltip is not checked: that is a functional matter, not a visual inconsistency.
    expect(table.some((f) => f.message.includes("holds the full text"))).toBe(false);

    await page.goto(fixtureUrl("compliance-defects"));
    const compliance = (await findFindings(page)).findings.filter((f) => f.ruleId === "TXT-03");
    expect(compliance.map((f) => f.actual)).toEqual(['typed " ..." after a separator', 'typed " ..."', 'typed "..."']);
  });

  test("the audit lists the real scale of the dashboard", async ({ page }) => {
    await page.goto(fixtureUrl("dashboard-clean"));
    const audit = await findAudit(page);
    const values = (kind: string): string[] => audit[kind].values.map((v) => v.value);
    const flags = (kind: string): string[] => audit[kind].values.flatMap((v) => v.flags.map((f) => `${v.value} ${f.kind}`));
    // The values of the stylesheet of the fixture, nothing else.
    expect(values("fontFamily")).toEqual(["system-ui"]);
    expect(values("fontSize")).toEqual(["12px", "13px", "14px", "15px", "16px", "17px", "20px", "22px", "28px"]);
    expect(values("fontWeight")).toEqual(["400", "600", "700"]);
    expect(values("spacing")).toEqual(["4px", "8px", "10px", "12px", "13px", "14px", "15px", "16px", "20px", "24px", "25px", "26px", "28px", "35px", "36px"]);
    expect(values("color").sort()).toEqual(["rgb(107, 107, 107)", "rgb(11, 74, 143)", "rgb(17, 17, 17)", "rgb(199, 215, 234)", "rgb(220, 220, 220)", "rgb(242, 242, 242)", "rgb(255, 255, 255)", "rgb(51, 51, 51)"]);
    // "margin: 4px auto 0" centres a name: the px the layout gave it are not a spacing value.
    expect(audit.spacing.values.every((v) => Number.isInteger(Number.parseFloat(v.value)))).toBe(true);
    // Used once: the 14px of the button and the 28px of the page title; five spacing values.
    expect(flags("fontSize")).toEqual(["14px once", "28px once"]);
    expect(flags("spacing")).toEqual(["15px once", "25px once", "28px once", "35px once", "36px once"]);
    expect(audit.spacing.note).toContain("does not follow a 4px grid");
    // The card title size is used by the five card titles.
    expect(audit.fontSize.values.find((v) => v.value === "22px")?.count).toBe(5);

    // The defects page adds the values of its seeded defects.
    await page.goto(fixtureUrl("dashboard-defects"));
    const defects = await findAudit(page);
    const added = defects.spacing.values.map((v) => v.value).filter((v) => !values("spacing").includes(v));
    expect(added).toEqual(["19px", "29px", "39px", "50px", "68px"]);
  });

  test("the audit shows a size that only one list uses (compliance D7)", async ({ page }) => {
    // No rule reports D7: it is a page-wide observation. The audit must show the size and where it is used.
    await page.goto(fixtureUrl("compliance-defects"));
    const defects = (await findAudit(page)).fontSize.values.find((v) => v.value === "20px")!;
    await page.goto(fixtureUrl("compliance-clean"));
    const clean = (await findAudit(page)).fontSize.values.find((v) => v.value === "20px")!;
    expect(defects.within).toContain("status-list");
    expect(clean.within).not.toContain("status-list");
    expect(defects.count).toBeGreaterThan(clean.count);
  });

  test("the token check works with the sample token file", async ({ page }) => {
    const tokens = { name: "dashboard.tokens.json", text: readFileSync(path.join(ROOT, "fixtures", "tokens", "dashboard.tokens.json"), "utf8") };
    const off = (audit: Awaited<ReturnType<typeof findAudit>>): string[] => Object.values(audit).flatMap((l) => l.values.filter((v) => v.flags.some((f) => f.kind === "notToken")).map((v) => `${l.kind} ${v.value}`));

    // The clean page uses the tokens and nothing else.
    await page.goto(fixtureUrl("dashboard-clean"));
    const clean = await findAudit(page, tokens);
    expect(off(clean)).toEqual([]);
    expect(Object.values(clean).every((l) => l.values.every((v) => v.token && v.flags.length === 0))).toBe(true);
    expect(clean.fontSize.values.find((v) => v.value === "22px")?.token).toBe("typography.card-title.fontSize");
    expect(clean.color.values.find((v) => v.value === "rgb(11, 74, 143)")?.token).toBe("color.brand.primary");
    expect(clean.spacing.values.find((v) => v.value === "16px")?.token).toBe("space.4");
    expect(clean.spacing.note).toBe("Every value is a token of dashboard.tokens.json.");

    // The defects page: the values its seeded defects bring in are not tokens.
    await page.goto(fixtureUrl("dashboard-defects"));
    const defects = await findAudit(page, tokens);
    expect(off(defects)).toEqual(["spacing 19px", "spacing 29px", "spacing 39px", "spacing 50px", "spacing 68px"]);
    // The grey of the holiday tiles cannot be told from the page grey (Delta E below 1), so it counts as that token.
    expect(defects.color.values.find((v) => v.value === "rgb(245, 244, 244)")?.token).toBe("color.surface.page");
    expect(defects.spacing.values.find((v) => v.value === "29px")?.flags[0].message).toBe("Not a design token. The closest is space.7 (28px).");
    expect(defects.spacing.note).toBe("5 values are not in dashboard.tokens.json.");
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
