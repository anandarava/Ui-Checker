import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RULES } from "@shared/rules";
import type { ScanOptions, TolerancePreset } from "@shared/types";
import { findPeerGroups } from "@src/content/grouping";
import { runRules, type RawFinding } from "@src/content/rules";
import { deltaE, parseRgb } from "@src/content/rules/color";
import { bucketLabels, bucketNumbers, judge, median, px } from "@src/content/rules/compare";
import { takeSnapshot, type PageSnapshot } from "@src/content/snapshot";

/**
 * jsdom does no layout: data-box="x y width height" gives an element its box
 * (default 10 x 10 at 0,0) and data-text-box the box of its own text. Looks
 * are given with inline styles.
 */
function rectOf(spec: string | null, fallback: number[]): DOMRect {
  const [x, y, width, height] = spec ? spec.split(/\s+/).map(Number) : fallback;
  return { x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON: () => ({}) } as DOMRect;
}

function stubLayout(): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return rectOf(this.getAttribute("data-box"), [0, 0, 10, 10]);
  });
  Range.prototype.getBoundingClientRect = function (this: Range) {
    return rectOf(this.startContainer.parentElement?.getAttribute("data-text-box") ?? null, [0, 0, 0, 0]);
  };
}

interface Found {
  snapshot: PageSnapshot;
  findings: RawFinding[];
  checked: Map<string, number>;
  /** "RULE id-of-element" for every finding, in order. */
  keys: string[];
}

const BUILT = RULES.filter((r) => r.implemented).map((r) => r.id);

function scan(html: string, preset: TolerancePreset = "normal", only: string[] = BUILT): Found {
  document.body.innerHTML = html;
  const snapshot = takeSnapshot(document.body);
  const groups = findPeerGroups(snapshot.elements);
  const options: ScanOptions = { scope: "page", tolerancePreset: preset, rules: [] };
  const { findings, checked } = runRules(snapshot.elements, groups, options, only);
  return { snapshot, findings, checked, keys: findings.map((f) => `${f.ruleId} ${snapshot.nodes[f.element].id}`) };
}

function finding(found: Found, ruleId: string, id: string): RawFinding {
  const f = found.findings.find((x) => x.ruleId === ruleId && found.snapshot.nodes[x.element].id === id);
  if (!f) throw new Error(`${ruleId} on #${id} not found; got ${found.keys.join(", ") || "nothing"}`);
  return f;
}

const BOX = "border-top-width:1px; border-right-width:1px; border-bottom-width:1px; border-left-width:1px; background-color:rgb(250, 250, 250)";
const TEXT = "font-family:Arial; font-size:16px; font-weight:400; color:rgb(20, 20, 20)";

/** A row of plain text items; `styles[n]` is added to the look of item n. */
function items(styles: Record<number, string>, count = 5, tag = "span"): string {
  let out = "";
  for (let n = 1; n <= count; n++) out += `<${tag} id="t${n}" style="${TEXT}; ${styles[n] ?? ""}">Item ${n}</${tag}>`;
  return `<div>${out}</div>`;
}

beforeEach(() => {
  stubLayout();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the comparison logic", () => {
  const entries = (...values: number[]) => values.map((value, el) => ({ el, value }));

  it("reports the members outside a clear majority", () => {
    const verdict = judge(bucketNumbers(entries(16, 16, 16, 16, 18), 0.5, px));
    expect(verdict).toMatchObject({ kind: "outlier", strong: true });
    if (verdict.kind === "outlier") {
      expect(verdict.expected.label).toBe("16px");
      expect(verdict.outliers.map((o) => o.el)).toEqual([4]);
    }
  });

  it("is less sure when the value that stands out is not shared by most", () => {
    expect(judge(bucketNumbers(entries(20, 20, 16, 26), 0.5, px))).toMatchObject({ kind: "outlier", strong: false });
  });

  it("reports a pair as a pair and a group without a common value as such", () => {
    expect(judge(bucketNumbers(entries(16, 18), 0.5, px)).kind).toBe("pair");
    expect(judge(bucketNumbers(entries(16, 20, 26), 0.5, px)).kind).toBe("noMajority");
    expect(judge(bucketNumbers(entries(16, 16, 20, 20), 0.5, px)).kind).toBe("noMajority");
  });

  it("treats values within the tolerance as the same", () => {
    expect(judge(bucketNumbers(entries(16, 16.4, 16.2), 0.5, px)).kind).toBe("same");
    expect(judge(bucketNumbers(entries(16, 16.4, 16.6), 0.5, px)).kind).toBe("outlier");
    expect(judge(bucketLabels(entries(400, 400), String)).kind).toBe("same");
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });

  it("measures how different two colours look", () => {
    expect(parseRgb("rgba(11, 74, 143, 0.5)")).toEqual({ r: 11, g: 74, b: 143 });
    expect(parseRgb("oklch(0.5 0.1 200)")).toBeNull();
    expect(deltaE("rgb(17, 17, 17)", "rgb(17, 17, 17)")).toBe(0);
    expect(deltaE("rgb(17, 17, 17)", "rgb(18, 18, 18)")).toBeLessThan(3);
    expect(deltaE("rgb(17, 17, 17)", "rgb(11, 74, 143)")).toBeGreaterThan(20);
    expect(deltaE("oklch(0.5 0.1 200)", "oklch(0.6 0.1 200)")).toBe(Infinity);
  });
});

