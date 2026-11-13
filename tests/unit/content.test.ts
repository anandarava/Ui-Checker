import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanOptions } from "@shared/types";
import { describeTokens, parseColour, parseLength, parseTokens } from "@shared/tokens";
import { buildAudit, type RawScaleList, type RawScaleValue } from "@src/content/audit";
import { findPeerGroups } from "@src/content/grouping";
import { runRules, type RawFinding } from "@src/content/rules";
import { typedEllipsis, valueFormat } from "@src/content/rules/content";
import { takeSnapshot, type PageSnapshot } from "@src/content/snapshot";

/**
 * jsdom does no layout: data-box="x y width height" gives an element its box
 * (default 10 x 10 at 0,0), data-text-box the box of its own text and
 * data-scroll="width" the width of its content (so a box that hides overflow
 * is shortened by the browser when its content is wider than 0).
 */
function rectOf(spec: string | null, fallback: number[]): DOMRect {
  const [x, y, width, height] = spec ? spec.split(/\s+/).map(Number) : fallback;
  return { x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON: () => ({}) } as DOMRect;
}

beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return rectOf(this.getAttribute("data-box"), [0, 0, 10, 10]);
  });
  Range.prototype.getBoundingClientRect = function (this: Range) {
    return rectOf(this.startContainer.parentElement?.getAttribute("data-text-box") ?? null, [0, 0, 0, 0]);
  };
  vi.spyOn(Element.prototype, "scrollWidth", "get").mockImplementation(function (this: Element) {
    return Number(this.getAttribute("data-scroll") ?? 0);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

interface Found {
  snapshot: PageSnapshot;
  findings: RawFinding[];
  /** "RULE id-of-element type" for every finding, in order. */
  keys: string[];
}

const NEW_RULES = ["TYP-07", "TXT-01", "TXT-02", "TXT-03", "FMT-01"];

function scan(html: string, only: string[] = NEW_RULES): Found {
  document.body.innerHTML = html;
  const snapshot = takeSnapshot(document.body);
  const groups = findPeerGroups(snapshot.elements);
  const options: ScanOptions = { scope: "page", tolerancePreset: "normal", rules: [] };
  const { findings } = runRules(snapshot.elements, groups, options, only);
  return { snapshot, findings, keys: findings.map((f) => `${f.ruleId} ${snapshot.nodes[f.element].id} ${f.type}`) };
}

const TEXT = "font-family:Arial; font-size:16px; font-weight:400; color:rgb(20, 20, 20)";
const CUT = "overflow-x:hidden; overflow-y:hidden; white-space:nowrap; text-overflow:ellipsis";

/** A column of cells; `cells[n]` is [text, extra attributes]. */
function column(cells: Array<[string, string?]>): string {
  return `<div>${cells.map(([text, attrs = ""], n) => `<div><span id="c${n + 1}" style="${TEXT}" ${attrs}>${text}</span></div>`).join("")}</div>`;
}

describe("typedEllipsis", () => {
  it("describes how an ellipsis is written", () => {
    expect(typedEllipsis("Sampath ...")).toBe('typed " ..."');
    expect(typedEllipsis("Akhil Thu…")).toBe('typed "…"');
    expect(typedEllipsis("Trainee Softwa...")).toBe('typed "..."');
    expect(typedEllipsis("Event - ...")).toBe('typed " ..." after a separator');
    expect(typedEllipsis("Event - A...")).toBe('typed "..."');
  });

  it("is null for a text that does not end in one", () => {
    expect(typedEllipsis("Sampath Kumaran")).toBeNull();
    expect(typedEllipsis("...")).toBeNull();
    expect(typedEllipsis("v1.2.3")).toBeNull();
  });
});

describe("valueFormat", () => {
  const format = (text: string, transform?: string): string | undefined => valueFormat(text, transform)?.format;

  it("reads date formats", () => {
    expect(valueFormat("05/10/2026")).toEqual({ type: "date", format: "DD/MM/YYYY" });
    expect(format("5.10.26")).toBe("DD.MM.YY");
    expect(format("2026-10-05")).toBe("YYYY-MM-DD");
    expect(format("Oct 5, 2026")).toBe("Mon D, YYYY");
    expect(format("October 5 2026")).toBe("Month D YYYY");
    expect(format("5 Oct 2026")).toBe("D Mon YYYY");
    expect(format("5th October")).toBe("Dth Month");
    expect(format("Nov 15")).toBe("Mon D");
    expect(format("Mon, Nov 15")).toBe("Mon D");
  });

  it("reads time formats", () => {
    expect(valueFormat("8:00 AM")).toEqual({ type: "time", format: "H:MM AM" });
    expect(format("8:00am")).toBe("H:MMam");
    expect(format("14:30")).toBe("H:MM");
    expect(format("14:30:05")).toBe("H:MM:SS");
  });

  it("reads the unit and the thousands separator of a number, not its decimals", () => {
    expect(valueFormat("1,234.50")).toMatchObject({ type: "number", format: "#", thousands: "," });
    expect(valueFormat("1234")).toMatchObject({ type: "number", thousands: "none" });
    expect(valueFormat("12")?.thousands).toBeUndefined();
    expect(valueFormat("3.7")).toMatchObject({ type: "number", format: "#" });
    expect(valueFormat("$12.00")).toMatchObject({ format: "$#", unit: "$" });
    expect(valueFormat("92 %")).toMatchObject({ format: "# %", unit: "%" });
    expect(valueFormat("92%")).toMatchObject({ format: "#%", unit: "%" });
  });

  it("reads how a short label is capitalised, and leaves names and abbreviations alone", () => {
    expect(format("Head Office")).toBe("Capitalised");
    expect(format("remote")).toBe("lower case");
    expect(format("MARKETING")).toBe("UPPER CASE");
    expect(format("Remote", "uppercase")).toBe("UPPER CASE");
    expect(valueFormat("QA")).toBeNull();
    expect(valueFormat("jQuery")).toBeNull();
    expect(valueFormat("a.person@example.test")).toBeNull();
    expect(valueFormat("A sentence of more than four words here")).toBeNull();
  });
});

describe("TXT-02: shortened text that cannot be read in full", () => {
  it("reports a text the browser shortens when nothing holds the full text", () => {
    const found = scan(`
      <div id="a" style="${TEXT}; ${CUT}" data-scroll="300">A very long value that does not fit</div>
      <div id="b" style="${TEXT}; ${CUT}" data-scroll="300" title="A very long value that does not fit">A very long value that does not fit</div>
      <div id="c" style="${TEXT}; ${CUT}">Fits</div>`);
    expect(found.keys).toEqual(["TXT-02 a Definite"]);
  });

  it("accepts a title on a wrapper or on the text inside", () => {
    const found = scan(`
      <div title="Full text"><div id="a" style="${TEXT}; ${CUT}" data-scroll="300">Full te</div></div>
      <div id="b" style="${TEXT}; ${CUT}" data-scroll="300"><span title="Full text">Full te</span></div>
      <div id="c" style="${TEXT}; ${CUT}" data-scroll="300" aria-label="Full text">Full te</div>`);
    expect(found.keys).toEqual([]);
  });

  it("lists a shortened link for review: the page it opens may show the text", () => {
    const found = scan(`<a id="a" href="#" style="${TEXT}; ${CUT}; display:block" data-scroll="300">A long headline that is cut</a>`, ["TXT-02"]);
    expect(found.keys).toEqual(["TXT-02 a Review"]);
  });
});

describe("TXT-01: text that is cut off or runs out of its box", () => {
  const BOX = "border-top-width:1px; border-right-width:1px; border-bottom-width:1px; border-left-width:1px; background-color:rgb(250, 250, 250)";

  it("reports text hidden by its own box with no ellipsis", () => {
    const found = scan(`
      <div id="a" style="${TEXT}; overflow-x:hidden; white-space:nowrap" data-box="0 0 100 20" data-text-box="0 0 160 20">A text wider than its box</div>
      <div id="b" style="${TEXT}; overflow-x:hidden; white-space:nowrap" data-box="0 30 100 20" data-text-box="0 30 80 20">Fits</div>`, ["TXT-01"]);
    expect(found.keys).toEqual(["TXT-01 a Definite"]);
    expect(found.findings[0].actual).toBe("60px cut off");
  });

  it("leaves a text with an ellipsis and a visually hidden text alone", () => {
    const found = scan(`
      <div id="a" style="${TEXT}; ${CUT}" data-box="0 0 100 20" data-text-box="0 0 160 20" data-scroll="160">Shortened with an ellipsis</div>
      <a id="b" href="#" style="${TEXT}; position:absolute; overflow-x:hidden; white-space:nowrap" data-box="0 30 30 20" data-text-box="0 30 120 20">Skip to content</a>`, ["TXT-01"]);
    expect(found.keys).toEqual([]);
  });

  it("reports text that runs out of the box it is drawn in", () => {
    const found = scan(`
      <div id="box" style="${BOX}" data-box="0 0 70 20"><span id="a" style="${TEXT}" data-box="0 0 76 20" data-text-box="0 0 76 20">Organization</span></div>
      <div id="box2" style="${BOX}" data-box="0 30 70 20"><span id="b" style="${TEXT}" data-box="0 30 40 20" data-text-box="0 30 40 20">Home</span></div>`, ["TXT-01"]);
    expect(found.keys).toEqual(["TXT-01 a Definite"]);
    expect(found.findings[0].message).toContain("runs 6px out of the box");
  });
});

describe("TXT-03: text shortened in different ways", () => {
  const cut = `data-scroll="300"`;
  const cell = (id: string, text: string, attrs = ""): string => `<div id="${id}" style="${TEXT}; ${CUT}" ${attrs}>${text}</div>`;

  it("reports an ellipsis typed into the text where the peers are shortened by the browser", () => {
    const found = scan(`<div>${cell("n1", "Tara Balakrishnan", cut)}${cell("n2", "Sampath ...")}${cell("n3", "Akhil Thurairajah", cut)}${cell("n4", "Swati Shanmugam")}</div>`, ["TXT-03"]);
    expect(found.keys).toEqual(["TXT-03 n2 Definite"]);
    expect(found.findings[0]).toMatchObject({ expected: "shortened by the browser", actual: 'typed " ..."' });
  });

  it("reports typed ellipses that are written differently", () => {
    const found = scan(`<div>${cell("n1", "Event one...")}${cell("n2", "Event two...")}${cell("n3", "Event three…")}${cell("n4", "Event four...")}</div>`, ["TXT-03"]);
    expect(found.keys).toEqual(["TXT-03 n3 Definite"]);
    expect(found.findings[0]).toMatchObject({ kind: "outlier", actual: 'typed "…"', expected: 'typed "..."' });
  });

  it("says nothing when every text is shortened the same way, or only one is", () => {
    expect(scan(`<div>${cell("n1", "One", cut)}${cell("n2", "Two", cut)}${cell("n3", "Three")}</div>`, ["TXT-03"]).keys).toEqual([]);
    expect(scan(`<div>${cell("n1", "Loading...")}${cell("n2", "Two")}${cell("n3", "Three")}</div>`, ["TXT-03"]).keys).toEqual([]);
  });
});

describe("FMT-01: value formats", () => {
  it("reports the date written differently from the rest of its column", () => {
    const found = scan(column([["02/11/2026"], ["22/10/2026"], ["Oct 5, 2026"], ["05/10/2026"], ["01/10/2026"]]), ["FMT-01"]);
    expect(found.keys).toEqual(["FMT-01 c3 Definite"]);
    expect(found.findings[0]).toMatchObject({ property: "date format", actual: "Mon D, YYYY", expected: "DD/MM/YYYY" });
  });

  it("ignores the cells of a date column that are not dates, and columns that are mostly text", () => {
    expect(scan(column([["02/11/2026"], ["22/10/2026"], ["16/10/2026"], ["05/10/2026"], ["01/10/2026"], ["-"]]), ["FMT-01"]).keys).toEqual([]);
    expect(scan(column([["02/11/2026"], ["Oct 5, 2026"], ["Head Office"], ["Remote"], ["Marketing"]]), ["FMT-01"]).keys).toEqual([]);
  });

  it("lists one unit written in two ways for review, and does not compare decimals", () => {
    const found = scan(column([["92%"], ["85%"], ["7 %"], ["64%"]]), ["FMT-01"]);
    expect(found.keys).toEqual(["FMT-01 c3 Review"]);
    expect(scan(column([["4"], ["3.7"], ["6"], ["4.3"]]), ["FMT-01"]).keys).toEqual([]);
  });

  it("lists 1,000 against 1000 for review", () => {
    const found = scan(column([["1,200"], ["3,450"], ["2100"], ["12,000"], ["15"]]), ["FMT-01"]);
    expect(found.keys).toEqual(["FMT-01 c3 Review"]);
    expect(found.findings[0].property).toBe("thousands separator");
  });

  it("lists a single lower-case label among capitalised ones for review, but not names", () => {
    const labels = (odd: string): string => column([["Marketing"], ["Training"], [odd], ["Head Office"], ["Remote"], ["Finance"]]);
    expect(scan(labels("sales"), ["FMT-01"]).keys).toEqual(["FMT-01 c3 Review"]);
    expect(scan(labels("jQuery"), ["FMT-01"]).keys).toEqual([]);
    expect(scan(labels("QA"), ["FMT-01"]).keys).toEqual([]);
  });
});

describe("TYP-07: link style", () => {
  const link = (id: string, extra = ""): string => `<a id="${id}" href="#" style="${TEXT}; color:rgb(11, 74, 143); ${extra}">Link ${id}</a>`;
  const UNDER = "text-decoration-line:underline";

  it("reports the link of a group that is underlined differently from its peers", () => {
    const found = scan(`<div>${link("l1", UNDER)}${link("l2", UNDER)}${link("l3")}${link("l4", UNDER)}${link("l5", UNDER)}</div>`, ["TYP-07"]);
    expect(found.keys).toEqual(["TYP-07 l3 Definite"]);
    expect(found.findings[0].message).toBe("This link is not underlined; 4 of the 5 links in this group are underlined.");
  });

  it("lists two loose links of the page that differ for review", () => {
    const found = scan(`
      <section style="color:rgb(20, 20, 20)"><h2 style="${TEXT}">Events</h2>${link("l1", UNDER)}</section>
      <article style="color:rgb(20, 20, 20)"><p style="${TEXT}">Place</p><p style="${TEXT}">Other</p><i style="${TEXT}">x</i>${link("l2")}</article>`, ["TYP-07"]);
    expect(found.keys).toEqual(["TYP-07 l2 Review"]);
  });

  it("does not compare links that look like plain text, links in navigation, or a link with one in a sentence", () => {
    const plain = `<a id="p1" href="#" style="${TEXT}">Plain link</a>`;
    expect(scan(`<section style="color:rgb(20, 20, 20)"><h2 style="${TEXT}">A</h2>${link("l1", UNDER)}</section><article style="color:rgb(20, 20, 20)"><h3 style="${TEXT}">B</h3><b style="${TEXT}">c</b>${plain}</article>`, ["TYP-07"]).keys).toEqual([]);
    expect(scan(`<section style="color:rgb(20, 20, 20)"><h2 style="${TEXT}">A</h2>${link("l1", UNDER)}</section><nav style="color:rgb(20, 20, 20)"><h3 style="${TEXT}">B</h3><b style="${TEXT}">c</b>${link("l2")}</nav>`, ["TYP-07"]).keys).toEqual([]);
    expect(scan(`<section style="color:rgb(20, 20, 20)"><h2 style="${TEXT}">A</h2>${link("l1", UNDER)}</section><p style="${TEXT}">Read ${link("l2")} first.</p>`, ["TYP-07"]).keys).toEqual([]);
  });
});

describe("design-scale audit", () => {
  const PAGE = `
    <h1 id="h" style="font-family:Inter; font-size:28px; font-weight:700; color:rgb(17, 17, 17)">Title</h1>
    <div id="card1" style="padding-top:16px; padding-left:16px; padding-right:16px; padding-bottom:16px; background-color:rgb(255, 255, 255)">
      <p id="p1" style="font-family:Inter; font-size:16px; font-weight:400; color:rgb(17, 17, 17); margin-bottom:8px">One</p>
      <p id="p2" style="font-family:Inter; font-size:16px; font-weight:400; color:rgb(17, 17, 17); margin-bottom:8px">Two</p>
      <p id="p3" style="font-family:Inter; font-size:15px; font-weight:400; color:rgb(19, 19, 19); margin-bottom:10px">Three</p>
    </div>
    <div id="card2" style="display:flex; row-gap:12px; column-gap:12px; padding-top:16px; padding-left:16px; background-color:rgb(255, 255, 255)">
      <span id="s1" style="font-family:Inter; font-size:16px; font-weight:400; color:rgb(11, 74, 143)">A</span>
      <span id="s2" style="font-family:Inter; font-size:16px; font-weight:400; color:rgb(11, 74, 143)">B</span>
    </div>`;

  function audit(html: string, tokens: Parameters<typeof buildAudit>[1] = null): { lists: Record<string, RawScaleList>; value(kind: string, value: string): RawScaleValue; ids(v: RawScaleValue): string[] } {
    document.body.innerHTML = html;
    const snapshot = takeSnapshot(document.body);
    const lists = Object.fromEntries(buildAudit(snapshot.elements, tokens).map((l) => [l.kind, l]));
    return {
      lists,
      value: (kind, value) => {
        const found = lists[kind].values.find((v) => v.value === value);
        if (!found) throw new Error(`${kind} ${value} not listed; got ${lists[kind].values.map((v) => v.value).join(", ")}`);
        return found;
      },
      ids: (v) => v.elements.map((i) => snapshot.nodes[i].id),
    };
  }

  it("lists the scale with the elements that use each value", () => {
    const a = audit(PAGE);
    expect(a.lists.fontFamily.values.map((v) => `${v.value} ${v.elements.length}`)).toEqual(["Inter 6"]);
    expect(a.lists.fontSize.values.map((v) => v.value)).toEqual(["15px", "16px", "28px"]);
    expect(a.ids(a.value("fontSize", "16px"))).toEqual(["p1", "p2", "s1", "s2"]);
    expect(a.lists.fontWeight.values.map((v) => v.value)).toEqual(["400", "700"]);
    expect(a.lists.spacing.values.map((v) => v.value)).toEqual(["8px", "10px", "12px", "16px"]);
    expect(a.value("spacing", "16px").detail).toBe("padding 2");
    expect(a.value("spacing", "12px").detail).toBe("gap 1");
    expect(a.value("color", "rgb(255, 255, 255)").detail).toBe("background 2");
  });

  it("marks values used once, spacing off the grid and near-duplicate colours", () => {
    const a = audit(PAGE);
    const flags = (kind: string, value: string): string[] => a.value(kind, value).flags.map((f) => f.kind);
    expect(flags("fontSize", "15px")).toEqual(["once"]);
    expect(flags("fontSize", "16px")).toEqual([]);
    // 8, 8, 12, 16, 16 are multiples of 4; 10 is not.
    expect(a.lists.spacing.note).toContain("follows a 4px grid");
    expect(flags("spacing", "10px")).toEqual(["once", "offGrid"]);
    expect(flags("spacing", "8px")).toEqual([]);
    expect(flags("color", "rgb(19, 19, 19)")).toEqual(["nearDuplicate"]);
    expect(a.value("color", "rgb(19, 19, 19)").flags[0].message).toContain("rgb(17, 17, 17)");
    expect(flags("color", "rgb(11, 74, 143)")).toEqual([]);
  });

  it("does not mark values off the grid on a page that follows none", () => {
    const row = (n: number, px: number): string => `<p id="r${n}" style="font-size:16px; margin-bottom:${px}px">x</p>`;
    const a = audit(row(1, 10) + row(2, 14) + row(3, 15) + row(4, 8));
    expect(a.lists.spacing.note).toContain("does not follow a 4px grid");
    expect(a.lists.spacing.values.flatMap((v) => v.flags.map((f) => f.kind))).not.toContain("offGrid");
  });

  it("checks against the design tokens when a token file is loaded", () => {
    const tokens = parseTokens(
      JSON.stringify({
        color: { $type: "color", text: { $value: "#111111" }, card: { $value: "#fff" }, brand: { $value: "#0b4a8f" } },
        space: { $type: "dimension", s: { $value: "8px" }, m: { $value: "12px" }, l: { $value: "16px" } },
        size: { font: { $type: "dimension", body: { $value: "16px" }, title: { $value: "28px" } } },
      }),
      "team.tokens.json",
    );
    const a = audit(PAGE, tokens);
    expect(a.value("spacing", "8px")).toMatchObject({ token: "space.s", flags: [] });
    expect(a.value("spacing", "10px").flags).toEqual([{ kind: "notToken", message: "Not a design token. The closest is space.s (8px)." }]);
    expect(a.value("color", "rgb(19, 19, 19)")).toMatchObject({ token: "color.text", flags: [] });
    expect(a.value("color", "rgb(11, 74, 143)").token).toBe("color.brand");
    // No font sizes among the tokens' names that say so... "size.font" is not recognised as a font size.
    expect(a.lists.spacing.note).toBe("1 value is not in team.tokens.json.");
    // A kind the file has no tokens for is still judged against the page.
    expect(a.value("fontWeight", "700").flags).toEqual([]);
    expect(a.lists.fontFamily.note).toBeUndefined();
  });
});

describe("design tokens", () => {
  it("reads colours and lengths", () => {
    expect(parseColour("#0b4a8f")).toBe("rgb(11, 74, 143)");
    expect(parseColour("#FFF")).toBe("rgb(255, 255, 255)");
    expect(parseColour("#00000080")).toBe("rgba(0, 0, 0, 0.502)");
    expect(parseColour("rgba(11, 74, 143, 0.5)")).toBe("rgba(11, 74, 143, 0.5)");
    expect(parseColour("hsl(0, 0%, 100%)")).toBe("rgb(255, 255, 255)");
    expect(parseColour({ colorSpace: "srgb", components: [1, 0, 0] })).toBe("rgb(255, 0, 0)");
    expect(parseColour("16px")).toBeNull();
    expect(parseLength("16px")).toBe(16);
    expect(parseLength("1.5rem")).toBe(24);
    expect(parseLength(8)).toBe(8);
    expect(parseLength({ value: 4, unit: "px" })).toBe(4);
    expect(parseLength("50%")).toBeNull();
  });

  it("reads the Design Tokens format: inherited types, aliases and typography", () => {
    const t = parseTokens(
      JSON.stringify({
        color: { $type: "color", blue: { $value: "#0b4a8f" }, link: { $value: "{color.blue}" }, text: { $value: "#111" } },
        space: { $type: "dimension", sm: { $value: "8px" }, md: { $value: "1rem" } },
        font: { family: { $type: "fontFamily", base: { $value: ["Inter", "sans-serif"] } }, weight: { $type: "fontWeight", bold: { $value: "Bold" } } },
        heading: { $type: "typography", $value: { fontFamily: "{font.family.base}", fontSize: "28px", fontWeight: 700 } },
        radius: { $type: "dimension", card: { $value: "12px" } },
        shadow: { $type: "shadow", card: { $value: { color: "#000", offsetX: "0px" } } },
      }),
      "tokens.json",
    );
    expect(t.name).toBe("tokens.json");
    // The alias repeats a value that is already there.
    expect(t.color).toEqual([{ name: "color.blue", value: "rgb(11, 74, 143)" }, { name: "color.text", value: "rgb(17, 17, 17)" }]);
    expect(t.spacing).toEqual([{ name: "space.sm", value: 8 }, { name: "space.md", value: 16 }]);
    expect(t.fontFamily).toEqual([{ name: "font.family.base", value: "Inter" }]);
    expect(t.fontWeight).toEqual([{ name: "font.weight.bold", value: 700 }]);
    expect(t.fontSize).toEqual([{ name: "heading.fontSize", value: 28 }]);
    expect(describeTokens(t)).toBe("2 colours, 2 spacing values, 1 font size, 1 font weight, 1 font family");
  });

  it("reads Tokens Studio files (value and type, token sets) and plain objects", () => {
    const studio = parseTokens(
      JSON.stringify({
        global: {
          colors: { primary: { value: "#0b4a8f", type: "color" }, accent: { value: "{colors.primary}", type: "color" } },
          spacing: { sm: { value: "8", type: "spacing" } },
          fontSizes: { body: { value: "16", type: "fontSizes" } },
          fontWeights: { regular: { value: "Regular", type: "fontWeights" } },
          lineHeights: { body: { value: "140%", type: "lineHeights" } },
        },
        $themes: [],
      }),
      "studio.json",
    );
    expect(studio.color).toEqual([{ name: "global.colors.primary", value: "rgb(11, 74, 143)" }]);
    expect(studio.spacing).toEqual([{ name: "global.spacing.sm", value: 8 }]);
    expect(studio.fontSize).toEqual([{ name: "global.fontSizes.body", value: 16 }]);
    expect(studio.fontWeight).toEqual([{ name: "global.fontWeights.regular", value: 400 }]);

    const plain = parseTokens(JSON.stringify({ colors: { primary: "#0b4a8f" }, spacing: { sm: "8px", md: 16 }, fontSize: { body: "1rem" }, lineHeight: { body: 1.5 } }), "plain.json");
    expect(plain.color).toEqual([{ name: "colors.primary", value: "rgb(11, 74, 143)" }]);
    expect(plain.spacing).toEqual([{ name: "spacing.sm", value: 8 }, { name: "spacing.md", value: 16 }]);
    expect(plain.fontSize).toEqual([{ name: "fontSize.body", value: 16 }]);
  });

  it("refuses a file that is not JSON or holds no usable token", () => {
    expect(() => parseTokens("not json", "x.json")).toThrow("not valid JSON");
    expect(() => parseTokens("[1, 2]", "x.json")).toThrow("must be a JSON object");
    expect(() => parseTokens(JSON.stringify({ radius: { card: { $value: "12px", $type: "dimension" } } }), "x.json")).toThrow("No font, spacing or colour tokens");
  });
});

describe("IMG-01: images that do not load", () => {
  /** data-img="broken | ok | loading" says what the browser made of an image. */
  function stubImages(): void {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockImplementation(function (this: HTMLImageElement) {
      return this.getAttribute("data-img") !== "loading";
    });
    for (const side of ["naturalWidth", "naturalHeight"] as const) {
      vi.spyOn(HTMLImageElement.prototype, side, "get").mockImplementation(function (this: HTMLImageElement) {
        return this.getAttribute("data-img") === "ok" ? 40 : 0;
      });
    }
  }

  it("reports an image the browser could not load, and not one that is still loading", () => {
    stubImages();
    const found = scan(
      `<img id="a" src="https://x.test/a.png" data-img="broken"><img id="b" src="https://x.test/b.png" data-img="ok">
       <img id="c" src="https://x.test/c.png" data-img="loading"><img id="d" src="https://x.test/d.svg" data-img="broken"><img id="e" data-img="broken">`,
      ["IMG-01"],
    );
    expect(found.keys).toEqual(["IMG-01 a Definite"]);
    expect(found.findings[0]).toMatchObject({ severity: "High", group: -1, message: "This image does not load: https://x.test/a.png" });
  });

  it("reports a background image the server answered with an error for", () => {
    const entries = [{ name: "https://x.test/missing.png", responseStatus: 404 }, { name: "https://x.test/fine.png", responseStatus: 200 }];
    const original = performance.getEntriesByType;
    performance.getEntriesByType = (() => entries) as unknown as typeof performance.getEntriesByType;
    try {
      const found = scan(`<div id="a" style='background-image:url("https://x.test/missing.png")'>x</div><div id="b" style='background-image:url("https://x.test/fine.png")'>y</div>`, ["IMG-01"]);
      expect(found.keys).toEqual(["IMG-01 a Definite"]);
      expect(found.findings[0].message).toBe("The background image of this element does not load: https://x.test/missing.png");
    } finally {
      performance.getEntriesByType = original;
    }
  });
});
