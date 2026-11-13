import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crossPageFindings, type CrossPageFinding } from "@shared/cross-page";
import { withFindings } from "@shared/scoring";
import type { ScanResult, SharedPart } from "@shared/types";
import { buildMultiPageReport } from "@src/background/exporters";
import { runScan } from "@src/content/scanner";

const STYLE = { fontFamily: "Inter", fontSize: 28, fontWeight: 600, color: "rgb(17, 17, 17)", backgroundColor: "rgb(255, 255, 255)" };

function title(patch: { x?: number; y?: number; fontSize?: number } = {}): SharedPart {
  return {
    key: "pageTitle",
    kind: "pageTitle",
    name: "Page title",
    element: { selector: "h1", html: "<h1>", text: "Title", box: { x: patch.x ?? 224, y: patch.y ?? 16, width: 200, height: 32 } },
    text: "Title",
    style: { ...STYLE, fontSize: patch.fontSize ?? 28 },
  };
}

function nav(labels: string[], patch: { width?: number } = {}): SharedPart {
  return {
    key: "navigation:side:1",
    kind: "navigation",
    name: "Side navigation",
    element: { selector: "nav", html: "<nav>", text: "", box: { x: 0, y: 0, width: patch.width ?? 200, height: 900 } },
    style: { ...STYLE, fontSize: 14, fontWeight: 400 },
    items: labels.map((text) => ({ text, icon: true })),
  };
}

function page(name: string, parts: SharedPart[] | undefined): ScanResult {
  const base: ScanResult = {
    scanId: name,
    url: `https://app.example.test/${name}`,
    title: name,
    scannedAt: "2026-11-14T10:00:00.000Z",
    durationMs: 100,
    timings: { waitMs: 0, snapshotMs: 0, groupingMs: 0, rulesMs: 0 },
    engineVersion: "0.7.0",
    score: 100,
    summary: { high: 0, medium: 0, low: 0, review: 0, excluded: 0 },
    options: { scope: "page", tolerancePreset: "normal", rules: [] },
    viewport: { width: 1280, height: 900, devicePixelRatio: 1 },
    elementsScanned: 50,
    groups: [],
    findings: [],
    rules: [],
    notScanned: [],
    warnings: [],
    ...(parts ? { parts } : {}),
  };
  return withFindings(base, []);
}

const NAV = ["Home", "Orders", "Reports"];
const find = (findings: CrossPageFinding[], part: string, property: string): CrossPageFinding => {
  const f = findings.find((x) => x.part === part && x.property === property);
  if (!f) throw new Error(`${part}: ${property} not reported; got ${findings.map((x) => `${x.part}: ${x.property}`).join(", ") || "nothing"}`);
  return f;
};
const differing = (f: CrossPageFinding): string[] => f.pages.filter((p) => p.differs).map((p) => p.title);

describe("crossPageFindings", () => {
  it("reports nothing when the shared parts are the same on every page", () => {
    expect(crossPageFindings([page("a", [title(), nav(NAV)]), page("b", [title(), nav(NAV)]), page("c", [title({ x: 225 }), nav(NAV)])])).toEqual([]);
  });

  it("reports the page whose title sits elsewhere or is set in another size", () => {
    const pages = [page("a", [title()]), page("b", [title()]), page("c", [title({ x: 230 })]), page("d", [title({ fontSize: 32 })]), page("e", [title()])];
    const found = crossPageFindings(pages);
    const left = find(found, "Page title", "left edge");
    expect(left).toMatchObject({ type: "Definite", severity: "High", expected: "224px" });
    expect(differing(left)).toEqual(["c"]);
    expect(left.message).toBe("Page title left edge is 230px on 1 page; 4 of the 5 pages have 224px.");
    expect(differing(find(found, "Page title", "font size"))).toEqual(["d"]);
    expect(found).toHaveLength(2);
  });

  it("compares the same item of a navigation on every page: a label shown on some pages and not on others", () => {
    const found = crossPageFindings([page("a", [nav(NAV)]), page("b", [nav(NAV)]), page("c", [nav(["", "Orders", "Reports"])]), page("d", [nav(NAV)])]);
    const label = find(found, "Side navigation", 'label of item 1 ("Home")');
    expect(label).toMatchObject({ type: "Definite", expected: "shown" });
    expect(differing(label)).toEqual(["c"]);
    expect(label.pages.map((p) => p.value)).toEqual(["shown", "shown", "not shown", "shown"]);
  });

  it("names both values when two pages differ, and lists every value when no value stands out", () => {
    const pair = find(crossPageFindings([page("a", [nav(NAV)]), page("b", [nav(NAV, { width: 240 })])]), "Side navigation", "width");
    expect(pair).toMatchObject({ expected: null, severity: "Medium", message: "Side navigation width differs between the two pages: 200px and 240px." });
    expect(differing(pair)).toEqual(["a", "b"]);
    const none = find(crossPageFindings([page("a", [title({ x: 200 })]), page("b", [title({ x: 210 })]), page("c", [title({ x: 220 })])]), "Page title", "left edge");
    expect(none.expected).toBeNull();
    expect(none.message).toContain("has no consistent value across the pages");
  });

  it("lists a different number of items, and a part most pages have and one does not, for review", () => {
    const found = crossPageFindings([page("a", [title(), nav(NAV)]), page("b", [title(), nav(NAV)]), page("c", [title(), nav(NAV)]), page("d", [nav([...NAV, "Admin"])])]);
    expect(find(found, "Side navigation", "number of items")).toMatchObject({ type: "Review", severity: "Low" });
    const missing = find(found, "Page title", "presence");
    expect(missing).toMatchObject({ type: "Review", message: "Page title was not found on 1 page; 3 of the 4 pages have one. This may be on purpose." });
    expect(differing(missing)).toEqual(["d"]);
    // Items are compared one by one only when every page has the same number of them.
    expect(found.some((f) => f.property.startsWith("label of"))).toBe(false);
    // Definite findings come first.
    expect(found.map((f) => f.type)).toEqual([...found.map((f) => f.type)].sort());
  });

  it("leaves out pages scanned in part, which have no shared parts", () => {
    expect(crossPageFindings([page("a", [title()]), page("b", undefined), page("c", [title()])])).toEqual([]);
  });
});