describe("typography rules", () => {
  it("TYP-01 reports a different font family", () => {
    const found = scan(items({ 3: "font-family:Georgia" }));
    expect(found.keys).toEqual(["TYP-01 t3"]);
    expect(finding(found, "TYP-01", "t3")).toMatchObject({ kind: "outlier", severity: "High", actual: "georgia", expected: "arial", type: "Definite" });
  });

  it("TYP-02 reports a different font size, beyond the tolerance", () => {
    expect(scan(items({ 2: "font-size:18px" })).keys).toEqual(["TYP-02 t2"]);
    expect(scan(items({ 2: "font-size:16.4px" })).keys).toEqual([]);
    const f = finding(scan(items({ 2: "font-size:18px" })), "TYP-02", "t2");
    expect(f.message).toBe("Font size is 18px; 4 of the 5 elements in this group use 16px.");
    expect(f.values).toEqual([
      { value: "16px", count: 4 },
      { value: "18px", count: 1 },
    ]);
  });

  it("TYP-03 reports a different font weight", () => {
    const found = scan(items({ 5: "font-weight:700" }));
    expect(found.keys).toEqual(["TYP-03 t5"]);
    expect(finding(found, "TYP-03", "t5")).toMatchObject({ actual: "700", expected: "400", severity: "Medium" });
  });

  it("TYP-05 lists a colour on its own for review, and a near-identical colour not at all", () => {
    const found = scan(items({ 4: "color:rgb(200, 0, 0)" }));
    expect(found.keys).toEqual(["TYP-05 t4"]);
    expect(finding(found, "TYP-05", "t4")).toMatchObject({ type: "Review", severity: "Low", actual: "rgb(200, 0, 0)" });
    expect(scan(items({ 4: "color:rgb(21, 21, 21)" })).keys).toEqual([]);
  });

  it("TYP-05 reports a link where its peers have plain text", () => {
    const part = (n: number, link: boolean): string =>
      `<div id="c${n}"><b style="${BOX}"></b>${link ? `<a id="t${n}" href="#" style="${TEXT}; color:rgb(0, 0, 200)">City</a>` : `<span id="t${n}" style="${TEXT}">City</span>`}</div>`;
    const found = scan(`<section>${part(1, false)}${part(2, true)}${part(3, false)}${part(4, false)}</section>`);
    expect(found.keys).toEqual(["TYP-05 t2"]);
    expect(finding(found, "TYP-05", "t2")).toMatchObject({ type: "Definite", property: "text colour" });
    expect(finding(found, "TYP-05", "t2").message).toContain("link where its peers are plain text");
  });

  it("gives one finding for review to a member that differs in several ways", () => {
    const found = scan(items({ 1: "font-size:20px; font-weight:700" }));
    expect(found.keys).toEqual(["TYP-02 t1"]);
    expect(finding(found, "TYP-02", "t1")).toMatchObject({ type: "Review", severity: "Low", property: "typography", actual: "font size 20px, font weight 700" });
  });

  it("leaves out a member in a different state, and what is inside it", () => {
    const tab = (n: number, selected: boolean): string =>
      `<button id="t${n}" role="tab" aria-selected="${selected}" style="${TEXT}; ${selected ? "font-weight:700; color:rgb(0, 0, 200)" : ""}">Tab ${n}</button>`;
    expect(scan(`<div role="tablist">${tab(1, true)}${tab(2, false)}${tab(3, false)}</div>`).keys).toEqual([]);
  });

  it("reports two members that differ as a pair, on the second, without an expected value", () => {
    // Two list items built alike, each with text of its own and an icon.
    const item = (n: number, size: number): string => `<li id="t${n}" style="${TEXT}; font-size:${size}px">Item ${n}<b style="${BOX}"></b></li>`;
    const found = scan(`<ul>${item(1, 16)}${item(2, 20)}</ul>`);
    expect(found.keys).toEqual(["TYP-02 t2"]);
    expect(finding(found, "TYP-02", "t2")).toMatchObject({ kind: "pair", expected: null, severity: "Medium" });
  });

  it("counts the groups a rule looked at, and runs only the rules asked for", () => {
    const html = items({ 2: "font-size:18px; font-weight:700" });
    expect(scan(html, "normal", ["TYP-03"]).keys).toEqual(["TYP-03 t2"]);
    const found = scan(items({}));
    expect(found.findings).toEqual([]);
    expect(found.checked.get("TYP-02")).toBe(1);
    expect(found.checked.get("LAY-05")).toBeUndefined();
  });
});

