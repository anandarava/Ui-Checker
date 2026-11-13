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

  it("LAY-01 reports a container padded differently from its peers", () => {
    const found = scan(`<main>${card(1, 0, [16, 16, 16, 16])}${card(2, 220, [16, 16, 16, 16])}${card(3, 440, [24, 24, 24, 24])}${card(4, 660, [16, 16, 16, 16])}</main>`);
    expect(found.keys).toEqual(["LAY-01 c3"]);
    expect(finding(found, "LAY-01", "c3")).toMatchObject({ kind: "outlier", severity: "High", actual: "top 25px, right 25px, bottom 25px, left 25px", expected: "top 17px, right 17px, bottom 17px, left 17px" });
  });

  it("LAY-01 ignores a side where the content does not sit against the padding", () => {
    // The third card is taller than its content: the free space at the bottom is not padding.
    const tall = card(3, 440, [16, 16, 16, 16]).replace('data-box="440 0 200 100"', 'data-box="440 0 200 160"');
    expect(scan(`<main>${card(1, 0, [16, 16, 16, 16])}${card(2, 220, [16, 16, 16, 16])}${tall}</main>`).keys).toEqual([]);
  });

  it("LAY-02 reports the container that is lopsided while its peers are even", () => {
    const found = scan(`<main>${card(1, 0, [20, 20, 20, 20])}${card(2, 220, [20, 20, 68, 20], 148)}${card(3, 440, [20, 20, 20, 20])}</main>`);
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

  it("uses the tolerance of the preset", () => {
    const col = (n: number, x: number, y: number): string => `<div id="p${n}" data-box="${x} ${y} 100 60" style="${BOX}"><p>x</p></div>`;
    const row = `<div style="display:flex; align-items:flex-start" data-box="0 0 400 70">${col(1, 0, 0)}${col(2, 120, 0)}${col(3, 240, 3)}</div>`;
    expect(scan(row, "strict", ["LAY-04"]).keys).toEqual(["LAY-04 p3"]);
    expect(scan(row, "normal", ["LAY-04"]).keys).toEqual(["LAY-04 p3"]);
    expect(scan(row, "relaxed", ["LAY-04"]).keys).toEqual([]);
  });
});