describe("the shared parts of a page", () => {
  beforeEach(() => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const [x, y, width, height] = (this.getAttribute("data-box") ?? "0 0 10 10").split(/\s+/).map(Number);
      return { x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON: () => ({}) } as DOMRect;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("finds the title, the header, the navigation and the tab bar from standard elements and roles", async () => {
    document.body.innerHTML = `
      <nav data-box="0 0 200 900"><a href="/a" data-box="0 0 200 30"><i data-box="8 8 16 16"></i><span>Home</span></a><a href="/b" data-box="0 30 200 30"><i data-box="8 38 16 16"></i></a><a href="/c" data-box="0 60 200 30">Reports</a></nav>
      <header data-box="200 0 1000 64"><h1 data-box="224 16 300 32" style="font-size:28px; font-weight:600">Orders</h1></header>
      <main data-box="200 64 1000 800">
        <div role="tablist" data-box="224 80 400 40"><button role="tab" aria-selected="true">Open</button><button role="tab" aria-selected="false" style="font-size:15px">Closed</button></div>
        <article data-box="224 140 400 200"><header data-box="224 140 400 30"><h2>Card</h2></header></article>
      </main>
      <footer data-box="200 864 1000 36">Made-up company</footer>`;
    const result = await runScan({ scope: "page", tolerancePreset: "normal", rules: [] });
    const parts = result.parts!;
    expect(parts.map((p) => p.key)).toEqual(["pageTitle", "header", "navigation:side:1", "tabs:1", "footer"]);
    const byKey = Object.fromEntries(parts.map((p) => [p.key, p]));
    expect(byKey.pageTitle).toMatchObject({ name: "Page title", text: "Orders", style: { fontSize: 28, fontWeight: 600 } });
    expect(byKey.pageTitle.element.box).toMatchObject({ x: 224, y: 16 });
    // The header of the page, not the header of the card.
    expect(byKey.header.element.box).toMatchObject({ x: 200, y: 0, height: 64 });
    expect(byKey["navigation:side:1"].name).toBe("Side navigation");
    expect(byKey["navigation:side:1"].items).toEqual([{ text: "Home", icon: true }, { text: "", icon: true }, { text: "Reports", icon: false }]);
    // The text style of a tab bar is that of a tab that is not the selected one.
    expect(byKey["tabs:1"].items?.map((i) => i.text)).toEqual(["Open", "Closed"]);
    expect(byKey["tabs:1"].style.fontSize).toBe(15);

    // A scan of part of the page has nothing to compare with other pages.
    const partOnly = await runScan({ scope: "selector", selector: "main", tolerancePreset: "normal", rules: [] });
    expect(partOnly.parts).toBeUndefined();
  });
});

describe("the report of several pages", () => {
  const pages = [page("orders", [title()]), page("invoices", [title({ x: 230 })]), page("<b>reports</b>", [title()])];

  it("has an overview, what differs across the pages, and every page", () => {
    const file = buildMultiPageReport("html", pages, { organisation: "Example Ltd" });
    expect(file.filename).toBe("app.example.test_UI_Consistency_Site_Report.html");
    const html = file.content;
    expect(html).toContain("3 pages");
    expect(html).toContain("Example Ltd");
    expect(html).toContain('id="h-cross"');
    expect(html).toContain("Page title: left edge");
    expect(html).toContain("Page title left edge is 230px on 1 page; 2 of the 3 pages have 224px.");
    expect(html).toContain('<a href="#page-2">invoices</a>');
    expect(html).toContain('id="page-3"');
    expect(html).toContain("1 difference across pages");
    // Everything from the pages is escaped, and the file runs no script.
    expect(html).toContain("&lt;b&gt;reports&lt;/b&gt;");
    expect(html).not.toContain("<b>reports</b>");
    expect(html).not.toContain("<script");
  });

  it("says so when the pages are the same", () => {
    const html = buildMultiPageReport("html", [page("a", [title()]), page("b", [title()])]).content;
    expect(html).toContain("Consistent");
    expect(html).toContain("look the same on every page that has them");
  });

  it("gives the pages and the comparison as JSON", () => {
    const file = buildMultiPageReport("json", pages);
    expect(file.filename).toBe("app.example.test_UI_Consistency_Site_Report.json");
    const data = JSON.parse(file.content) as { pageCount: number; crossPage: CrossPageFinding[]; pages: Array<{ url: string; tool: { name: string } }> };
    expect(data.pageCount).toBe(3);
    expect(data.crossPage.map((f) => f.property)).toEqual(["left edge"]);
    expect(data.pages.map((p) => p.url)).toEqual(pages.map((p) => p.url));
    expect(data.pages[0].tool.name).toBeTruthy();
    expect(() => buildMultiPageReport("html", [])).toThrow("No scanned pages");
  });
});