describe("layout rules", () => {
  /** A card: border 1px, padding given, one child that fills it. */
  const card = (n: number, x: number, pad: [number, number, number, number], height = 100): string => {
    const [top, right, bottom, left] = pad;
    const style = `${BOX}; padding-top:${top}px; padding-right:${right}px; padding-bottom:${bottom}px; padding-left:${left}px`;
    const inner = `${x + 1 + left} ${1 + top} ${200 - 2 - left - right} ${height - 2 - top - bottom}`;
    return `<div id="c${n}" data-box="${x} 0 200 ${height}" style="${style}"><p data-box="${inner}">Text</p></div>`;
  };

  const PADDING = ["LAY-01", "LAY-02"];

  it("LAY-01 reports a container padded differently from its peers", () => {
    const found = scan(`<main>${card(1, 0, [16, 16, 16, 16])}${card(2, 220, [16, 16, 16, 16])}${card(3, 440, [24, 24, 24, 24])}${card(4, 660, [16, 16, 16, 16])}</main>`);
    expect(found.keys).toEqual(["LAY-01 c3"]);
    expect(finding(found, "LAY-01", "c3")).toMatchObject({ kind: "outlier", severity: "High", actual: "top 25px, right 25px, bottom 25px, left 25px", expected: "top 17px, right 17px, bottom 17px, left 17px" });
  });

  it("LAY-01 ignores a side where the content does not sit against the padding", () => {
    // The third card is taller than its content: the free space at the bottom is not padding.
    const tall = card(3, 440, [16, 16, 16, 16]).replace('data-box="440 0 200 100"', 'data-box="440 0 200 160"');
    expect(scan(`<main>${card(1, 0, [16, 16, 16, 16])}${card(2, 220, [16, 16, 16, 16])}${tall}</main>`, "normal", PADDING).keys).toEqual([]);
  });

  it("LAY-02 reports the container that is lopsided while its peers are even", () => {
    const found = scan(`<main>${card(1, 0, [20, 20, 20, 20])}${card(2, 220, [20, 20, 68, 20], 148)}${card(3, 440, [20, 20, 20, 20])}</main>`, "normal", PADDING);
    expect(found.keys).toEqual(["LAY-02 c2"]);
    expect(finding(found, "LAY-02", "c2")).toMatchObject({ actual: "bottom 69px, top 21px", property: "top and bottom padding" });
  });

  it("LAY-03 reports unequal gaps between boxes, and ignores a gap that separates two sets", () => {
    const box = (n: number, y: number): string => `<div id="b${n}" data-box="0 ${y} 200 40" style="${BOX}"><p>x</p></div>`;
    expect(scan(`<main id="col">${box(1, 0)}${box(2, 61)}${box(3, 118)}</main>`).keys).toEqual(["LAY-03 col"]);
    expect(scan(`<main id="col">${box(1, 0)}${box(2, 60)}${box(3, 120)}</main>`).keys).toEqual([]);
    // 20px, 20px, then 300px: the last box is set apart, not badly spaced.
    expect(scan(`<main id="col">${box(1, 0)}${box(2, 60)}${box(3, 120)}${box(4, 460)}</main>`).keys).toEqual([]);
  });

  it("LAY-03 reports a grid whose row and column gaps are very different", () => {
    const tile = (n: number, x: number, y: number): string => `<div id="b${n}" data-box="${x} ${y} 100 40" style="${BOX}"><p>x</p></div>`;
    const grid = (colGap: number, rowGap: number): string =>
      `<main id="grid">${tile(1, 0, 0)}${tile(2, 100 + colGap, 0)}${tile(3, 0, 40 + rowGap)}${tile(4, 100 + colGap, 40 + rowGap)}</main>`;
    const found = scan(grid(68, 19));
    expect(found.keys).toEqual(["LAY-03 grid"]);
    expect(finding(found, "LAY-03", "grid").actual).toBe("68px between columns, 19px between rows");
    expect(scan(grid(20, 20)).keys).toEqual([]);
    expect(scan(grid(24, 16)).keys).toEqual([]);
  });

  it("LAY-03 reports two neighbouring gaps in a row that are nearly equal", () => {
    const row = (second: number): string => `
      <div id="row" style="display:flex" data-box="0 0 800 40">
        <button data-box="0 0 50 40">Prev</button>
        <div data-box="140 0 200 40"><b>1</b></div>
        <button data-box="${340 + second} 0 50 40">Next</button>
      </div>`;
    expect(scan(row(100)).keys).toEqual(["LAY-03 row"]);
    expect(scan(row(90)).keys).toEqual([]);
    // 90px and 300px are not "nearly equal".
    expect(scan(row(300)).keys).toEqual([]);
  });

  it("LAY-04 reports a peer that starts a few pixels lower in its row", () => {
    const col = (n: number, x: number, y: number): string => `<div id="p${n}" data-box="${x} ${y} 100 60" style="${BOX}"><p>x</p></div>`;
    const row = (y: number, align = "flex-start"): string => `<div style="display:flex; align-items:${align}" data-box="0 0 400 70">${col(1, 0, 0)}${col(2, 120, 0)}${col(3, 240, y)}</div>`;
    const found = scan(row(4), "normal", ["LAY-04"]);
    expect(found.keys).toEqual(["LAY-04 p3"]);
    expect(finding(found, "LAY-04", "p3").message).toBe("The top edge of this element is 4px lower than its 2 peers.");
    expect(scan(row(1), "normal", ["LAY-04"]).keys).toEqual([]);
    // A whole step lower is another row on purpose.
    expect(scan(row(40), "normal", ["LAY-04"]).keys).toEqual([]);
  });

  it("LAY-04 reports an edge that just misses the line its neighbours share", () => {
    const line = (id: string, x: number, y: number): string => `<p id="${id}" data-box="${x} ${y} 300 20" data-text-box="${x} ${y} 120 20">Line</p>`;
    // The title is a heading, not a peer of the lines below it: only the shared edge connects them.
    const title = (x: number): string => `<h1 id="title" data-box="${x} 0 300 20" data-text-box="${x} 0 120 20">Title</h1>`;
    const page = (titleX: number): string => `<main data-box="0 0 600 200">${title(titleX)}${line("a", 40, 40)}${line("b", 40, 80)}${line("c", 40, 120)}</main>`;
    const found = scan(page(44), "normal", ["LAY-04"]);
    expect(found.keys).toEqual(["LAY-04 title"]);
    expect(finding(found, "LAY-04", "title")).toMatchObject({ group: -1, property: "left edge", severity: "Medium" });
    expect(scan(page(40), "normal", ["LAY-04"]).keys).toEqual([]);
    // 20px in is an indent, not a miss.
    expect(scan(page(60), "normal", ["LAY-04"]).keys).toEqual([]);
  });

  it("LAY-05 reports a box of another size, and ignores sizes that follow the text", () => {
    const avatar = (n: number, size: number): string =>
      `<li><span id="a${n}" data-box="${n * 60} 0 ${size} ${size}" data-text-box="${n * 60 + 12} 12 16 16" style="${BOX}">AB</span><b>Name</b></li>`;
    const found = scan(`<ul>${avatar(1, 40)}${avatar(2, 40)}${avatar(3, 44)}${avatar(4, 40)}${avatar(5, 40)}${avatar(6, 40)}${avatar(7, 40)}</ul>`, "normal", ["LAY-05"]);
    expect(found.keys).toEqual(["LAY-05 a3"]);
    expect(finding(found, "LAY-05", "a3")).toMatchObject({ actual: "44 × 44px", expected: "40 × 40px" });

    // Buttons as wide as their labels: the widths differ because the texts do.
    const button = (n: number, width: number): string =>
      `<li><button id="b${n}" data-box="0 ${n * 40} ${width} 30" data-text-box="8 ${n * 40 + 7} ${width - 18} 16" style="${BOX}; padding-left:8px; padding-right:8px; padding-top:6px; padding-bottom:6px">Open</button><b>x</b></li>`;
    expect(scan(`<ul>${button(1, 60)}${button(2, 60)}${button(3, 90)}${button(4, 60)}${button(5, 60)}${button(6, 60)}${button(7, 60)}</ul>`, "normal", ["LAY-05"]).keys).toEqual([]);
  });

  it("LAY-06 reports a block that starts further in than the rest of the sections' content", () => {
    const section = (n: number, y: number, blockX: number): string => `
      <section id="s${n}" data-box="0 ${y} 500 200" style="${BOX}; padding-left:19px">
        <div data-box="20 ${y + 10} 460 30"><h2>Title</h2></div>
        <div id="body${n}" data-box="${blockX} ${y + 50} 300 100"><p>Body</p></div>
      </section>`;
    const found = scan(`<main>${section(1, 0, 20)}${section(2, 220, 20)}${section(3, 440, 70)}</main>`, "normal", ["LAY-06"]);
    expect(found.keys).toEqual(["LAY-06 body3"]);
    expect(finding(found, "LAY-06", "body3")).toMatchObject({ actual: "70px", expected: "20px", severity: "High" });
    expect(scan(`<main>${section(1, 0, 20)}${section(2, 220, 20)}${section(3, 440, 22)}</main>`, "normal", ["LAY-06"]).keys).toEqual([]);
  });

  it("uses a tolerance set for one rule instead of the preset", () => {
    const col = (n: number, x: number, y: number): string => `<div id="p${n}" data-box="${x} ${y} 100 60" style="${BOX}"><p>x</p></div>`;
    document.body.innerHTML = `<div style="display:flex; align-items:flex-start" data-box="0 0 400 70">${col(1, 0, 0)}${col(2, 120, 0)}${col(3, 240, 4)}</div>`;
    const snapshot = takeSnapshot(document.body);
    const groups = findPeerGroups(snapshot.elements);
    const run = (tolerances?: Record<string, number>) => runRules(snapshot.elements, groups, { scope: "page", tolerancePreset: "normal", rules: [], tolerances }, ["LAY-04"]).findings.length;
    expect(run()).toBe(1);
    expect(run({ "LAY-04": 5 })).toBe(0);
    expect(run({ "LAY-04": 1 })).toBe(1);
    // A tolerance for another rule changes nothing here.
    expect(run({ "TYP-02": 50 })).toBe(1);
  });

  it("uses the tolerance of the preset", () => {
    const col = (n: number, x: number, y: number): string => `<div id="p${n}" data-box="${x} ${y} 100 60" style="${BOX}"><p>x</p></div>`;
    const row = `<div style="display:flex; align-items:flex-start" data-box="0 0 400 70">${col(1, 0, 0)}${col(2, 120, 0)}${col(3, 240, 3)}</div>`;
    expect(scan(row, "strict", ["LAY-04"]).keys).toEqual(["LAY-04 p3"]);
    expect(scan(row, "normal", ["LAY-04"]).keys).toEqual(["LAY-04 p3"]);
    expect(scan(row, "relaxed", ["LAY-04"]).keys).toEqual([]);
  });
});

