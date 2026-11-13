import { describe, expect, it } from "vitest";
import { buildReport, reportFilename } from "@src/background/exporters";
import { buildHtmlReport, escapeHtml } from "@src/background/exporters/html-report";
import { buildJsonReportDocument, JSON_SCREENSHOT_BUDGET_BYTES } from "@src/background/exporters/json-report";
import { withFindings } from "@shared/scoring";
import type { Finding, ScanResult } from "@shared/types";

const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function finding(patch: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    fingerprint: "abc12345",
    ruleId: "TYP-02",
    severity: "High",
    type: "Definite",
    status: "new",
    kind: "outlier",
    groupId: "g1",
    element: { selector: "div.card > h2", html: '<h2 class="title">Mobile app</h2>', text: "Mobile app", box: { x: 10, y: 20, width: 200, height: 24 } },
    property: "font size",
    expected: "16px",
    actual: "18px",
    values: [
      { value: "16px", count: 5 },
      { value: "18px", count: 1 },
    ],
    message: "Font size is 18px; 5 of the 6 elements in this group use 16px.",
    ...patch,
  };
}

function result(findings: Finding[]): ScanResult {
  const base: ScanResult = {
    scanId: "scan-1",
    url: "https://app.example.test/dashboard",
    title: "Dashboard",
    scannedAt: "2026-11-13T10:00:00.000Z",
    durationMs: 120,
    timings: { waitMs: 100, snapshotMs: 10, groupingMs: 5, rulesMs: 5 },
    engineVersion: "0.5.0",
    score: 100,
    summary: { high: 0, medium: 0, low: 0, review: 0, excluded: 0 },
    options: { scope: "page", tolerancePreset: "normal", rules: [] },
    viewport: { width: 1440, height: 900, devicePixelRatio: 1 },
    elementsScanned: 135,
    groups: [
      { id: "g1", kind: "role", label: "6 headings: the same part of 6 boxes", members: [] },
      { id: "g2", kind: "sibling", label: "6 boxes in a grid", members: [] },
    ],
    findings: [],
    rules: [
      { id: "TYP-02", outcome: "failed", groupsChecked: 4 },
      { id: "TYP-03", outcome: "passed", groupsChecked: 4 },
      { id: "LAY-09", outcome: "notApplicable", groupsChecked: 0 },
    ],
    notScanned: [],
    warnings: [],
  };
  return withFindings(base, findings);
}

