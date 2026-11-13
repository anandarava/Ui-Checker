/**
 * Design-scale audit (PLAN.md, Phase 5): the font families, font sizes, font
 * weights, spacing values and colours a page uses, with how often each is
 * used, and the values that stand out.
 *
 * Without a token file a value is judged against the page itself: a size or
 * spacing value used by one element only, a spacing value off the 4px grid the
 * rest of the page follows, a colour that is almost another, more used colour.
 * With the team's design tokens, a value is judged against the tokens instead:
 * it is one of them or it is not.
 *
 * These are observations about the whole page, not defects of one element, so
 * they are listed in the audit and are not findings: they do not change the
 * score.
 *
 * Works on the snapshot only; never reads class names.
 */
import type { DesignToken, DesignTokens, ScaleFlag, ScaleKind } from "@shared/types";
import { alphaOf } from "./facts";
import { deltaE } from "./rules/color";
import type { ElementSnapshot, Sides } from "./snapshot";

/** One value of the scale, with the snapshot indexes of the elements that use it. */
export interface RawScaleValue {
  value: string;
  /** Elements that use it, in document order. */
  elements: number[];
  detail?: string;
  flags: ScaleFlag[];
  token?: string;
}

export interface RawScaleList {
  kind: ScaleKind;
  values: RawScaleValue[];
  note?: string;
}

/** Spacing above this is the layout placing things, not a step of the spacing scale. */
const MAX_SPACING = 200;
/** Spacing below this is a hairline or an optical correction, not a step of the grid. */
const GRID = 4;
/** The page follows the grid when this share of its spacing uses are multiples of it. */
const GRID_SHARE = 0.75;
/** Two colours closer than this (Delta E) are near-duplicates. */
const NEAR_COLOUR = 5;
const SIDES: Array<keyof Sides> = ["top", "right", "bottom", "left"];