describe("second wave: typography", () => {
  it("TYP-04 reports a different line height, but not the same multiple of a larger font", () => {
    const found = scan(items({ 1: "line-height:22.4px", 2: "line-height:22.4px", 3: "line-height:16px", 4: "line-height:22.4px", 5: "line-height:22.4px" }), "normal", ["TYP-04"]);
    expect(found.keys).toEqual(["TYP-04 t3"]);
    expect(finding(found, "TYP-04", "t3")).toMatchObject({ severity: "Low", actual: "16px (1 × the font size)" });
    // 18px text with a 25.2px line height is the same 1.4 as 16px text with 22.4px.
    const scaled = items({ 1: "line-height:22.4px", 2: "line-height:22.4px", 3: "font-size:18px; line-height:25.2px", 4: "line-height:22.4px", 5: "line-height:22.4px" });
    expect(scan(scaled, "normal", ["TYP-04"]).keys).toEqual([]);
  });

  it("TYP-06 reports text that sits elsewhere in its box than the text of its peers", () => {
    // Boxes of 200px; the text is 60px wide, at the left, the right or in the middle.
    const cell = (n: number, textX: number): string => `<li><span id="t${n}" data-box="0 ${n * 30} 200 20" data-text-box="${textX} ${n * 30} 60 20" style="${TEXT}">Name</span><b style="${BOX}"></b></li>`;
    const found = scan(`<ul>${cell(1, 70)}${cell(2, 70)}${cell(3, 0)}${cell(4, 70)}${cell(5, 70)}</ul>`, "normal", ["TYP-06"]);
    expect(found.keys).toEqual(["TYP-06 t3"]);
    expect(finding(found, "TYP-06", "t3")).toMatchObject({ actual: "left", expected: "centre" });
    // Text that fills its box says nothing about alignment.
    const full = (n: number): string => `<li><span id="t${n}" data-box="0 ${n * 30} 60 20" data-text-box="0 ${n * 30} 60 20" style="${TEXT}">Name</span><b style="${BOX}"></b></li>`;
    expect(scan(`<ul>${cell(1, 70)}${cell(2, 70)}${full(3)}${cell(4, 70)}</ul>`, "normal", ["TYP-06"]).keys).toEqual([]);
  });
});

