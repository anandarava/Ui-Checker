/**
 * Layout and spacing rules of Phase 3A:
 *
 *   LAY-01  inner padding differs between peer containers
 *   LAY-02  one container is padded unevenly while its peers are not
 *   LAY-03  uneven gaps between the items of a container
 *   LAY-04  edges that do not line up
 *   LAY-05  a box of a different size than its peers
 *   LAY-06  content of a section starts further in than in the other sections
 *
 * Everything is measured from the boxes of the snapshot and judged against the
 * page's own peers, never against fixed values.
 */
import type { ElementSnapshot } from "../snapshot";
import type { RuleContext } from "./index";
import { bucketNumbers, judge, median, px, valueCounts, type Entry, type Verdict } from "./compare";

type Side = "top" | "right" | "bottom" | "left";
const SIDES: Side[] = ["top", "right", "bottom", "left"];
const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

/** Elements that are sized by themselves, not by their text. */
const REPLACED = new Set(["img", "svg", "canvas", "video", "input", "select", "textarea", "iframe"]);
/** Content that is indented by convention. */
/** Table parts: their padding is in the cells. */
const TABLE_BOXES = new Set(["table", "thead", "tbody", "tfoot", "tr"]);
const INDENTED = new Set(["ul", "ol", "dl", "blockquote", "figure", "pre"]);
/** An edge this close to a shared line, but not on it, is a near miss. */
const NEAR_MISS = 8;
/** Gaps smaller than this are items that touch or wrap like words, not a spacing choice. */
const MIN_GAP = 8;
/** Parts up to this width are icons and markers. */
const ICON_SIZE = 24;
/** How many levels up a neighbour may be related to still count as "nearby". */
const NEARBY_LEVELS = 3;

