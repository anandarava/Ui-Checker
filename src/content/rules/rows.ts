/**
 * Layout rules of Phase 3B that look at rows, columns and tables:
 *
 *   LAY-07  an item that is not vertically centred in its row
 *   LAY-08  peer columns or cards that end at different heights
 *   LAY-09  a table header that is not aligned with the cells of its column
 *   LAY-10  controls of one row with different heights (their gaps are
 *           reported under LAY-10 by the gap check of layout.ts)
 */
import type { Mark } from "@shared/types";
import type { ElementSnapshot } from "../snapshot";
import type { RuleContext } from "./index";
import { bucketLabels, bucketNumbers, judge, median, px, valueCounts, type Entry } from "./compare";

/** An inline icon is at most this high. */
const INLINE_ICON = 32;
const ICON_TAGS = new Set(["img", "svg", "i", "span"]);
const TABLE_ROLES = new Set(["table", "grid", "treegrid"]);

export type Alignment = "left" | "right" | "centre";

/**
 * Where the text of an element sits in its content box, measured from the
 * text itself: null when the text fills the box (nothing to tell) or sits
 * somewhere else.
 */
export function textAlignment(el: ElementSnapshot, tolerance: number): { align: Alignment; edge: number } | null {
  if (!el.textBox) return null;
  const left = el.textBox.x - (el.box.x + el.style.borderWidth.left + el.style.padding.left);
  const right = el.box.x + el.box.width - el.style.borderWidth.right - el.style.padding.right - (el.textBox.x + el.textBox.width);
  if (left <= tolerance && right <= tolerance) return null;
  if (left <= tolerance) return { align: "left", edge: el.textBox.x };
  if (right <= tolerance) return { align: "right", edge: el.textBox.x + el.textBox.width };
  if (Math.abs(left - right) <= tolerance) return { align: "centre", edge: el.textBox.x + el.textBox.width / 2 };
  return null;
}