describe("second wave: rows, columns and tables", () => {
  it("LAY-07 reports an item that is off the line its row is centred on", () => {
    const row = (iconY: number): string => `
      <div style="display:flex; align-items:center" data-box="0 0 300 40">
        <span id="num" data-box="0 10 20 20">33</span>
        <span id="text" data-box="30 0 200 40">Two lines of text</span>
        <span id="icon" data-box="250 ${iconY} 10 10" style="${BOX}"></span>
      </div>`;
    const found = scan(row(6), "normal", ["LAY-07"]);
    expect(found.keys).toEqual(["LAY-07 icon"]);
    expect(finding(found, "LAY-07", "icon").message).toBe("This item sits 9px higher than the 2 other items of its row.");
    expect(scan(row(15), "normal", ["LAY-07"]).keys).toEqual([]);
  });

  it("LAY-07 reports an item moved out of a row of items of one height", () => {
    const item = (n: number, y: number): string => `<span id="i${n}" data-box="${n * 100} ${y} 90 24" style="${BOX}"><b>x</b></span>`;
    const row = (y: number): string => `<div style="display:grid" data-box="0 0 400 30">${item(1, 0)}${item(2, y)}${item(3, 0)}</div>`;
    expect(scan(row(3), "normal", ["LAY-07"]).keys).toEqual(["LAY-07 i2"]);
    expect(scan(row(1), "normal", ["LAY-07"]).keys).toEqual([]);
  });

  it("LAY-07 reports an icon that is not centred on the text next to it", () => {
    const label = (iconY: number): string => `<p id="label" data-box="0 0 200 20" data-text-box="24 2 100 16" style="${TEXT}"><i id="icon" data-box="0 ${iconY} 16 16" style="${BOX}"></i>Settings</p>`;
    expect(scan(label(8), "normal", ["LAY-07"]).keys).toEqual(["LAY-07 icon"]);
    expect(scan(label(2), "normal", ["LAY-07"]).keys).toEqual([]);
  });

  it("LAY-08 reports the column of cards that ends above its peer, and not plain lists", () => {
    const column = (id: string, x: number, height: number, drawn: boolean): string =>
      `<div id="${id}" data-box="${x} 0 300 ${height}"><section data-box="${x} 0 300 ${height}" style="${drawn ? BOX : ""}"><h2>Title</h2></section></div>`;
    const found = scan(`<main style="display:flex">${column("left", 0, 400, true)}${column("right", 320, 620, true)}</main>`, "normal", ["LAY-08"]);
    expect(found.keys).toEqual(["LAY-08 left"]);
    expect(finding(found, "LAY-08", "left")).toMatchObject({ kind: "pair", severity: "Low", actual: "ends 220px above its peer" });
    expect(scan(`<main style="display:flex">${column("left", 0, 400, true)}${column("right", 320, 404, true)}</main>`, "normal", ["LAY-08"]).keys).toEqual([]);
    // Two lists of links of different lengths are not cards.
    expect(scan(`<main style="display:flex">${column("left", 0, 400, false)}${column("right", 320, 620, false)}</main>`, "normal", ["LAY-08"]).keys).toEqual([]);
  });

  it("LAY-09 reports a header that is not aligned like the cells of its column", () => {
    // Columns of 200px at x=0 and x=200. Cell text: 80px wide, left in column 1, right in column 2.
    const table = (header2X: number, oddCell = false): string => {
      const rows = [1, 2, 3].map((n) => {
        const second = oddCell && n === 2 ? 210 : 310;
        return `<tr><td id="r${n}c1" data-box="0 ${n * 30} 200 30" data-text-box="10 ${n * 30} 80 20" style="padding-left:10px; padding-right:10px">Name</td>` +
          `<td id="r${n}c2" data-box="200 ${n * 30} 200 30" data-text-box="${second} ${n * 30} 80 20" style="padding-left:10px; padding-right:10px">12.50</td></tr>`;
      });
      return `<table><thead><tr>
        <th id="h1" data-box="0 0 200 30" data-text-box="10 0 60 20" style="padding-left:10px; padding-right:10px">Name</th>
        <th id="h2" data-box="200 0 200 30" data-text-box="${header2X} 0 60 20" style="padding-left:10px; padding-right:10px">Price</th>
      </tr></thead><tbody>${rows.join("")}</tbody></table>`;
    };
    // Header 2 at the left, its cells at the right.
    const found = scan(table(210), "normal", ["LAY-09"]);
    expect(found.keys).toEqual(["LAY-09 h2"]);
    expect(finding(found, "LAY-09", "h2").message).toBe("This header is aligned left, but the cells of its column are aligned right.");
    // Header 2 at the right, like its cells.
    expect(scan(table(330), "normal", ["LAY-09"]).keys).toEqual([]);
    // One cell of column 2 at the left: the column mixes alignments.
    expect(scan(table(330, true), "normal", ["LAY-09"]).keys).toEqual(["LAY-09 r2c2"]);
  });

  it("LAY-09 reports a header whose text starts a few pixels off its column", () => {
    const row = (n: number): string => `<tr><td data-box="0 ${n * 30} 200 30" data-text-box="24 ${n * 30} 80 20" style="padding-left:24px">Name</td></tr>`;
    const table = (pad: number): string => `<table><thead><tr><th id="h" data-box="0 0 200 30" data-text-box="${pad} 0 60 20" style="padding-left:${pad}px">Name</th></tr></thead><tbody>${row(1)}${row(2)}${row(3)}</tbody></table>`;
    const found = scan(table(30), "normal", ["LAY-09"]);
    expect(found.keys).toEqual(["LAY-09 h"]);
    expect(finding(found, "LAY-09", "h").actual).toBe("6px to the right of them");
    expect(scan(table(24), "normal", ["LAY-09"]).keys).toEqual([]);
  });

  it("LAY-10 reports a control of another height in its row, and uneven gaps between controls", () => {
    const toolbar = (height: number, x3 = 220): string => `
      <div id="bar" data-box="0 0 600 50">
        <button id="a" data-box="0 0 100 46" style="${BOX}">One</button>
        <button id="b" data-box="110 0 100 ${height}" style="${BOX}">Two</button>
        <button id="c" data-box="${x3} 0 100 46" style="${BOX}">Three</button>
      </div>`;
    const found = scan(toolbar(50), "normal", ["LAY-10"]);
    expect(found.keys).toEqual(["LAY-10 b"]);
    expect(finding(found, "LAY-10", "b")).toMatchObject({ actual: "50px", expected: "46px", property: "height" });
    expect(scan(toolbar(46), "normal", ["LAY-10"]).keys).toEqual([]);
    // Gaps of 10px and 16px between the controls of one row.
    const gaps = scan(toolbar(46, 226), "normal", ["LAY-03", "LAY-10"]);
    expect(gaps.keys).toEqual(["LAY-10 bar"]);
  });
});

