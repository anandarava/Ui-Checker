/**
 * Facts about the elements of a snapshot that both the grouping and the rules
 * need: what kind of thing an element is, whether it is drawn as a box of its
 * own, and whether a state restyles it. Computed on demand and remembered.
 *
 * Works on the snapshot only; never reads class names.
 */
import type { ElementSnapshot } from "./snapshot";

/** "text": no children, has text. "box": no children, no text. "group": has children. */
export type Kind = "text" | "box" | "group";

const CONTROL_TAGS = new Set(["button", "input", "select", "textarea"]);
const CONTROL_ROLES = new Set(["button", "tab", "switch", "checkbox", "radio", "combobox", "textbox", "searchbox", "slider", "spinbutton"]);
const INTERACTIVE_TAGS = new Set(["a", "button", "summary"]);
const INTERACTIVE_ROLES = new Set(["button", "link", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "treeitem"]);

/** Alpha of a computed colour; 1 when the format is not rgb()/rgba(). */
export function alphaOf(color: string): number {
  if (color === "transparent" || color === "") return 0;
  const m = /^rgba?\(([^)]+)\)$/.exec(color);
  if (!m) return 1;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 4) return 1;
  const a = parts[3].endsWith("%") ? Number.parseFloat(parts[3]) / 100 : Number.parseFloat(parts[3]);
  return Number.isFinite(a) ? a : 1;
}

export interface Facts {
  kindOf(i: number): Kind;
  isRow(i: number): boolean;
  isCell(i: number): boolean;
  /** The background actually seen behind an element: its own, or the nearest painted ancestor's. */
  backdropOf(i: number): string;
  /** True when the element is drawn as a box of its own: a background that stands out, a border or a shadow. */
  hasBox(i: number): boolean;
  /**
   * True when the element, or an element it sits in, is in a state that
   * changes its look on purpose (so also the icon of the current navigation
   * item). "expanded" alone does not restyle what is inside.
   */
  inState(i: number): boolean;
  /** A button, field or other form control. */
  isControl(i: number): boolean;
  /** A control or a link. */
  isInteractive(i: number): boolean;
  /** Inside preformatted code: its coloured words are syntax highlighting, not parts of the interface. */
  inCode(i: number): boolean;
}

export function createFacts(elements: ElementSnapshot[]): Facts {
  const kindOf = (i: number): Kind => {
    const el = elements[i];
    if (el.children.length > 0) return "group";
    return el.text ? "text" : "box";
  };

  const isRow = (i: number): boolean => elements[i].tag === "tr" || elements[i].role === "row";

  const isCell = (i: number): boolean => elements[i].tag === "td" || elements[i].tag === "th" || elements[i].role === "cell" || elements[i].role === "gridcell";

  const backdrops = new Map<number, string>();
  const backdropOf = (i: number): string => {
    if (i < 0) return "rgb(255, 255, 255)";
    let bg = backdrops.get(i);
    if (bg === undefined) {
      const own = elements[i].style.backgroundColor;
      bg = alphaOf(own) > 0 ? own : backdropOf(elements[i].parent);
      backdrops.set(i, bg);
    }
    return bg;
  };

  const hasBox = (i: number): boolean => {
    const s = elements[i].style;
    const b = s.borderWidth;
    if (b.top + b.right + b.bottom + b.left > 0) return true;
    if (s.boxShadow !== "none") return true;
    return alphaOf(s.backgroundColor) > 0 && s.backgroundColor !== backdropOf(elements[i].parent);
  };

  const restyled = new Map<number, boolean>();
  /** True when the element's state also restyles what is inside it. */
  const restyles = (i: number): boolean => {
    if (i < 0) return false;
    let value = restyled.get(i);
    if (value === undefined) {
      value = elements[i].state.some((s) => s !== "expanded") || restyles(elements[i].parent);
      restyled.set(i, value);
    }
    return value;
  };
  const inState = (i: number): boolean => elements[i].state.length > 0 || restyles(elements[i].parent);

  const isControl = (i: number): boolean => {
    const el = elements[i];
    return CONTROL_TAGS.has(el.tag) || (el.role !== null && CONTROL_ROLES.has(el.role));
  };

  const isInteractive = (i: number): boolean => {
    const el = elements[i];
    return isControl(i) || INTERACTIVE_TAGS.has(el.tag) || (el.role !== null && INTERACTIVE_ROLES.has(el.role));
  };

  const code = new Map<number, boolean>();
  const inCode = (i: number): boolean => {
    if (i < 0) return false;
    let value = code.get(i);
    if (value === undefined) {
      const parent = elements[i].parent;
      value = elements[i].tag === "pre" || elements[i].tag === "code" || inCode(parent);
      code.set(i, value);
    }
    return value;
  };

  return { kindOf, isRow, isCell, backdropOf, hasBox, inState, isControl, isInteractive, inCode };
}