export function runRowRules(ctx: RuleContext): void {
  const { elements, groups, facts } = ctx;
  const bottom = (el: ElementSnapshot): number => el.box.y + el.box.height;
  const inFlow = (i: number): boolean => elements[i].layout.position !== "absolute" && elements[i].layout.position !== "fixed" && elements[i].clip !== "full";
  const flowChildren = (i: number): number[] => elements[i].children.filter(inFlow);
  const sameRow = (a: ElementSnapshot, b: ElementSnapshot): boolean => Math.min(bottom(a), bottom(b)) - Math.max(a.box.y, b.box.y) >= Math.min(a.box.height, b.box.height) / 2;
  const centre = (el: ElementSnapshot): number => el.box.y + el.box.height / 2;

  // ---------------------------------------------------------------------------
  // LAY-07: vertical centring
  // ---------------------------------------------------------------------------

  const centringRule = (): void => {
    if (!ctx.runs("LAY-07")) return;
    const tolerance = ctx.tolerance("LAY-07");
    const offCentre = (el: number, delta: number, count: number, group = -1): void => {
      if (ctx.reported("LAY-04", el)) return;
      const where = `${px(Math.abs(delta))} ${delta > 0 ? "lower" : "higher"}`;
      ctx.report({
        ruleId: "LAY-07",
        element: el,
        group,
        kind: count > 1 ? "outlier" : "pair",
        property: "vertical position in the row",
        expected: "centred on the same line as the other items of the row",
        actual: `${where} than them`,
        values: [],
        message: count > 1 ? `This item sits ${where} than the ${count} other items of its row.` : `This item sits ${where} than the item next to it.`,
      });
    };

    /** Icons in a line of text that are off the middle of the text: reported after the loop. */
    const inline: Array<{ el: number; delta: number; key: string }> = [];

    for (const el of elements) {
      // Items of one row: centred on purpose (align-items: center), or all of one height.
      if (el.layout.direction === "row" && el.text === "" && !el.layout.alignItems.includes("baseline")) {
        const kids = flowChildren(el.index);
        if (kids.length >= 2 && kids.every((k) => sameRow(elements[k], elements[kids[0]]))) {
          const heights = kids.map((k) => elements[k].box.height);
          const sameHeight = Math.max(...heights) - Math.min(...heights) <= tolerance;
          if (el.layout.alignItems === "center" || sameHeight) {
            ctx.looked("LAY-07");
            const entries = kids.map((k) => ({ el: k, value: centre(elements[k]) }));
            const verdict = judge(bucketNumbers(entries, tolerance, px));
            if (verdict.kind === "outlier") {
              const usual = median(verdict.expected.entries.map((e) => e.value));
              for (const o of verdict.outliers) offCentre(o.el, o.value - usual, verdict.expected.entries.length);
            } else if (verdict.kind === "pair") {
              // The smaller of the two is the one that was placed against the other.
              const [a, b] = entries;
              const small = elements[a.el].box.height < elements[b.el].box.height ? a : b;
              const large = small === a ? b : a;
              offCentre(small.el, small.value - large.value, 1);
            }
          }
        }
      }

      // An icon in a line of text.
      if (el.text !== "" && el.textBox && el.layout.direction === null && el.textBox.height <= el.style.fontSize * 1.9) {
        const line = el.textBox.y + el.textBox.height / 2;
        for (const k of flowChildren(el.index)) {
          const kid = elements[k];
          if (kid.children.length > 0 || kid.text !== "" || !ICON_TAGS.has(kid.tag) || kid.box.height > INLINE_ICON || kid.box.height < 4) continue;
          if (kid.box.y > el.textBox.y + el.textBox.height || bottom(kid) < el.textBox.y) continue;
          ctx.looked("LAY-07");
          const delta = centre(kid) - line;
          if (Math.abs(delta) <= tolerance || ctx.reported("LAY-04", k)) continue;
          inline.push({ el: k, delta, key: `${kid.tag}|${Math.round(kid.box.width)}|${Math.round(kid.box.height)}|${Math.round(delta * 2)}` });
        }
      }
    }

    // The same kind of icon, the same distance off the text, three times or more: that is how this
    // page sets its icons (on the baseline of the text), which is consistent. One that differs is reported.
    const repeats = new Map<string, number>();
    for (const i of inline) repeats.set(i.key, (repeats.get(i.key) ?? 0) + 1);
    for (const { el, delta, key } of inline) {
      if ((repeats.get(key) ?? 0) >= 3) continue;
      const where = `${px(Math.abs(delta))} ${delta > 0 ? "lower" : "higher"}`;
      ctx.report({
        ruleId: "LAY-07",
        element: el,
        group: -1,
        kind: "pair",
        property: "vertical position in the line",
        expected: "centred on the text next to it",
        actual: `${where} than the text`,
        values: [],
        message: `This icon sits ${where} than the middle of the text next to it.`,
      });
    }
  };

  // ---------------------------------------------------------------------------
  // LAY-08: columns and cards that end at different heights
  // ---------------------------------------------------------------------------

  const columnEndRule = (): void => {
    if (!ctx.runs("LAY-08")) return;
    const tolerance = ctx.tolerance("LAY-08");
    /** A card, or a column of cards. */
    const drawn = (i: number): boolean => {
      if (facts.hasBox(i)) return true;
      const kids = flowChildren(i);
      return kids.length > 0 && facts.hasBox(kids[kids.length - 1]);
    };

    /** The stretch between where a column ends and where its peers end. */
    const endMark = (el: number, usual: number): Mark => {
      const b = elements[el].box;
      const own = b.y + b.height;
      return { box: { x: b.x, y: Math.min(own, usual), width: b.width, height: Math.abs(usual - own) }, label: px(Math.abs(usual - own)) };
    };

    for (const g of ctx.order) {
      const group = groups[g];
      const members = group.members.filter((i) => inFlow(i) && facts.kindOf(i) === "group" && !facts.isRow(i) && !facts.isCell(i) && drawn(i) && !ctx.reported("LAY-08", i));
      if (members.length < 2) continue;
      // Rows of members that share a parent and start at the same height.
      const rows: number[][] = [];
      for (const m of members) {
        const row = rows.find((r) => elements[r[0]].parent === elements[m].parent && Math.abs(elements[r[0]].box.y - elements[m].box.y) <= 2);
        if (row) row.push(m);
        else rows.push([m]);
      }
      for (const row of rows) {
        if (row.length < 2) continue;
        ctx.looked("LAY-08");
        const entries = row.map((el) => ({ el, value: bottom(elements[el]) }));
        const verdict = judge(bucketNumbers(entries, tolerance, px));
        const values = verdict.kind === "same" ? [] : valueCounts(verdict.buckets.map((b) => ({ ...b, label: px(b.entries[0].value - elements[row[0]].box.y) })));
        if (verdict.kind === "outlier") {
          const usual = median(verdict.expected.entries.map((e) => e.value));
          for (const o of verdict.outliers) {
            const where = `${px(Math.abs(o.value - usual))} ${o.value < usual ? "above" : "below"}`;
            ctx.report({ ruleId: "LAY-08", element: o.el, group: g, kind: "outlier", property: "bottom edge", expected: "ends level with its peers", actual: `ends ${where} its peers`, values, message: `This ends ${where} the ${verdict.expected.entries.length} peers beside it.`, marks: [endMark(o.el, usual)] });
          }
        } else if (verdict.kind === "pair") {
          // The one that ends early leaves the hole.
          const [short, long] = entries.slice().sort((a, b) => a.value - b.value);
          const where = px(long.value - short.value);
          ctx.report({ ruleId: "LAY-08", element: short.el, group: g, kind: "pair", property: "bottom edge", expected: null, actual: `ends ${where} above its peer`, values, message: `This ends ${where} above the peer beside it.`, marks: [endMark(short.el, long.value)] });
        }
      }
    }
  };

  // ---------------------------------------------------------------------------
  // LAY-09: table headers and their columns
  // ---------------------------------------------------------------------------

  const tableRule = (): void => {
    if (!ctx.runs("LAY-09")) return;
    const tolerance = ctx.tolerance("LAY-09");
    const isHeader = (el: ElementSnapshot): boolean => el.tag === "th" || el.role === "columnheader";
    const isData = (el: ElementSnapshot): boolean => el.tag === "td" || el.role === "cell" || el.role === "gridcell";
    const tableOf = (i: number): number => {
      for (let p = elements[i].parent; p >= 0; p = elements[p].parent) {
        if (elements[p].tag === "table" || (elements[p].role !== null && TABLE_ROLES.has(elements[p].role!))) return p;
      }
      return -1;
    };

    const tables = new Map<number, { headers: number[]; cells: number[] }>();
    for (const el of elements) {
      if (!isHeader(el) && !isData(el)) continue;
      const table = tableOf(el.index);
      if (table < 0) continue;
      const entry = tables.get(table) ?? { headers: [], cells: [] };
      (isHeader(el) ? entry.headers : entry.cells).push(el.index);
      tables.set(table, entry);
    }

    for (const { headers, cells } of tables.values()) {
      // A column: the cells that start where the header starts and are as wide.
      const columns = new Map<string, number[]>();
      for (const c of cells) {
        const key = `${Math.round(elements[c].box.x)}|${Math.round(elements[c].box.width)}`;
        columns.set(key, [...(columns.get(key) ?? []), c]);
      }
      const done = new Set<string>();
      const check = (key: string, header: number | null): void => {
        const column = (columns.get(key) ?? []).filter((c) => elements[c].text !== "");
        const aligned = column.flatMap((c) => {
          const a = textAlignment(elements[c], tolerance);
          return a ? [{ el: c, value: a.align, edge: a.edge }] : [];
        });
        if (aligned.length < 2) return;
        ctx.looked("LAY-09");
        const verdict = judge(bucketLabels<Alignment>(aligned, (v) => v));
        if (verdict.kind === "noMajority" || verdict.kind === "pair") return;
        const usual: Alignment = verdict.kind === "outlier" ? verdict.expected.entries[0].value : aligned[0].value;
        // One column mixing alignments.
        if (verdict.kind === "outlier" && !done.has(key)) {
          for (const o of verdict.outliers) {
            ctx.report({ ruleId: "LAY-09", element: o.el, group: -1, kind: "outlier", property: "text alignment in the column", expected: usual, actual: o.value, values: valueCounts(verdict.buckets), message: `The text of this cell is aligned ${o.value}; ${verdict.expected.entries.length} cells of its column are aligned ${usual}.` });
          }
        }
        done.add(key);
        if (header === null) return;
        // The header against its column.
        const own = textAlignment(elements[header], tolerance);
        if (!own) return;
        const edge = median(aligned.filter((a) => a.value === usual).map((a) => a.edge));
        if (own.align !== usual) {
          ctx.report({ ruleId: "LAY-09", element: header, group: -1, kind: "outlier", property: "header alignment", expected: usual, actual: own.align, values: [], message: `This header is aligned ${own.align}, but the cells of its column are aligned ${usual}.` });
        } else if (Math.abs(own.edge - edge) > tolerance) {
          const delta = own.edge - edge;
          const where = `${px(Math.abs(delta))} to the ${delta > 0 ? "right" : "left"} of`;
          ctx.report({ ruleId: "LAY-09", element: header, group: -1, kind: "outlier", property: "header alignment", expected: "in line with the cells of its column", actual: `${where} them`, values: [], message: `The text of this header starts ${where} the text of the cells in its column.` });
        }
      };
      for (const h of headers) check(`${Math.round(elements[h].box.x)}|${Math.round(elements[h].box.width)}`, elements[h].text !== "" ? h : null);
      for (const key of columns.keys()) if (!done.has(key)) check(key, null);
    }
  };

  // ---------------------------------------------------------------------------
  // LAY-10: controls of one row
  // ---------------------------------------------------------------------------

  const controlRowRule = (): void => {
    if (!ctx.runs("LAY-10")) return;
    const tolerance = ctx.tolerance("LAY-10");
    /** Odd controls, by what differs: the same difference in three rows or more is how the page builds that row. */
    const odd = new Map<string, Array<() => void>>();
    /** Controls already found odd in a larger group: not compared again in a group inside it. */
    const held = new Set<number>();
    for (const g of ctx.order) {
      const group = groups[g];
      if (!group.controls) continue;
      const members = group.members.filter((i) => inFlow(i) && !ctx.reported("LAY-10", i) && !held.has(i));
      if (members.length < 2) continue;
      ctx.looked("LAY-10");
      const entries: Array<Entry<number>> = members.map((el) => ({ el, value: elements[el].box.height }));
      const verdict = judge(bucketNumbers(entries, tolerance, px));
      if (verdict.kind === "same" || verdict.kind === "noMajority") continue;
      const values = valueCounts(verdict.buckets);
      const severity = ctx.severity("LAY-10", verdict);
      if (verdict.kind === "outlier") {
        for (const o of verdict.outliers) {
          const key = `${elements[o.el].tag}|${px(o.value)}|${verdict.expected.label}`;
          const expected = verdict.expected;
          held.add(o.el);
          odd.set(key, [...(odd.get(key) ?? []), () => ctx.report({ ruleId: "LAY-10", element: o.el, group: g, kind: "outlier", severity, property: "height", expected: expected.label, actual: px(o.value), values, message: `This control is ${px(o.value)} high; the ${expected.entries.length} other controls of its row are ${expected.label}.` })]);
        }
      } else {
        const [a, b] = entries.slice().sort((x, y) => x.el - y.el);
        // Two small icon buttons (a sort arrow and a filter icon) have the size of their icons.
        if (Math.max(a.value, b.value) <= INLINE_ICON / 2 + 8 && elements[a.el].text === "" && elements[b.el].text === "") continue;
        ctx.report({ ruleId: "LAY-10", element: b.el, group: g, kind: "pair", severity, property: "height", expected: null, actual: px(b.value), values, message: `The two controls of this row have different heights: ${px(a.value)} and ${px(b.value)}.` });
      }
    }
    // A smaller button that sits in every toolbar of the page the same way is that toolbar's design.
    for (const reports of odd.values()) if (reports.length < 3) for (const report of reports) report();
  };

  centringRule();
  columnEndRule();
  tableRule();
  controlRowRule();
}