describe("second wave: group structure and box style", () => {
  it("GRP-01 reports a stray shape among the controls of a group, not a thin dividing line", () => {
    const group = (stray: string): string => `<div role="group" data-box="0 0 200 40"><button data-box="0 0 60 40">Grid</button>${stray}<button data-box="100 0 60 40">List</button></div>`;
    const found = scan(group(`<span id="dot" data-box="70 13 14 14" style="${BOX}"></span>`), "normal", ["GRP-01"]);
    expect(found.keys).toEqual(["GRP-01 dot"]);
    expect(finding(found, "GRP-01", "dot").severity).toBe("High");
    expect(scan(group(`<span id="line" data-box="80 0 1 40" style="${BOX}"></span>`), "normal", ["GRP-01"]).keys).toEqual([]);
    expect(scan(group(""), "normal", ["GRP-01"]).keys).toEqual([]);
  });

  /** Navigation items; `icons` and `chevrons` say which items have that part. */
  const nav = (count: number, icons: (n: number) => boolean, chevrons: (n: number) => boolean = () => false): string => {
    let out = "";
    for (let n = 1; n <= count; n++) {
      out += `<a id="n${n}" href="#">${icons(n) ? `<span style="${BOX}"></span>` : ""}<span style="${TEXT}">Item</span>${chevrons(n) ? `<i style="${BOX}; border-top-width:2px"></i>` : ""}</a>`;
    }
    return `<nav>${out}</nav>`;
  };

  it("GRP-02 reports the one item without the icon nearly all its peers have", () => {
    const found = scan(nav(8, (n) => n !== 5), "normal", ["GRP-02"]);
    expect(found.keys).toEqual(["GRP-02 n5"]);
    expect(finding(found, "GRP-02", "n5")).toMatchObject({ type: "Definite", severity: "Medium" });
    expect(finding(found, "GRP-02", "n5").message).toBe("This item has no icon or marker; 7 of the 8 items in this group have one.");
    expect(scan(nav(8, () => true), "normal", ["GRP-02"]).keys).toEqual([]);
  });

  it("GRP-02 lists a part that about half the items have for review, once", () => {
    const found = scan(nav(8, () => true, (n) => n % 2 === 0), "normal", ["GRP-02"]);
    expect(found.keys).toEqual(["GRP-02 n1"]);
    expect(finding(found, "GRP-02", "n1")).toMatchObject({ type: "Review", severity: "Low", kind: "noMajority" });
    // A part only one item in eight has is an extra of that item, not something the others lack.
    expect(scan(nav(8, () => true, (n) => n === 3 || n === 4), "normal", ["GRP-02"]).keys).toEqual([]);
  });

  it("GRP-03 reports the divider that stops short of the edge its peer reaches", () => {
    // Two cards, each with a main part and a list part divided from it by a line down its left side.
    const card = (n: number, y: number, listHeight: number): string => `
      <section data-box="0 ${y} 400 100" style="${BOX}">
        <div data-box="1 ${y + 1} 150 98"><h3>58</h3></div>
        <div id="list${n}" data-box="151 ${y + 1} 248 ${listHeight}" style="border-left-width:1px"><a href="#">Row</a></div>
      </section>`;
    const found = scan(`<main>${card(1, 0, 58)}${card(2, 120, 98)}</main>`, "normal", ["GRP-03"]);
    expect(found.keys).toEqual(["GRP-03 list1"]);
    expect(finding(found, "GRP-03", "list1")).toMatchObject({ kind: "pair", severity: "Low", actual: "40px from the bottom edge" });
    expect(scan(`<main>${card(1, 0, 98)}${card(2, 120, 98)}</main>`, "normal", ["GRP-03"]).keys).toEqual([]);
  });

  /** Cards built alike; `style(n)` is added to the look of card n. */
  const cards = (count: number, style: (n: number) => string): string => {
    let out = "";
    for (let n = 1; n <= count; n++) out += `<div id="c${n}" data-box="${n * 120} 0 100 80" style="${BOX}; ${style(n)}"><b>Title</b></div>`;
    return `<main>${out}</main>`;
  };
  const RADIUS = "border-top-left-radius:8px; border-top-right-radius:8px; border-bottom-right-radius:8px; border-bottom-left-radius:8px";

  it("BOX-01 reports a box with another corner radius", () => {
    const found = scan(cards(6, (n) => (n === 4 ? "border-top-left-radius:2px" : RADIUS)), "normal", ["BOX-01"]);
    expect(found.keys).toEqual(["BOX-01 c4"]);
    expect(finding(found, "BOX-01", "c4")).toMatchObject({ type: "Definite", severity: "Low", expected: "8px" });
    expect(scan(cards(6, () => RADIUS), "normal", ["BOX-01"]).keys).toEqual([]);
  });

  it("BOX-02 reports a box with a shadow where its peers have none, for review in a small group", () => {
    const shadow = (n: number): string => (n === 2 ? "box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2)" : "");
    const large = scan(cards(6, shadow), "normal", ["BOX-02"]);
    expect(large.keys).toEqual(["BOX-02 c2"]);
    expect(finding(large, "BOX-02", "c2").type).toBe("Definite");
    // Three cards, one styled differently: it may be the featured one.
    const small = scan(cards(3, shadow), "normal", ["BOX-02"]);
    expect(small.keys).toEqual(["BOX-02 c2"]);
    expect(finding(small, "BOX-02", "c2").type).toBe("Review");
  });

  it("BOX-03 lists a box with another background for review", () => {
    const found = scan(cards(6, (n) => (n === 6 ? "background-color:rgb(255, 230, 230)" : "")), "normal", ["BOX-03"]);
    expect(found.keys).toEqual(["BOX-03 c6"]);
    expect(finding(found, "BOX-03", "c6")).toMatchObject({ type: "Review", actual: "rgb(255, 230, 230)" });
    // A background that looks the same is the same.
    expect(scan(cards(6, (n) => (n === 6 ? "background-color:rgb(251, 250, 250)" : "")), "normal", ["BOX-03"]).keys).toEqual([]);
  });

  it("every rule of the catalogue has a check", () => {
    expect(RULES.every((r) => r.implemented)).toBe(true);
    expect(RULES).toHaveLength(27);
  });
});