describe("HTML report", () => {
  it("has the two parts, the score, the verdict and the finding with expected and found values", () => {
    const html = buildHtmlReport(result([finding()]), { preparedBy: "QA team", organisation: "Example Ltd" });
    expect(html).toContain("<title>UI consistency report: Dashboard</title>");
    expect(html).toContain('<div class="part first" id="part-summary"><h2>Summary</h2></div>');
    expect(html).toContain('<div class="part" id="part-dev"><h2>Developer details</h2>');
    expect(html).toContain("Inconsistent: 1 high-severity issue");
    expect(html).toContain('aria-label="Consistency score 50 out of 100"');
    expect(html).toContain("Fix these first");
    expect(html).toContain("Where it shows");
    expect(html).toContain("G1 · 6 headings: the same part of 6 boxes");
    expect(html).toContain("Font size differs");
    expect(html).toContain('<span class="bad">18px</span>');
    expect(html).toContain('<span class="ok">16px</span>');
    expect(html).toContain("16px × 5, 18px × 1");
    expect(html).toContain("Prepared by</dt><dd>QA team");
    expect(html).toContain("Organisation</dt><dd>Example Ltd");
    // Self-contained: no scripts, nothing fetched.
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("default-src 'none'");
  });

  it("lists the design scale with the values that stand out", () => {
    const withAudit: ScanResult = {
      ...result([]),
      audit: {
        lists: [
          { kind: "fontSize", values: [{ value: "16px", count: 28, samples: [{ selector: "p.body", html: "<p>", text: "x", box: { x: 0, y: 0, width: 1, height: 1 } }], flags: [] }, { value: "14px", count: 1, samples: [], flags: [{ kind: "once", message: "Used by one element only." }] }] },
          { kind: "color", note: "<note>", values: [{ value: "rgb(11, 74, 143)", count: 17, detail: "text 17", samples: [], flags: [], token: "color.brand" }, { value: 'red" onload="x', count: 1, samples: [], flags: [] }] },
        ],
      },
    };
    const html = buildHtmlReport(withAudit);
    expect(html).toContain('id="h-scale"');
    expect(html).toContain('<a href="#h-scale">Design scale</a>');
    expect(html).toContain("Font sizes (2)");
    expect(html).toContain("<code>p.body</code>");
    expect(html).toContain("and 27 more");
    expect(html).toContain("Used by one element only.");
    expect(html).toContain("1 value stands out.");
    expect(html).toContain("color.brand");
    expect(html).toContain('style="background:rgb(11, 74, 143)"');
    // Only a colour the browser computed is drawn; everything from the page is escaped.
    expect(html).not.toContain('style="background:red');
    expect(html).toContain("&lt;note&gt;");
    expect(html).toContain("No design tokens were loaded");
    expect(buildHtmlReport({ ...withAudit, audit: { ...withAudit.audit!, tokenFile: "team.tokens.json" } })).toContain("design tokens of <strong>team.tokens.json</strong>");
    // A result of an older scan has no design scale.
    expect(buildHtmlReport(result([]))).not.toContain('id="h-scale"');
  });

  it("says so when nothing was found", () => {
    const html = buildHtmlReport(result([]));
    expect(html).toContain("Consistent: no issues found");
    expect(html).toContain("Nothing to fix");
    expect(html).toContain('aria-label="Consistency score 100 out of 100"');
  });

  it("lists findings for review and excluded findings apart, and never counts them", () => {
    const review = finding({ id: "f2", fingerprint: "r1", type: "Review", severity: "Low", ruleId: "BOX-03", property: "background", actual: "rgb(255, 230, 230)", expected: "none" });
    const ignored = finding({ id: "f3", fingerprint: "i1", status: "ignored", reason: "Centred on purpose" });
    const html = buildHtmlReport(result([review, ignored]));
    expect(html).toContain("Consistent: no issues found");
    expect(html).toContain('id="h-review"');
    expect(html).toContain('id="h-excluded"');
    expect(html).toContain("Centred on purpose");
    expect(html).toContain("+1</span>");
  });

  it("escapes everything that comes from the page", () => {
    const evil = finding({
      message: 'Text is <img src=x onerror="alert(1)">',
      actual: "<b>18px</b>",
      element: { selector: 'a[href="x"]', html: "<script>alert(1)</script>", text: "<i>x</i>", box: { x: 0, y: 0, width: 1, height: 1 } },
    });
    const page = result([evil]);
    page.title = "<script>alert('t')</script>";
    page.url = "javascript:alert(1)";
    const html = buildHtmlReport(page);
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain('<img src=x onerror');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(escapeHtml(`<a href="x">'&`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
  });

  it("embeds a screenshot only when it is a real image data URL", () => {
    const ok = buildHtmlReport(result([finding({ evidence: { screenshot: PIXEL } })]));
    expect(ok).toContain(`<img src="${PIXEL}"`);
    const bad = buildHtmlReport(result([finding({ evidence: { screenshot: "https://example.test/x.png" } })]));
    expect(bad).not.toContain("<figure");
  });
});

describe("JSON report and file names", () => {
  it("is the scan result with the tool and the export date", () => {
    const doc = buildJsonReportDocument(result([finding()]), new Date("2026-11-13T12:00:00.000Z"));
    expect(doc.tool.name).toBe("PalTech UI Consistency Checker");
    expect(doc.exportedAt).toBe("2026-11-13T12:00:00.000Z");
    expect(doc.findings).toHaveLength(1);
    expect(doc.score).toBe(50);
    expect(doc.screenshotsStripped).toBe(false);
  });

  it("drops screenshots when together they are too large", () => {
    const big = `data:image/png;base64,${"A".repeat(JSON_SCREENSHOT_BUDGET_BYTES + 10)}`;
    const doc = buildJsonReportDocument(result([finding({ evidence: { screenshot: big } })]));
    expect(doc.screenshotsStripped).toBe(true);
    expect(doc.screenshotsOmitted).toBe(1);
    expect(doc.findings[0].evidence).toBeUndefined();
  });

  it("names the file after the site", () => {
    const page = result([]);
    expect(reportFilename("html", page)).toBe("app.example.test_UI_Consistency_Report.html");
    page.url = "https://www.example.test/";
    expect(reportFilename("json", page)).toBe("example.test_UI_Consistency_Report.json");
    expect(buildReport("json", page).mime).toContain("application/json");
    expect(JSON.parse(buildReport("json", page).content).scanId).toBe("scan-1");
  });
});