interface Collected {
  /** Numeric value, for sizes and spacing. */
  number?: number;
  label: string;
  elements: number[];
  /** Where it is used: "text", "background", "padding"... -> number of elements. */
  roles: Map<string, number>;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function nearest(tokens: DesignToken[], value: number): DesignToken | undefined {
  let best: DesignToken | undefined;
  for (const token of tokens) {
    if (typeof token.value !== "number") continue;
    if (!best || Math.abs(token.value - value) < Math.abs((best.value as number) - value)) best = token;
  }
  return best;
}

export function buildAudit(elements: ElementSnapshot[], tokens: DesignTokens | null = null): RawScaleList[] {
  const collected: Record<ScaleKind, Map<string, Collected>> = { fontFamily: new Map(), fontSize: new Map(), fontWeight: new Map(), spacing: new Map(), color: new Map() };

  const use = (kind: ScaleKind, key: string, label: string, el: number, role: string, number?: number): void => {
    let entry = collected[kind].get(key);
    if (!entry) {
      entry = { label, elements: [], roles: new Map(), ...(number !== undefined ? { number } : {}) };
      collected[kind].set(key, entry);
    }
    if (entry.elements[entry.elements.length - 1] !== el) entry.elements.push(el);
    entry.roles.set(role, (entry.roles.get(role) ?? 0) + 1);
  };

  for (const el of elements) {
    if (el.clip === "full") continue;
    const s = el.style;

    if (el.text !== "") {
      use("fontFamily", s.fontFamily.toLowerCase(), s.fontFamily, el.index, "text");
      const size = round(s.fontSize);
      use("fontSize", String(size), `${size}px`, el.index, "text", size);
      use("fontWeight", String(s.fontWeight), String(s.fontWeight), el.index, "text", s.fontWeight);
      if (alphaOf(s.color) > 0) use("color", s.color, s.color, el.index, "text");
    }
    if (alphaOf(s.backgroundColor) > 0) use("color", s.backgroundColor, s.backgroundColor, el.index, "background");
    if (s.borderWidth.top > 0 && s.borderStyle !== "none" && s.borderStyle !== "hidden" && alphaOf(s.borderColor) > 0) {
      use("color", s.borderColor, s.borderColor, el.index, "border");
    }

    const spacing = new Map<number, string>();
    for (const side of SIDES) {
      if (s.padding[side] > 0) spacing.set(round(s.padding[side]), "padding");
    }
    for (const side of SIDES) {
      // An `auto` margin is what the layout had left over, not a chosen value.
      if (s.margin[side] > 0 && !s.marginAuto.includes(side) && !spacing.has(round(s.margin[side]))) spacing.set(round(s.margin[side]), "margin");
    }
    if (el.layout.direction !== null) {
      for (const gap of [s.gap.row, s.gap.column]) if (gap > 0 && !spacing.has(round(gap))) spacing.set(round(gap), "gap");
    }
    for (const [value, role] of spacing) {
      if (value <= MAX_SPACING) use("spacing", String(value), `${value}px`, el.index, role, value);
    }
  }

  const lists: RawScaleList[] = [];
  const build = (kind: ScaleKind, roles: boolean): RawScaleList => {
    const entries = Array.from(collected[kind].values());
    if (kind === "fontSize" || kind === "spacing" || kind === "fontWeight") entries.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
    else entries.sort((a, b) => b.elements.length - a.elements.length || a.label.localeCompare(b.label));
    const values = entries.map((e): RawScaleValue => {
      const detail = roles ? Array.from(e.roles, ([role, n]) => `${role} ${n}`).join(", ") : undefined;
      return { value: e.label, elements: e.elements, flags: [], ...(detail ? { detail } : {}) };
    });
    const list: RawScaleList = { kind, values };
    lists.push(list);
    return list;
  };

  const families = build("fontFamily", false);
  const sizes = build("fontSize", false);
  const weights = build("fontWeight", false);
  const spacing = build("spacing", true);
  const colours = build("color", true);
  const numberOf = (v: RawScaleValue): number => Number.parseFloat(v.value);

  // ---- Against the team's tokens --------------------------------------------
  const againstTokens = (list: RawScaleList, known: DesignToken[], match: (v: RawScaleValue) => DesignToken | undefined, closest: (v: RawScaleValue) => string): boolean => {
    if (known.length === 0) return false;
    let off = 0;
    for (const v of list.values) {
      const token = match(v);
      if (token) v.token = token.name;
      else {
        off++;
        v.flags.push({ kind: "notToken", message: `Not a design token.${closest(v)}` });
      }
    }
    list.note = off === 0 ? `Every value is a token of ${tokens?.name ?? "the token file"}.` : `${plural(off, "value is", "values are")} not in ${tokens?.name ?? "the token file"}.`;
    return true;
  };
  const closestNumber = (known: DesignToken[]) => (v: RawScaleValue): string => {
    const token = nearest(known, numberOf(v));
    return token ? ` The closest is ${token.name} (${token.value}px).` : "";
  };
  const sameNumber = (known: DesignToken[]) => (v: RawScaleValue): DesignToken | undefined => known.find((t) => typeof t.value === "number" && Math.abs(t.value - numberOf(v)) <= 0.25);

  const t = tokens;
  const familiesChecked = t !== null && againstTokens(families, t.fontFamily, (v) => t.fontFamily.find((k) => String(k.value).toLowerCase() === v.value.toLowerCase()), () => "");
  const sizesChecked = t !== null && againstTokens(sizes, t.fontSize, sameNumber(t.fontSize), closestNumber(t.fontSize));
  const weightsChecked = t !== null && againstTokens(weights, t.fontWeight, (v) => t.fontWeight.find((k) => k.value === numberOf(v)), () => "");
  const spacingChecked = t !== null && againstTokens(spacing, t.spacing, sameNumber(t.spacing), closestNumber(t.spacing));
  const coloursChecked =
    t !== null &&
    againstTokens(
      colours,
      t.color,
      (v) => t.color.find((k) => k.value === v.value || deltaE(String(k.value), v.value) < 1),
      (v) => {
        if (alphaOf(v.value) < 1) return "";
        let best: DesignToken | undefined;
        let distance = Infinity;
        for (const k of t.color) {
          const d = deltaE(String(k.value), v.value);
          if (d < distance) [best, distance] = [k, d];
        }
        return best && distance < 15 ? ` The closest is ${best.name} (${best.value}).` : "";
      },
    );
  void familiesChecked;
  void weightsChecked;

  // ---- Against the page itself ----------------------------------------------
  const once = (list: RawScaleList, what: string): void => {
    for (const v of list.values) if (v.elements.length === 1) v.flags.push({ kind: "once", message: `Used by one element only. A ${what} used once is often a slip.` });
  };

  if (!sizesChecked) once(sizes, "font size");

  if (!spacingChecked) {
    once(spacing, "spacing value");
    const steps = spacing.values.filter((v) => numberOf(v) >= GRID);
    const total = steps.reduce((n, v) => n + v.elements.length, 0);
    const onGrid = steps.filter((v) => numberOf(v) % GRID === 0).reduce((n, v) => n + v.elements.length, 0);
    if (total > 0) {
      const share = onGrid / total;
      const percent = Math.round(share * 100);
      if (share >= GRID_SHARE) {
        spacing.note = `This page follows a ${GRID}px grid: ${percent}% of its spacing is a multiple of ${GRID}px.`;
        for (const v of steps) if (numberOf(v) % GRID !== 0) v.flags.push({ kind: "offGrid", message: `Not a multiple of ${GRID}px, unlike ${percent}% of the spacing on this page.` });
      } else {
        spacing.note = `This page does not follow a ${GRID}px grid (${percent}% of its spacing is a multiple of ${GRID}px), so values off the grid are not marked.`;
      }
    }
  }

  if (!coloursChecked) {
    // Most used first: the less used of two close colours is the one to question.
    const solid = colours.values.filter((v) => alphaOf(v.value) >= 1);
    for (let i = solid.length - 1; i > 0; i--) {
      let twin: RawScaleValue | undefined;
      let distance = NEAR_COLOUR;
      for (let j = 0; j < i; j++) {
        const d = deltaE(solid[i].value, solid[j].value);
        if (d > 0 && d < distance) [twin, distance] = [solid[j], d];
      }
      if (twin) {
        solid[i].flags.push({
          kind: "nearDuplicate",
          message: `Almost the same as ${twin.value} (Delta E ${Math.round(distance * 10) / 10}), which is used by ${plural(twin.elements.length, "element", "elements")}.`,
        });
      }
    }
  }

  return lists;
}