describe("tiles and cards of one group", () => {
  const TILE = "border-top-width:1px; border-right-width:1px; border-bottom-width:1px; border-left-width:1px; background-color:rgb(250, 250, 250)";
  /** Six tiles in two columns, each with a name and a date. `boxes[n]` overrides the box of tile n; `dates[n]` the box of its date. */
  function tiles(boxes: Record<number, string> = {}, dates: Record<number, string> = {}, columnGap = 20, rowGap = 20): string {
    let out = "";
    for (let n = 1; n <= 6; n++) {
      const x = ((n - 1) % 2) * (200 + columnGap);
      const y = Math.floor((n - 1) / 2) * (70 + rowGap);
      const box = boxes[n] ?? `${x} ${y} 200 70`;
      const [bx, by] = box.split(" ").map(Number);
      out += `<div id="t${n}" data-box="${box}" style="${TILE}"><h4 id="n${n}" data-box="${bx + 10} ${by + 14} 180 22" data-text-box="${bx + 50} ${by + 14} 100 22" style="${TEXT}">Name ${n}</h4><p id="d${n}" data-box="${dates[n] ?? `${bx + 10} ${by + 40} 180 16`}" data-text-box="${bx + 60} ${by + 40} 80 16" style="${TEXT}; font-size:13px">Jan 0${n}, 2026</p></div>`;
    }
    return `<div id="grid" data-box="0 0 ${400 + columnGap} ${210 + 2 * rowGap}">${out}</div>`;
  }

  it("says nothing about six tiles that are the same", () => {
    expect(scan(tiles()).keys).toEqual([]);
  });

  it("lists a row gap that differs from the column gap for review: both may be chosen on purpose", () => {
    const found = scan(tiles({}, {}, 33, 15));
    expect(found.keys).toEqual(["LAY-03 grid"]);
    expect(finding(found, "LAY-03", "grid")).toMatchObject({ type: "Review", severity: "Low", actual: "33px between columns, 15px between rows" });
  });

  it("still reports columns, or rows, that are not evenly spaced among themselves", () => {
    // The third row sits 9px lower than the row gap of the first two.
    const html = tiles({ 5: "0 189 200 70", 6: "220 189 200 70" });
    const found = scan(html, "normal", ["LAY-03"]);
    expect(found.keys).toEqual(["LAY-03 grid"]);
    expect(finding(found, "LAY-03", "grid")).toMatchObject({ type: "Definite", message: "The gaps between the items of this container are not equal: 20px, 29px." });
  });

  it("LAY-05 reports the tile that is wider than its peers", () => {
    const found = scan(tiles({ 4: "220 90 214 70" }), "normal", ["LAY-05"]);
    expect(found.keys).toEqual(["LAY-05 t4"]);
    expect(finding(found, "LAY-05", "t4")).toMatchObject({ actual: "214 × 70px", expected: "200 × 70px" });
  });

  it("LAY-05 reports a row of tiles that is taller than the others once, on its first tile", () => {
    const found = scan(tiles({ 3: "0 90 200 96", 4: "220 90 200 96" }), "normal", ["LAY-05"]);
    expect(found.keys).toEqual(["LAY-05 t3"]);
    expect(finding(found, "LAY-05", "t3")).toMatchObject({ actual: "200 × 96px", expected: "200 × 70px" });
  });

  it("LAY-05 does not report a tile that is taller because its content is taller", () => {
    // The date of tile 4 is two lines high, so the tile and the tile next to it are taller.
    const found = scan(tiles({ 3: "0 90 200 86", 4: "220 90 200 86" }, { 4: "230 130 180 32" }), "normal", ["LAY-05"]);
    expect(found.keys).toEqual([]);
  });

  it("LAY-03 reports the tile whose date sits further below the name than in its peers", () => {
    // The row of tile 4 is 10px taller, and the last row starts 10px lower.
    const found = scan(tiles({ 3: "0 90 200 80", 4: "220 90 200 80", 5: "0 190 200 70", 6: "220 190 200 70" }, { 4: "230 140 180 16" }), "normal", ["LAY-03", "LAY-05"]);
    expect(found.keys).toEqual(["LAY-03 t4"]);
    const f = finding(found, "LAY-03", "t4");
    expect(f).toMatchObject({ type: "Definite", property: "gap between part 1 and part 2", actual: "14px", expected: "4px" });
    expect(f.message).toBe("The gap between part 1 and part 2 of this item is 14px; in 5 of the 6 items of this group it is 4px.");
    expect(f.marks?.[0]).toMatchObject({ label: "14px", box: { y: 126, height: 14 } });
  });

  it("LAY-03 does not compare the gaps of items whose gaps vary from item to item", () => {
    // Stretched cards: the space between the parts is what is left over.
    const found = scan(tiles({}, { 2: "230 44 180 16", 3: "10 134 180 16", 5: "10 228 180 16" }), "normal", ["LAY-03"]);
    expect(found.keys).toEqual([]);
  });
});