export function runLayoutRules(ctx: RuleContext): void {
  const { elements, groups, facts } = ctx;

  const right = (el: ElementSnapshot): number => el.box.x + el.box.width;
  const bottom = (el: ElementSnapshot): number => el.box.y + el.box.height;
  const inFlow = (i: number): boolean => elements[i].layout.position !== "absolute" && elements[i].layout.position !== "fixed" && elements[i].clip !== "full";
  const flowChildren = (i: number): number[] => elements[i].children.filter(inFlow);
  /** True when the two boxes share a row: they overlap vertically by half the smaller one. */
  const sameRow = (a: ElementSnapshot, b: ElementSnapshot): boolean => Math.min(bottom(a), bottom(b)) - Math.max(a.box.y, b.box.y) >= Math.min(a.box.height, b.box.height) / 2;
  const sameColumn = (a: ElementSnapshot, b: ElementSnapshot): boolean => Math.min(right(a), right(b)) - Math.max(a.box.x, b.box.x) >= Math.min(a.box.width, b.box.width) / 2;
  const rtl = (i: number): boolean => elements[i].style.direction === "rtl";
  /** True when no sibling sits before the element in its row (to its left, or to its right in a right-to-left page). */
  const startsRow = (i: number): boolean => {
    const el = elements[i];
    if (el.parent < 0) return true;
    return !flowChildren(el.parent).some((s) => s !== i && sameRow(elements[s], el) && (rtl(el.parent) ? elements[s].box.x > el.box.x : elements[s].box.x < el.box.x));
  };
  const endsRow = (i: number): boolean => {
    const el = elements[i];
    if (el.parent < 0) return true;
    return !flowChildren(el.parent).some((s) => s !== i && sameRow(elements[s], el) && (rtl(el.parent) ? elements[s].box.x < el.box.x : elements[s].box.x > el.box.x));
  };

  // ---------------------------------------------------------------------------
  // LAY-01 and LAY-02: inner padding
  // ---------------------------------------------------------------------------

  /**
   * The visible gap between each edge of a container and its content. A side
   * is null when the content does not sit against the padding on that side
   * (it is centred, or the container is taller than its content): that gap is
   * free space, not padding, and is not compared.
   */
  const insets = new Map<number, Record<Side, number | null> | null>();
  const insetsOf = (i: number): Record<Side, number | null> | null => {
    if (insets.has(i)) return insets.get(i) ?? null;
    const el = elements[i];
    const kids = flowChildren(i);
    let result: Record<Side, number | null> | null = null;
    if (kids.length > 0 && el.text === "" && !el.scrolls) {
      const pick = (score: (k: ElementSnapshot) => number): ElementSnapshot => elements[kids.reduce((best, k) => (score(elements[k]) < score(elements[best]) ? k : best), kids[0])];
      const measure = (side: Side): number | null => {
        const kid = side === "top" ? pick((k) => k.box.y) : side === "left" ? pick((k) => k.box.x) : side === "right" ? pick((k) => -right(k)) : pick((k) => -bottom(k));
        const gap = side === "top" ? kid.box.y - el.box.y : side === "left" ? kid.box.x - el.box.x : side === "right" ? right(el) - right(kid) : bottom(el) - bottom(kid);
        // The margin of the first or last child is part of the gap but belongs to the content: it is taken off again.
        const margin = Math.max(0, kid.style.margin[side]);
        const padded = el.style.borderWidth[side] + el.style.padding[side] + margin;
        return Math.abs(gap - padded) <= 1 ? gap - margin : null;
      };
      result = { top: measure("top"), right: measure("right"), bottom: measure("bottom"), left: measure("left") };
    }
    insets.set(i, result);
    return result;
  };

  const paddingRules = (): void => {
    if (!ctx.runs("LAY-01") && !ctx.runs("LAY-02")) return;
    const tolerance = ctx.tolerance("LAY-01");
    const uneven = ctx.tolerance("LAY-02");
    const ratio = (a: number, b: number): number => Math.max(a, b) / Math.max(1, Math.min(a, b));

    for (const g of ctx.order) {
      const group = groups[g];
      // Only containers that are drawn (the gap to an invisible edge cannot be seen) and built alike.
      // A table keeps its padding in its cells, and cells follow the size of their own table.
      const members = (group.kind === "level" ? group.members : group.core).filter(
        (i) => facts.kindOf(i) === "group" && facts.hasBox(i) && !TABLE_BOXES.has(elements[i].tag) && !facts.isCell(i) && insetsOf(i) !== null && !ctx.reported("LAY-01", i) && !ctx.reported("LAY-02", i),
      );
      // Boxes of one level are built differently: two of them that differ say nothing, three or more can.
      if (members.length < (group.kind === "level" ? 3 : 2)) continue;
      ctx.looked("LAY-01");
      ctx.looked("LAY-02");

      interface Odd {
        side: Side;
        actual: number;
        expected: string | null;
        verdict: Verdict<number>;
      }
      const odd = new Map<number, Odd[]>();
      for (const side of SIDES) {
        const entries: Array<Entry<number>> = members.flatMap((el) => {
          const value = insetsOf(el)?.[side];
          return value === null || value === undefined ? [] : [{ el, value }];
        });
        if (entries.length < 2) continue;
        const verdict = judge(bucketNumbers(entries, tolerance, px));
        if (verdict.kind === "same") continue;
        const flagged = verdict.kind === "outlier" ? verdict.outliers : verdict.kind === "pair" ? [entries.slice().sort((a, b) => a.el - b.el)[1]] : [];
        for (const entry of flagged) {
          const list = odd.get(entry.el) ?? [];
          list.push({ side, actual: entry.value, expected: verdict.kind === "outlier" ? verdict.expected.label : null, verdict });
          odd.set(entry.el, list);
        }
      }

      for (const [el, all] of odd) {
        const own = insetsOf(el)!;
        // Sides with a clear majority say more than sides where only two members could be compared.
        const sides = all.some((s) => s.expected) ? all.filter((s) => s.expected) : all;
        // LAY-02: the odd side also makes this container lopsided, and its peers are not.
        const lopsided = sides.filter((s) => {
          const other = own[OPPOSITE[s.side]];
          if (other === null || ratio(s.actual, other) <= uneven) return false;
          const peers = members.filter((m) => m !== el).map((m) => insetsOf(m)!).filter((p) => p[s.side] !== null && p[OPPOSITE[s.side]] !== null);
          return peers.length > 0 && peers.filter((p) => ratio(p[s.side]!, p[OPPOSITE[s.side]]!) <= uneven).length * 2 > peers.length;
        });
        const plain = ctx.runs("LAY-02") ? sides.filter((s) => !lopsided.includes(s)) : sides;

        if (lopsided.length > 0 && ctx.runs("LAY-02")) {
          const s = lopsided[0];
          const other = own[OPPOSITE[s.side]]!;
          const pair = s.side === "top" || s.side === "bottom" ? "top and bottom" : "left and right";
          const actual = `${s.side} ${px(s.actual)}, ${OPPOSITE[s.side]} ${px(other)}`;
          ctx.report({
            ruleId: "LAY-02",
            element: el,
            group: g,
            kind: s.verdict.kind === "pair" ? "pair" : "outlier",
            severity: ctx.severity("LAY-02", s.verdict),
            property: `${pair} padding`,
            expected: s.expected ? `${s.side} ${s.expected}` : null,
            actual,
            values: s.verdict.kind === "same" ? [] : valueCounts(s.verdict.buckets),
            message: `The ${pair} padding is uneven (${actual}), while the peers of this container are padded evenly.`,
          });
        }
        if (plain.length > 0 && ctx.runs("LAY-01")) {
          const first = plain[0];
          const actual = plain.map((s) => `${s.side} ${px(s.actual)}`).join(", ");
          const expected = plain.every((s) => s.expected) ? plain.map((s) => `${s.side} ${s.expected}`).join(", ") : null;
          ctx.report({
            ruleId: "LAY-01",
            element: el,
            group: g,
            kind: first.verdict.kind === "pair" ? "pair" : "outlier",
            severity: ctx.severity("LAY-01", first.verdict),
            property: "inner padding",
            expected,
            actual,
            values: first.verdict.kind === "same" ? [] : valueCounts(first.verdict.buckets),
            message: expected ? `The space between the edge and the content is ${actual}; its peers have ${expected}.` : `The space between the edge and the content differs between these two containers: ${actual} here.`,
          });
        }
      }
    }
  };

  // ---------------------------------------------------------------------------
  // LAY-03: gaps
  // ---------------------------------------------------------------------------

  const gapRules = (): void => {
    if (!ctx.runs("LAY-03") && !ctx.runs("LAY-10")) return;
    const tolerance = ctx.tolerance("LAY-03");
    // "Row gap and column gap very different": 2 times under the normal preset.
    const lopsided = 1 + ctx.factor;
    const list = (values: number[]): string => Array.from(new Set(values.map(px))).join(", ");
    const report = (container: number, group: number, actual: string, message: string, values: number[], kind: "outlier" | "pair" | "noMajority" = "noMajority"): void => {
      const counts = new Map<string, number>();
      for (const v of values) counts.set(px(v), (counts.get(px(v)) ?? 0) + 1);
      // The spacing of a toolbar or button group is the business of LAY-10.
      const ruleId = group >= 0 && groups[group].controls && ctx.runs("LAY-10") ? "LAY-10" : "LAY-03";
      ctx.report({ ruleId, element: container, group, kind, severity: "Medium", property: "gap between items", expected: null, actual, values: Array.from(counts, ([value, count]) => ({ value, count })), message });
    };

    for (const g of ctx.order) {
      const group = groups[g];
      const byParent = new Map<number, number[]>();
      for (const m of group.members) {
        if (!inFlow(m) || elements[m].parent < 0 || elements[m].style.transform !== "none") continue;
        // Links and words inside a sentence are spaced by the text between them.
        if (elements[elements[m].parent].text !== "") continue;
        const of = byParent.get(elements[m].parent);
        if (of) of.push(m);
        else byParent.set(elements[m].parent, [m]);
      }
      /** Per container: gaps between neighbours in a row, and gaps between rows (or between stacked items). */
      const measured: Array<{ container: number; along: number[]; across: number[] }> = [];
      for (const [container, members] of byParent) {
        // The cells of a table row are placed by the columns of the table.
        if (members.length < 2 || facts.isRow(container)) continue;
        const order = flowChildren(container);
        const along: number[] = [];
        const across: number[] = [];
        for (let k = 0; k + 1 < members.length; k++) {
          const a = elements[members[k]];
          const b = elements[members[k + 1]];
          // Only neighbours: two peers with something else between them are not spaced as a pair.
          if (order.indexOf(members[k + 1]) !== order.indexOf(members[k]) + 1) continue;
          if (sameRow(a, b)) along.push(b.box.x >= a.box.x ? b.box.x - right(a) : a.box.x - right(b));
          // Stacked blocks of text are spaced by their own margins, which vary with the text. Boxes are spaced by the layout.
          else if (b.box.y >= bottom(a) - 1 && facts.hasBox(members[k]) && facts.hasBox(members[k + 1])) across.push(b.box.y - bottom(a));
        }
        // Boxes that overlap have no gap between them.
        const real = (gaps: number[]): number[] => gaps.filter((v) => v >= 0);
        if (real(along).length + real(across).length > 0) measured.push({ container, along: real(along), across: real(across) });
      }
      if (measured.length === 0) continue;
      ctx.looked("LAY-03");

      for (const { container, along, across } of measured) {
        if (ctx.reported("LAY-03", container)) continue;
        for (const all of [along, across]) {
          // A gap more than twice the usual one separates two sets of items (a spacer, items pushed to the far side).
          const usual = all.length > 0 ? median(all) : 0;
          const gaps = all.filter((v) => v <= Math.max(usual, 1) * 2);
          if (gaps.length < 2 || Math.max(...gaps) - Math.min(...gaps) <= tolerance) continue;
          report(container, g, list(gaps), `The gaps between the items of this container are not equal: ${list(gaps)}.`, gaps);
        }
        if (along.length > 0 && across.length > 0 && !ctx.reported("LAY-03", container)) {
          const a = median(along);
          const b = median(across);
          // Items that touch, or wrap like words, have no gap to compare.
          if (Math.min(a, b) >= MIN_GAP && Math.max(a, b) / Math.min(a, b) > lopsided) {
            report(container, g, `${px(a)} between columns, ${px(b)} between rows`, `The gap between columns (${px(a)}) and the gap between rows (${px(b)}) of this grid are very different.`, [a, b]);
          }
        }
      }

      // The same group spread over several containers (cards in two columns): each container should use the same gap.
      const typical: Array<Entry<number>> = measured
        .filter((m) => (m.along.length > 0) !== (m.across.length > 0))
        .map((m) => ({ el: m.container, value: median(m.along.length > 0 ? m.along : m.across) }));
      if (typical.length >= 2) {
        const verdict = judge(bucketNumbers(typical, tolerance, px));
        const all = typical.map((t) => t.value);
        if (verdict.kind === "outlier") {
          for (const o of verdict.outliers) {
            report(o.el, g, px(o.value), `The items of this container are ${px(o.value)} apart; in the other containers of this group they are ${verdict.expected.label} apart.`, all, "outlier");
          }
        } else if (verdict.kind === "pair") {
          const second = typical.slice().sort((a, b) => a.el - b.el)[1];
          report(second.el, g, px(second.value), `The same items are spaced differently in these two containers: ${list(all)}.`, all, "pair");
        }
      }
    }

    // Two neighbouring gaps in a row that are nearly, but not, equal: an item that
    // should sit in the middle of its neighbours and does not.
    for (const el of elements) {
      if (el.layout.direction !== "row" || el.text !== "" || ctx.reported("LAY-03", el.index)) continue;
      const kids = flowChildren(el.index);
      if (kids.length < 3 || !kids.every((k) => sameRow(elements[k], elements[kids[0]]))) continue;
      // The measured box of a rotated or scaled element is not the box the layout placed.
      if (kids.some((k) => elements[k].style.transform !== "none")) continue;
      const sorted = kids.slice().sort((a, b) => elements[a].box.x - elements[b].box.x);
      const gaps = sorted.slice(1).map((k, n) => elements[k].box.x - right(elements[sorted[n]]));
      ctx.looked("LAY-03");
      for (let k = 0; k + 1 < gaps.length; k++) {
        const [a, b] = [gaps[k], gaps[k + 1]];
        if (Math.min(a, b) <= tolerance || Math.abs(a - b) <= tolerance || Math.max(a, b) / Math.min(a, b) >= 1.25) continue;
        report(el.index, -1, `${px(a)}, ${px(b)}`, `The gaps on the two sides of an item in this row are nearly, but not, equal: ${px(a)} and ${px(b)}.`, [a, b]);
        break;
      }
    }
  };

  // ---------------------------------------------------------------------------
  // LAY-05: size
  // ---------------------------------------------------------------------------

  const sizeRule = (): void => {
    if (!ctx.runs("LAY-05")) return;
    const tolerance = ctx.tolerance("LAY-05");
    /** True when the size of the element on that axis is not just the size of its text. */
    const fixed = (i: number, axis: "width" | "height"): boolean => {
      const el = elements[i];
      if (!el.text || !el.textBox) return true;
      const pad = axis === "width" ? el.style.padding.left + el.style.padding.right + el.style.borderWidth.left + el.style.borderWidth.right : el.style.padding.top + el.style.padding.bottom + el.style.borderWidth.top + el.style.borderWidth.bottom;
      return el.box[axis] - pad - el.textBox[axis] > 2;
    };

    for (const g of ctx.order) {
      const group = groups[g];
      if (group.kind === "level") continue;
      // Boxes without children whose size the layout sets: icons, avatars, images, fields. Table cells follow their column.
      const members = group.members.filter(
        (i) => elements[i].children.length === 0 && !facts.isCell(i) && !facts.isRow(i) && (facts.hasBox(i) || REPLACED.has(elements[i].tag)) && !ctx.reported("LAY-05", i),
      );
      if (members.length < 3) continue;
      ctx.looked("LAY-05");

      const odd = new Map<number, { expected: Partial<Record<"width" | "height", number>>; verdict: Verdict<number> }>();
      for (const axis of ["width", "height"] as const) {
        const entries = members.filter((i) => fixed(i, axis)).map((el) => ({ el, value: elements[el].box[axis] }));
        if (entries.length < 3) continue;
        const verdict = judge(bucketNumbers(entries, tolerance, px));
        // A size is "set by the layout" only when nearly all members share it. Several members of
        // another size are another kind of item (the cells of another column, a larger icon set).
        if (verdict.kind !== "outlier" || verdict.outliers.length > Math.max(1, Math.floor(entries.length * 0.15))) continue;
        for (const o of verdict.outliers) {
          const found = odd.get(o.el) ?? { expected: {}, verdict };
          found.expected[axis] = verdict.expected.entries[0].value;
          odd.set(o.el, found);
        }
      }
      for (const [el, { expected, verdict }] of odd) {
        const box = elements[el].box;
        const size = (w: number, h: number): string => `${Math.round(w * 10) / 10} × ${px(h)}`;
        const want = size(expected.width ?? box.width, expected.height ?? box.height);
        ctx.report({
          ruleId: "LAY-05",
          element: el,
          group: g,
          kind: "outlier",
          severity: ctx.severity("LAY-05", verdict),
          property: "size",
          expected: want,
          actual: size(box.width, box.height),
          values: verdict.kind === "same" ? [] : valueCounts(verdict.buckets),
          message: `This box is ${size(box.width, box.height)}; its peers are ${want}.`,
        });
      }
    }
  };

  // ---------------------------------------------------------------------------
  // LAY-06: content inset of sections
  // ---------------------------------------------------------------------------

  const sectionInsetRule = (): void => {
    if (!ctx.runs("LAY-06")) return;
    const tolerance = ctx.tolerance("LAY-06");
    /** Distance from the section's start edge to the start edge of a child. */
    const inset = (section: number, child: number): number =>
      rtl(section) ? right(elements[section]) - right(elements[child]) : elements[child].box.x - elements[section].box.x;

    for (const g of ctx.order) {
      const group = groups[g];
      const sections = group.members.filter((i) => facts.kindOf(i) === "group" && facts.hasBox(i) && !facts.isRow(i) && !facts.isCell(i));
      if (sections.length < 2) continue;

      const blocks: Array<{ el: number; section: number; inset: number; base: number }> = [];
      for (const section of sections) {
        const starts = flowChildren(section).filter(startsRow);
        if (starts.length === 0) continue;
        // Where the content of this section starts: its child that sits furthest out.
        const base = Math.min(...starts.map((c) => inset(section, c)));
        for (const c of starts) {
          if (facts.kindOf(c) !== "group" || INDENTED.has(elements[c].tag)) continue;
          blocks.push({ el: c, section, inset: inset(section, c), base });
        }
      }
      if (blocks.length < 3) continue;
      ctx.looked("LAY-06");
      const indented = blocks.filter((b) => b.inset - b.base > tolerance);
      // Relative to the page: only when blocks in these sections normally start at the section's content edge.
      if (indented.length === 0 || indented.length * 4 > blocks.length) continue;
      for (const b of indented) {
        ctx.report({
          ruleId: "LAY-06",
          element: b.el,
          group: g,
          kind: "outlier",
          property: "content inset",
          expected: px(b.base),
          actual: px(b.inset),
          values: [
            { value: px(b.base), count: blocks.length - indented.length },
            { value: px(b.inset), count: 1 },
          ],
          message: `This block starts ${px(b.inset)} from the edge of its section; the other content of these sections starts at ${px(b.base)}.`,
        });
      }
    }
  };

  // ---------------------------------------------------------------------------
  // LAY-04: edges
  // ---------------------------------------------------------------------------

  /** Peers that share a row should start at the same height; peers stacked in a column should start at the same side. */
  const peerEdgeRule = (): void => {
    const tolerance = ctx.tolerance("LAY-04");
    for (const g of ctx.order) {
      const group = groups[g];
      const members = group.members.filter((i) => inFlow(i) && !ctx.reported("LAY-04", i));
      if (members.length < 2) continue;
      const parent = elements[members[0]].parent;
      if (parent < 0 || members.some((m) => elements[m].parent !== parent)) continue;
      const container = elements[parent];
      const first = elements[members[0]];
      const align = container.layout.alignItems;

      let property: string;
      let value: (el: ElementSnapshot) => number;
      let describe: (delta: number) => string;
      if (container.layout.direction === "row" && members.every((m) => sameRow(elements[m], first))) {
        if (align.includes("baseline")) continue;
        if (align === "center") {
          // Items centred on a line are checked by LAY-07.
          if (ctx.runs("LAY-07")) continue;
          property = "vertical centre";
          value = (el) => el.box.y + el.box.height / 2;
        } else if (align === "flex-end" || align === "end") {
          property = "bottom edge";
          value = bottom;
        } else {
          property = "top edge";
          value = (el) => el.box.y;
        }
        describe = (d) => `${px(Math.abs(d))} ${d > 0 ? "lower" : "higher"} than`;
      } else if (members.every((m) => sameColumn(elements[m], first)) && !members.some((m) => m !== members[0] && sameRow(elements[m], first))) {
        const stacked = container.layout.direction === "column" || container.layout.direction === null;
        if (!stacked) continue;
        if (container.layout.direction === "column" && align === "center") {
          property = "horizontal centre";
          value = (el) => el.box.x + el.box.width / 2;
        } else if ((container.layout.direction === "column" && (align === "flex-end" || align === "end")) !== rtl(parent)) {
          property = "right edge";
          value = right;
        } else {
          property = "left edge";
          value = (el) => el.box.x;
        }
        describe = (d) => `${px(Math.abs(d))} further ${d > 0 ? "right" : "left"} than`;
      } else {
        continue;
      }

      ctx.looked("LAY-04");
      const entries = members.map((el) => ({ el, value: value(elements[el]) }));
      const verdict = judge(bucketNumbers(entries, tolerance, px));
      if (verdict.kind === "same" || verdict.kind === "noMajority") continue;
      const values = valueCounts(verdict.buckets);
      const severity = ctx.severity("LAY-04", verdict);
      if (verdict.kind === "outlier") {
        const usual = verdict.expected.entries[0].value;
        for (const o of verdict.outliers) {
          // A whole step away (an indented sub-item, an item on another row) is placed there on purpose.
          if (Math.abs(o.value - usual) >= NEAR_MISS) continue;
          const text = describe(o.value - usual);
          ctx.report({ ruleId: "LAY-04", element: o.el, group: g, kind: "outlier", severity, property, expected: "in line with its peers", actual: `${text} its peers`, values, message: `The ${property} of this element is ${text} its ${verdict.expected.entries.length} peers.` });
        }
      } else {
        const [a, b] = entries.slice().sort((x, y) => x.el - y.el);
        if (Math.abs(b.value - a.value) >= NEAR_MISS) continue;
        const text = describe(b.value - a.value);
        ctx.report({ ruleId: "LAY-04", element: b.el, group: g, kind: "pair", severity, property, expected: null, actual: `${text} its peer`, values, message: `The ${property} of this element is ${text} its peer.` });
      }
    }
  };

  /**
   * Near misses: an element whose edge is a few pixels away from an edge that
   * several nearby elements share, and that shares its own edge with nothing.
   * Finds a page title that is 4px off the content below it, or a box that
   * ends 7px short of the table above it.
   */
  const nearMissRule = (): void => {
    const tolerance = ctx.tolerance("LAY-04");
    const ancestors = (i: number): Set<number> => {
      const out = new Set<number>();
      for (let p = elements[i].parent; p >= 0; p = elements[p].parent) out.add(p);
      return out;
    };
    const contentLeft = (el: ElementSnapshot): number => el.box.x + el.style.borderWidth.left + el.style.padding.left;
    const contentRight = (el: ElementSnapshot): number => right(el) - el.style.borderWidth.right - el.style.padding.right;
    /** The text of the element starts where its content box starts (it is not centred or pushed away). */
    const textAtStart = (el: ElementSnapshot): boolean =>
      el.textBox !== null && (el.style.direction === "rtl" ? Math.abs(el.textBox.x + el.textBox.width - contentRight(el)) <= 1 : Math.abs(el.textBox.x - contentLeft(el)) <= 1);

    interface Carrier {
      el: number;
      edge: number;
      /** Width of the box or text that carries the edge. */
      extent: number;
    }
    const lines: Record<"left" | "right", Carrier[]> = { left: [], right: [] };
    const candidates: Array<{ el: number; side: "left" | "right"; edge: number; other: number }> = [];

    for (const el of elements) {
      const i = el.index;
      if (!inFlow(i) || el.parent < 0) continue;
      // Text in the middle of a sentence lines up with nothing.
      if (elements[el.parent].text !== "") continue;
      const cell = facts.isCell(i) || facts.isRow(i);
      const boxed = facts.hasBox(i);
      const startText = el.text !== "" && textAtStart(el);
      const start = el.style.direction === "rtl" ? "right" : "left";

      if (boxed) {
        lines.left.push({ el: i, edge: el.box.x, extent: el.box.width });
        lines.right.push({ el: i, edge: right(el), extent: el.box.width });
      }
      if (startText && el.textBox) lines[start].push({ el: i, edge: start === "left" ? el.textBox.x : el.textBox.x + el.textBox.width, extent: el.textBox.width });

      // Candidates: what is positioned on its own. A table cell follows its column, and text inside a box follows the padding of that box.
      if (cell) continue;
      const consider = (side: "left" | "right", edge: number, other: number, isBox: boolean): void => {
        // The same edge as its container: the container carries it.
        if (isBox && Math.abs(edge - (side === "left" ? elements[el.parent].box.x : right(elements[el.parent]))) <= 0.5) return;
        // Centred, or pushed to the far side: not meant to sit on a line at this side.
        // An element that fills its container is placed by that container, so look further up.
        let near = edge;
        let far = other;
        for (let p = el.parent, level = 0; p >= 0 && level <= NEARBY_LEVELS; p = elements[p].parent, level++) {
          const box = elements[p];
          const before = side === "left" ? near - contentLeft(box) : contentRight(box) - near;
          const after = side === "left" ? contentRight(box) - far : far - contentLeft(box);
          if (before > 1 && Math.abs(before - after) <= 1) return;
          // Only the element itself: a container that sits beside a sidebar is not "pushed away".
          if (level === 0 && after <= 1 && before > NEAR_MISS) return;
          if (before > 1) break;
          near = side === "left" ? box.box.x : right(box);
          far = side === "left" ? right(box) : box.box.x;
        }
        candidates.push({ el: i, side, edge, other });
      };
      if (boxed) {
        // Only the outermost item of a row is expected to sit on a line at that side.
        const leftmost = start === "left" ? startsRow(i) : endsRow(i);
        const rightmost = start === "left" ? endsRow(i) : startsRow(i);
        if (leftmost) consider("left", el.box.x, right(el), true);
        if (rightmost) consider("right", right(el), el.box.x, true);
      } else if (startText && el.textBox && startsRow(i)) {
        if (start === "left") consider("left", el.textBox.x, el.textBox.x + el.textBox.width, false);
        else consider("right", el.textBox.x + el.textBox.width, el.textBox.x, false);
      }
    }

    lines.left.sort((a, b) => a.edge - b.edge);
    lines.right.sort((a, b) => a.edge - b.edge);
    const firstAtOrAfter = (list: Carrier[], edge: number): number => {
      let lo = 0;
      let hi = list.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid].edge < edge) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };

    for (const c of candidates) {
      if (ctx.reported("LAY-04", c.el)) continue;
      const list = lines[c.side];
      const up = ancestors(c.el);
      // "Nearby": related through one of the closest ancestors.
      const near = new Set<number>();
      for (let p = elements[c.el].parent, level = 0; p >= 0 && level < NEARBY_LEVELS; p = elements[p].parent, level++) near.add(p);
      const related = (other: number): boolean => {
        if (other === c.el || up.has(other)) return false;
        for (let p = elements[other].parent; p >= 0; p = elements[p].parent) {
          if (p === c.el) return false; // its own content
          if (near.has(p)) return true;
        }
        return false;
      };

      // Edges of the boxes this element sits in: being inset from your own container is padding, not a miss.
      const ownBoxes: number[] = [];
      for (const p of up) if (facts.hasBox(p)) ownBoxes.push(c.side === "left" ? elements[p].box.x : right(elements[p]));

      // Something large does not line up with something small: icons and other small parts are no reference for it.
      // Short texts (a number in a table column) still count, so the limit stops at the size of an icon.
      const smallest = Math.min(Math.abs(c.other - c.edge) / 4, ICON_SIZE);
      const neighbours: Carrier[] = [];
      for (let k = firstAtOrAfter(list, c.edge - NEAR_MISS); k < list.length && list[k].edge < c.edge + NEAR_MISS; k++) {
        if (list[k].extent >= smallest && related(list[k].el)) neighbours.push(list[k]);
      }
      // Shares its edge with a neighbour: a line of its own, not a miss.
      if (neighbours.some((n) => Math.abs(n.edge - c.edge) <= 0.5)) continue;

      let best: { edge: number; count: number } | null = null;
      for (const n of neighbours) {
        const distance = Math.abs(n.edge - c.edge);
        if (distance <= tolerance || distance >= NEAR_MISS) continue;
        if (ownBoxes.some((b) => Math.abs(b - n.edge) <= 0.5)) continue;
        const count = new Set(neighbours.filter((m) => Math.abs(m.edge - n.edge) <= 0.5).map((m) => m.el)).size;
        if (count >= 2 && (!best || count > best.count)) best = { edge: n.edge, count };
      }
      if (!best) continue;

      const delta = c.edge - best.edge;
      const where = `${px(Math.abs(delta))} to the ${delta > 0 ? "right" : "left"} of`;
      ctx.report({
        ruleId: "LAY-04",
        element: c.el,
        group: -1,
        kind: "outlier",
        severity: "Medium",
        property: `${c.side} edge`,
        expected: `in line with ${best.count} nearby elements`,
        actual: `${where} them`,
        values: [
          { value: px(best.edge), count: best.count },
          { value: px(c.edge), count: 1 },
        ],
        message: `The ${c.side} edge of this element is ${where} the edge that ${best.count} nearby elements share.`,
      });
    }
    ctx.looked("LAY-04");
  };

  paddingRules();
  gapRules();
  sizeRule();
  sectionInsetRule();
  if (ctx.runs("LAY-04")) {
    peerEdgeRule();
    nearMissRule();
  }
}
