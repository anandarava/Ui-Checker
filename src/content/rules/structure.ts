/**
 * Group structure and box style rules of Phase 3B:
 *
 *   GRP-01  an element among the controls of a group that is not one of them
 *   GRP-02  a repeated item that lacks a part its peers have
 *   GRP-03  a divider that stops short of its container in one member
 *   BOX-01  corner radius differs
 *   BOX-02  border or shadow differs
 *   BOX-03  background differs
 */
import type { ElementSnapshot } from "../snapshot";
import type { RuleContext } from "./index";
import { bucketLabels, bucketNumbers, judge, px, valueCounts, type Bucket, type Entry, type Verdict } from "./compare";
import { deltaE } from "./color";

const CONTROL_GROUP_ROLES = new Set(["group", "radiogroup", "tablist", "toolbar"]);
/** Roles of elements that are decoration by declaration. */
const DECORATION_ROLES = new Set(["separator", "presentation", "none"]);
/** A part most items have is "missing" in the rest from this share on... */
const CLEAR_SHARE = 0.75;
const CLEAR_GROUP = 5;
/** ...and worth a look for review from this share on. Below it, the part is an extra of a few items. */
const REVIEW_SHARE = 1 / 3;

export function runStructureRules(ctx: RuleContext): void {
  const { elements, groups, facts } = ctx;
  const right = (el: ElementSnapshot): number => el.box.x + el.box.width;
  const bottom = (el: ElementSnapshot): number => el.box.y + el.box.height;
  const inFlow = (i: number): boolean => elements[i].layout.position !== "absolute" && elements[i].layout.position !== "fixed" && elements[i].clip !== "full";
  const flowChildren = (i: number): number[] => elements[i].children.filter(inFlow);
  /** The nearest element around `i` that is drawn as a box. */
  const boxAround = (i: number): number => {
    for (let p = elements[i].parent; p >= 0; p = elements[p].parent) if (facts.hasBox(p)) return p;
    return -1;
  };

  // ---------------------------------------------------------------------------
  // GRP-01: odd element in a group of controls
  // ---------------------------------------------------------------------------

  const oddControlRule = (): void => {
    if (!ctx.runs("GRP-01")) return;
    for (const el of elements) {
      const kids = flowChildren(el.index);
      const controls = kids.filter((k) => facts.isControl(k));
      if (controls.length < 2) continue;
      // A group of controls by its role, or drawn as one box around them (a segmented control).
      if (!(el.role !== null && CONTROL_GROUP_ROLES.has(el.role)) && !facts.hasBox(el.index)) continue;
      ctx.looked("GRP-01");
      for (const k of kids) {
        const kid = elements[k];
        // A stray shape: no text, no content, not a control, and not a thin dividing line.
        if (facts.isControl(k) || kid.text !== "" || kid.children.length > 0) continue;
        if (kid.role !== null && DECORATION_ROLES.has(kid.role)) continue;
        if (kid.tag === "hr" || Math.min(kid.box.width, kid.box.height) <= 2) continue;
        ctx.report({
          ruleId: "GRP-01",
          element: k,
          group: -1,
          kind: "outlier",
          property: "member of a group of controls",
          expected: "a control like the others, or nothing",
          actual: `a ${kid.tag} that is not a control`,
          values: [
            { value: "controls", count: controls.length },
            { value: "other elements", count: 1 },
          ],
          message: `This element sits among the ${controls.length} controls of a group but is not one of them.`,
        });
      }
    }
  };

  // ---------------------------------------------------------------------------
  // GRP-02: a part missing in one item
  // ---------------------------------------------------------------------------

  const missingPartRule = (): void => {
    if (!ctx.runs("GRP-02")) return;
    /** Group index -> the groups derived from it (the parts of its members). */
    const partsOf = new Map<number, number[]>();
    groups.forEach((group, index) => {
      if (group.parent >= 0) partsOf.set(group.parent, [...(partsOf.get(group.parent) ?? []), index]);
    });
    const noun = (part: number): string => {
      const first = elements[groups[part].members[0]];
      if (first.tag === "svg" || first.tag === "img") return "image or icon";
      if (first.text !== "") return "text";
      return first.children.length > 0 ? "part" : "icon or marker";
    };

    for (const g of ctx.order) {
      const group = groups[g];
      const parts = partsOf.get(g);
      // Repeated items only: the boxes of a level group hold different content by nature.
      if (!parts || group.kind === "level" || group.members.length < 3) continue;
      // The rows and data cells of a table hold data: an empty cell is not a missing part.
      // Column headers are not data: a sort icon on some of them is a part.
      const header = (m: number): boolean => elements[m].tag === "th" || elements[m].role === "columnheader";
      if (group.members.some((m) => facts.isRow(m) || (facts.isCell(m) && !header(m)))) continue;
      const interactive = group.members.every((m) => facts.isInteractive(m));
      const members = new Set(group.members);
      /** For each part: the members that have it. */
      const have = new Map<number, Set<number>>();
      const ownText = group.members.some((m) => elements[m].text !== "");
      for (const part of parts) {
        const sample = elements[groups[part].members[0]];
        // A part is a small thing: an icon, a label. A whole block that some items have is content.
        if (sample.children.length > 0 && sample.tag !== "svg") continue;
        // In items that carry text of their own (a paragraph, a table header), the words and links
        // inside the text are content too: only their icons and markers are parts.
        if (ownText && sample.text !== "") continue;
        // A text that some items lack is data in most places (a counter, a description). It is a
        // part of the item only where the items are links or buttons: a navigation item without its label.
        if (sample.text !== "" && !interactive) continue;
        const owners = new Set<number>();
        for (const el of groups[part].members) {
          for (let p = el, depth = 0; p >= 0 && depth < 8; p = elements[p].parent, depth++) {
            if (members.has(p)) {
              owners.add(p);
              break;
            }
          }
        }
        // An item that is nothing but the icon (a wrapper around it, next to a label that is an item of
        // its own) does not "have an icon as a part": it is the icon. Where most owners are like that, the
        // group mixes icon holders and labels, and a label is not missing anything.
        const isWhole = (owner: number): boolean => {
          const kids = elements[owner].children;
          return elements[owner].text === "" && kids.length === 1 && groups[part].members.includes(kids[0]);
        };
        if (Array.from(owners).filter(isWhole).length * 2 >= owners.size) continue;
        have.set(part, owners);
      }
      const count = (m: number): number => parts.filter((p) => have.get(p)?.has(m)).length;
      ctx.looked("GRP-02");

      for (const part of parts) {
        const owners = have.get(part);
        if (!owners || owners.size === 0 || owners.size === group.members.length) continue;
        // A member lacks the part only when it has fewer parts than the members that have it:
        // an icon in another colour is another part, not a missing one.
        const typical = Array.from(owners, count).sort((a, b) => a - b)[Math.floor(owners.size / 2)];
        const lacking = group.members.filter((m) => !owners.has(m) && count(m) < typical);
        if (lacking.length === 0) continue;
        const share = owners.size / group.members.length;
        const what = noun(part);
        const values = [
          { value: `with the ${what}`, count: owners.size },
          { value: `without it`, count: group.members.length - owners.size },
        ];
        // A definite finding needs a clear majority in a group large enough to have one, and a
        // part that is not text: a missing text is listed for review.
        if (share >= CLEAR_SHARE && group.members.length >= CLEAR_GROUP && what !== "text") {
          for (const m of lacking) {
            ctx.report({ ruleId: "GRP-02", element: m, group: g, kind: "outlier", property: "parts of the item", expected: `the ${what} its peers have`, actual: `no ${what}`, values, message: `This item has no ${what}; ${owners.size} of the ${group.members.length} items in this group have one.` });
          }
        } else if (share >= REVIEW_SHARE) {
          // No clear majority: it may be on purpose (a sort icon on sortable columns only). One finding, for review.
          ctx.report({
            ruleId: "GRP-02",
            element: lacking[0],
            group: g,
            kind: "noMajority",
            type: "Review",
            severity: "Low",
            property: "parts of the item",
            expected: null,
            actual: `no ${what}`,
            values,
            message: `${owners.size} of the ${group.members.length} items in this group have ${what === "image or icon" || what === "icon or marker" ? "an" : "a"} ${what} that ${lacking.length > 1 ? `this item and ${lacking.length - 1} more do` : "this item does"} not have. Check that this is on purpose.`,
          });
        }
      }
    }
  };

  // ---------------------------------------------------------------------------
  // GRP-03: a divider that stops short
  // ---------------------------------------------------------------------------

  const dividerRule = (): void => {
    if (!ctx.runs("GRP-03")) return;
    const tolerance = ctx.tolerance("GRP-03");
    /** "vertical" for a line down one side only, "horizontal" for a line along the top or bottom only. */
    const divider = (i: number): "vertical" | "horizontal" | null => {
      // A block with content and a line down or along one side. A line under a link or a tab is an underline.
      if (facts.isCell(i) || facts.isRow(i) || elements[i].children.length === 0) return null;
      const b = elements[i].style.borderWidth;
      const vertical = (b.left > 0 ? 1 : 0) + (b.right > 0 ? 1 : 0);
      const horizontal = (b.top > 0 ? 1 : 0) + (b.bottom > 0 ? 1 : 0);
      // The line must separate the block from a neighbour on that side: a bar beside a quote separates nothing.
      const el = elements[i];
      const siblings = el.parent >= 0 ? flowChildren(el.parent).filter((s) => s !== i) : [];
      const overlapsY = (s: number): boolean => Math.min(bottom(elements[s]), bottom(el)) > Math.max(elements[s].box.y, el.box.y);
      const overlapsX = (s: number): boolean => Math.min(right(elements[s]), right(el)) > Math.max(elements[s].box.x, el.box.x);
      if (vertical === 1 && horizontal === 0) {
        const beside = siblings.some((s) => overlapsY(s) && (b.left > 0 ? right(elements[s]) <= el.box.x + 1 : elements[s].box.x >= right(el) - 1));
        return beside ? "vertical" : null;
      }
      if (horizontal === 1 && vertical === 0) {
        const beside = siblings.some((s) => overlapsX(s) && (b.top > 0 ? bottom(elements[s]) <= el.box.y + 1 : elements[s].box.y >= bottom(el) - 1));
        return beside ? "horizontal" : null;
      }
      return null;
    };

    for (const g of ctx.order) {
      const group = groups[g];
      if (group.kind === "level") continue;
      const kind = divider(group.members[0]);
      if (!kind || !group.members.every((m) => divider(m) === kind)) continue;
      const measured = group.members.flatMap((m) => {
        const around = boxAround(m);
        if (around < 0) return [];
        const box = elements[around];
        const el = elements[m];
        const start = kind === "vertical" ? el.box.y - (box.box.y + box.style.borderWidth.top) : el.box.x - (box.box.x + box.style.borderWidth.left);
        const end = kind === "vertical" ? bottom(box) - box.style.borderWidth.bottom - bottom(el) : right(box) - box.style.borderWidth.right - right(el);
        return [{ el: m, start, end }];
      });
      if (measured.length < 2) continue;
      ctx.looked("GRP-03");

      for (const side of ["start", "end"] as const) {
        const edge = kind === "vertical" ? (side === "start" ? "top" : "bottom") : side === "start" ? "left" : "right";
        const entries: Array<Entry<number>> = measured.map((m) => ({ el: m.el, value: m[side] }));
        const verdict = judge(bucketNumbers(entries, tolerance, px));
        if (verdict.kind === "same" || verdict.kind === "noMajority") continue;
        const values = valueCounts(verdict.buckets);
        // The member whose divider stops further from the edge is the one to report.
        const flagged = verdict.kind === "outlier" ? verdict.outliers : [entries.slice().sort((a, b) => b.value - a.value)[0]];
        const usual = verdict.kind === "outlier" ? verdict.expected.label : px(Math.min(...entries.map((e) => e.value)));
        for (const f of flagged) {
          ctx.report({
            ruleId: "GRP-03",
            element: f.el,
            group: g,
            kind: verdict.kind === "outlier" ? "outlier" : "pair",
            property: `divider reach at the ${edge}`,
            expected: `${usual} from the ${edge} edge`,
            actual: `${px(f.value)} from the ${edge} edge`,
            values,
            message: `The dividing line of this element stops ${px(f.value)} from the ${edge} edge of its container; in its peers it stops ${usual} from it.`,
          });
        }
      }
    }
  };

  // ---------------------------------------------------------------------------
  // BOX-01, BOX-02, BOX-03: box style
  // ---------------------------------------------------------------------------

  const radiusOf = (i: number): string => {
    const r = elements[i].style.radius;
    const all = [r.topLeft, r.topRight, r.bottomRight, r.bottomLeft].map((v) => Math.round(v));
    // A circle or pill is "fully rounded" whatever its size: a larger avatar is a size finding, not a radius finding.
    const half = Math.min(elements[i].box.width, elements[i].box.height) / 2;
    if (half > 0 && all.every((v) => v >= half - 0.5)) return "fully rounded";
    return all.every((v) => v === all[0]) ? `${all[0]}px` : all.map((v) => `${v}px`).join(" ");
  };
  /** The border when it runs all the way round, and the shadow. A line on some sides only is a divider, not a border. */
  const frameOf = (i: number): string => {
    const s = elements[i].style;
    const b = s.borderWidth;
    const full = b.top > 0 && b.right > 0 && b.bottom > 0 && b.left > 0;
    const visible = full && s.borderStyle !== "none" && s.borderColor !== "transparent" && !/^rgba\(.*,\s*0\)$/.test(s.borderColor);
    const border = visible ? `${Math.round(b.top)}px ${s.borderStyle} ${s.borderColor} border` : "no border";
    return `${border}, ${s.boxShadow === "none" ? "no shadow" : `shadow ${s.boxShadow}`}`;
  };
  /** The background that can be seen: none when it is the colour already behind the element. */
  const fillOf = (i: number): string => {
    const s = elements[i].style;
    if (s.backgroundImage !== "none") return s.backgroundImage;
    const parent = elements[i].parent;
    return facts.hasBox(i) && s.backgroundColor !== (parent >= 0 ? facts.backdropOf(parent) : "") && s.backgroundColor !== "rgba(0, 0, 0, 0)" && s.backgroundColor !== "transparent" ? s.backgroundColor : "none";
  };
  const bucketFills = (entries: Array<Entry<string>>, tolerance: number): Array<Bucket<string>> => {
    const buckets: Array<Bucket<string>> = [];
    for (const entry of entries) {
      const bucket = buckets.find((b) => b.entries[0].value === entry.value || deltaE(b.entries[0].value, entry.value) < tolerance);
      if (bucket) bucket.entries.push(entry);
      else buckets.push({ label: entry.value, entries: [entry] });
    }
    return buckets;
  };

  const boxStyleRules = (): void => {
    if (!ctx.runs("BOX-01") && !ctx.runs("BOX-02") && !ctx.runs("BOX-03")) return;

    const report = (ruleId: string, property: string, group: number, verdict: Verdict<string>, total: number, onlyReview: boolean): void => {
      // Several members in another style are another kind of box, not a slip.
      if (verdict.kind !== "outlier" || verdict.outliers.length > Math.max(1, Math.floor(total * 0.15))) return;
      // In a small group the odd one is as likely to be meant (a featured card): listed for review.
      const review = onlyReview || total < CLEAR_GROUP;
      const values = valueCounts(verdict.buckets);
      for (const o of verdict.outliers) {
        const actual = verdict.buckets.find((b) => b.entries.includes(o))?.label ?? "";
        ctx.report({
          ruleId,
          element: o.el,
          group,
          kind: "outlier",
          ...(review ? { type: "Review" as const } : {}),
          property,
          expected: verdict.expected.label,
          actual,
          values,
          message: `The ${property} of this box is ${actual}; ${verdict.expected.entries.length} of the ${total} boxes in this group have ${verdict.expected.label}.${onlyReview ? " A background on its own may carry a meaning, such as a status." : review ? " In a group this small it may be on purpose, such as a featured item." : ""}`,
        });
      }
    };

    for (const g of ctx.order) {
      const group = groups[g];
      // The boxes of a level group are peers because they look the same.
      if (group.kind === "level") continue;
      const members = group.members.filter((i) => facts.hasBox(i) && !facts.inState(i) && i !== group.guessedActive && !facts.isRow(i) && !facts.isCell(i));
      if (members.length < 3) continue;
      // Members that touch (a segmented control, a list with dividers) round their outer corners and
      // draw their borders by position.
      const touching = members.some((m, k) => {
        if (k === 0 || elements[m].parent !== elements[members[k - 1]].parent) return false;
        const a = elements[members[k - 1]];
        const b = elements[m];
        return Math.abs(b.box.x - right(a)) <= 1 || Math.abs(b.box.y - bottom(a)) <= 1;
      });

      const run = (ruleId: string, property: string, value: (i: number) => string, buckets: (e: Array<Entry<string>>) => Array<Bucket<string>>, review = false): void => {
        if (!ctx.runs(ruleId)) return;
        ctx.looked(ruleId);
        const entries = members.filter((i) => !ctx.reported(ruleId, i)).map((el) => ({ el, value: value(el) }));
        if (entries.length >= 3) report(ruleId, property, g, judge(buckets(entries)), entries.length, review);
      };
      if (!touching) {
        run("BOX-01", "corner radius", radiusOf, (e) => bucketLabels(e, (v) => v));
        run("BOX-02", "border and shadow", frameOf, (e) => bucketLabels(e, (v) => v));
      }
      run("BOX-03", "background", fillOf, (e) => bucketFills(e, ctx.tolerance("BOX-03")), true);
    }

    // Two sets of inner cards, in sections that are peers, styled differently (bordered cards in
    // one section, shadowed cards in the next). Listed for review: it may be two kinds of card.
    const card = (i: number): boolean => facts.kindOf(i) === "group" && (frameOf(i) !== "no border, no shadow" || fillOf(i) !== "none");
    groups.forEach((level, l) => {
      if (level.kind !== "level") return;
      const sections = new Set(level.members);
      const sets: Array<{ group: number; first: number; radius: string; frame: string; fill: string }> = [];
      groups.forEach((group, g) => {
        if (group.kind === "level" || sections.has(group.members[0])) return;
        if (!group.members.every((m) => card(m) && sections.has(boxAround(m)))) return;
        const first = group.members[0];
        sets.push({ group: g, first, radius: radiusOf(first), frame: frameOf(first), fill: fillOf(first) });
      });
      if (sets.length < 2) return;
      ctx.looked("BOX-02");
      const look = (s: (typeof sets)[number]): string => `${s.radius}|${s.frame}|${s.fill}`;
      const verdict = judge(bucketLabels(sets.map((s) => ({ el: s.first, value: look(s) })), (v) => v));
      if (verdict.kind === "same" || verdict.kind === "noMajority") return;
      const usual = verdict.kind === "outlier" ? sets.find((s) => s.first === verdict.expected.entries[0].el)! : sets[0];
      const odd = verdict.kind === "outlier" ? verdict.outliers.map((o) => sets.find((s) => s.first === o.el)!) : [sets[1]];
      for (const s of odd) {
        // Report under the rule of what differs: the frame first, then the radius, then the background.
        const [ruleId, property, actual, expected] =
          s.frame !== usual.frame ? ["BOX-02", "border and shadow", s.frame, usual.frame] : s.radius !== usual.radius ? ["BOX-01", "corner radius", s.radius, usual.radius] : ["BOX-03", "background", s.fill, usual.fill];
        ctx.report({
          ruleId,
          element: s.first,
          group: s.group,
          kind: verdict.kind === "outlier" ? "outlier" : "pair",
          type: "Review",
          property,
          expected,
          actual,
          values: [],
          message: `The cards in this section are drawn differently from the cards in ${l >= 0 ? "a section beside it" : "its peers"}: ${actual} here, ${expected} there.`,
        });
      }
    });
  };

  oddControlRule();
  missingPartRule();
  dividerRule();
  boxStyleRules();
}