describe("GRP-02 and icon holders", () => {
  /** A row of detail items: an icon in a wrapper of its own, then a label. Both are spans. */
  const detail = (n: number, x: number, text: string): string =>
    `<div data-box="${x} 0 120 20"><span id="i${n}" data-box="${x} 3 14 14"><svg data-box="${x} 3 14 14"></svg></span><span id="l${n}" data-box="${x + 22} 0 90 20" style="${TEXT}">${text}</span></div>`;

  it("does not report a label for lacking the icon that sits next to it in a wrapper of its own", () => {
    const row = (y: number): string => `<div data-box="0 ${y} 400 20">${detail(1, 0, "Dec 12, 2026")}${detail(2, 130, "Head Office")}${detail(3, 260, "8:00 AM")}</div>`;
    const found = scan(`<div>${row(0)}${row(30)}</div>`, "normal", ["GRP-02"]);
    expect(found.keys).toEqual([]);
  });

  it("still reports the item that lacks the icon its peers have beside their label", () => {
    const item = (n: number, icon: boolean): string =>
      `<a id="m${n}" href="#" data-box="0 ${n * 30} 200 24">${icon ? `<svg data-box="8 ${n * 30 + 5} 14 14"></svg>` : ""}<span data-box="30 ${n * 30} 100 24" style="${TEXT}">Item ${n}</span></a>`;
    const found = scan(`<nav>${[1, 2, 3, 4, 5, 6].map((n) => item(n, n !== 4)).join("")}</nav>`, "normal", ["GRP-02"]);
    expect(found.keys).toEqual(["GRP-02 m4"]);
  });
});

describe("tuned on real sites: differences that are not slips", () => {
  const avatars = (odd: number): string => {
    let out = "";
    for (let n = 1; n <= 6; n++) {
      const size = n === 3 ? odd : 40;
      out += `<span id="a${n}" data-box="${n * 60} 0 ${size} ${size}" style="${BOX}"></span>`;
    }
    return `<div data-box="0 0 600 100">${out}</div>`;
  };

  it("LAY-05 reports a box a little larger than its peers, not one of another size altogether", () => {
    expect(scan(avatars(44), "normal", ["LAY-05"]).keys).toEqual(["LAY-05 a3"]);
    // Twice the size is another kind of box (a chart among sparklines, a card that spans two columns).
    expect(scan(avatars(80), "normal", ["LAY-05"]).keys).toEqual([]);
  });

  it("GRP-02 does not report an item that holds the part in another look", () => {
    // Five cards with a photo (a drawn box without text); the sixth shows initials in a box of the same size.
    const card = (n: number, initials: boolean): string =>
      `<a id="c${n}" href="#" data-box="0 ${n * 60} 200 50"><span data-box="8 ${n * 60 + 5} 40 40" style="${BOX}${initials ? `; ${TEXT}` : ""}">${initials ? "SA" : ""}</span><b data-box="60 ${n * 60} 100 24" style="${TEXT}">Name ${n}</b></a>`;
    const cards = (initials: boolean): string => `<nav>${[1, 2, 3, 4, 5, 6].map((n) => card(n, initials && n === 4)).join("")}</nav>`;
    expect(scan(cards(true), "normal", ["GRP-02"]).keys).toEqual([]);
  });

  it("does not report the coloured words of a code sample", () => {
    const words = items({ 2: "color:rgb(200, 30, 30); font-size:22px" });
    expect(scan(words, "normal", ["TYP-02", "TYP-05"]).keys.length).toBeGreaterThan(0);
    expect(scan(`<pre>${words}</pre>`, "normal", ["TYP-02", "TYP-05"]).keys).toEqual([]);
    expect(scan(`<div><code>${words}</code></div>`, "normal", ["TYP-02", "TYP-05"]).keys).toEqual([]);
  });

  it("FMT-01 reads a date in May in the month form its peers use", () => {
    const dates = (texts: string[]): string => `<div>${texts.map((t, n) => `<span id="d${n + 1}" style="${TEXT}">${t}</span>`).join("")}</div>`;
    expect(scan(dates(["March 3, 2026", "April 9, 2026", "May 30, 2026", "August 1, 2026", "October 7, 2026"]), "normal", ["FMT-01"]).keys).toEqual([]);
    expect(scan(dates(["Mar 3, 2026", "Apr 9, 2026", "May 30, 2026", "Aug 1, 2026", "Oct 7, 2026"]), "normal", ["FMT-01"]).keys).toEqual([]);
    expect(scan(dates(["March 3, 2026", "April 9, 2026", "May 30, 2026", "Aug 1, 2026", "October 7, 2026"]), "normal", ["FMT-01"]).keys).toEqual(["FMT-01 d4"]);
  });
});
