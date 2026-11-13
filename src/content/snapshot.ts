/**
 * Page snapshot (PLAN.md, Phase 1): one pass over the page that records, for
 * every visible element, its box, its text box, the computed styles the rules
 * compare and where it sits in the layout. Grouping (Phase 2) and the rules
 * (Phase 3) work on this data only and never touch the live DOM.
 *
 * The pass only reads layout (no style writes), so the browser lays the page
 * out once. Open shadow roots and same-origin iframes are walked as part of the
 * same tree; what cannot be read is listed in `notScanned`.
 *
 * Nothing in here may depend on a particular application: no selectors, class
 * names or text of any specific site.
 */
import { OWN_UI_ATTR } from "@shared/constants";
import type { Box } from "@shared/types";

export interface Sides {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Corners {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

/** Computed styles of one element. Lengths are CSS px; colours are the computed strings. */
export interface StyleSnapshot {
  /** First family of the computed list, without quotes. The font actually drawn can differ when it is missing. */
  fontFamily: string;
  fontFamilies: string[];
  fontSize: number;
  fontWeight: number;
  fontStyle: string;
  /** null = "normal" (the font's own line height). */
  lineHeight: number | null;
  letterSpacing: number;
  color: string;
  textAlign: string;
  textTransform: string;
  textDecorationLine: string;
  /** CSS transform, "none" when there is none. */
  transform: string;
  padding: Sides;
  margin: Sides;
  /** 0 when the gap is "normal". */
  gap: { row: number; column: number };
  borderWidth: Sides;
  borderStyle: string;
  borderColor: string;
  /** Horizontal radius of each corner; percentages are resolved against the box width. */
  radius: Corners;
  boxShadow: string;
  backgroundColor: string;
  backgroundImage: string;
  overflowX: string;
  overflowY: string;
}

export type LayoutDirection = "row" | "column";

export interface LayoutSnapshot {
  display: string;
  position: string;
  /** Main direction of the element's own flex or grid layout; null for other displays. */
  direction: LayoutDirection | null;
  /** Display of the DOM parent, e.g. "flex", "grid", "block". Empty for the scan root. */
  parentDisplay: string;
  parentDirection: LayoutDirection | null;
}

/** How much of the element an `overflow` ancestor cuts off. */
export type Clip = "none" | "partial" | "full";

export interface ElementSnapshot {
  /** Position in `PageSnapshot.elements` and `PageSnapshot.nodes`. */
  index: number;
  /** Nearest recorded ancestor; -1 for the scan root. */
  parent: number;
  /** Recorded children, in document order. */
  children: number[];
  /** Depth in the rendered tree below the scan root (hidden wrappers count). */
  depth: number;
  /** Index into `PageSnapshot.frames`; 0 is the top document. */
  frame: number;
  inShadowTree: boolean;
  tag: string;
  /** The `role` attribute, or null. */
  role: string | null;
  classList: string[];
  /**
   * States read from ARIA and standard attributes, never from class names:
   * "selected", "current", "pressed", "checked", "expanded", "disabled".
   */
  state: string[];
  /** Element children in the DOM, visible or not. */
  childCount: number;
  /** The element's own text (not its descendants'), whitespace collapsed, at most 80 characters. */
  text: string;
  /** Border box in page coordinates. */
  box: Box;
  /** Area covered by the element's own text nodes, in page coordinates; null when it has no text of its own. */
  textBox: Box | null;
  style: StyleSnapshot;
  layout: LayoutSnapshot;
  clip: Clip;
  /** The nearest ancestor that cuts the element off; null when `clip` is "none". */
  clippedBy: number | null;
  /** The nearest ancestor whose content scrolls inside it; null = the element scrolls with the page. */
  scrollContainer: number | null;
  /** True when the element's own content overflows it and it is not `overflow: visible`. */
  scrolls: boolean;
}

export interface FrameSnapshot {
  /** The iframe element's index; -1 for the top document. */
  element: number;
  /** Where the frame's document starts, in page coordinates. */
  origin: { x: number; y: number };
}

export interface PageSnapshot {
  /** Plain data, safe to serialise. */
  elements: ElementSnapshot[];
  /** The live element of each entry, for building selectors and drawing overlays. Rules must not read it. */
  nodes: Element[];
  frames: FrameSnapshot[];
  /** Parts of the page that could not be read. */
  notScanned: string[];
  durationMs: number;
}

/** Elements that never render a box of their own, or only describe one (table columns, line breaks). */
const NON_VISUAL = new Set(["script", "style", "link", "meta", "title", "head", "template", "noscript", "base", "col", "colgroup", "br", "wbr"]);

const TEXT_MAX = 80;

function px(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function sides(style: CSSStyleDeclaration, prefix: string, suffix = ""): Sides {
  const read = (side: string): number => px(style.getPropertyValue(`${prefix}-${side}${suffix}`));
  return { top: read("top"), right: read("right"), bottom: read("bottom"), left: read("left") };
}

/** "12px", "50%" or "12px 6px" (elliptical: the horizontal radius comes first). */
function radius(value: string, width: number): number {
  const first = value.trim().split(/\s+/)[0] ?? "";
  return first.endsWith("%") ? (px(first) * width) / 100 : px(first);
}

/** Splits a font-family list on the commas outside quotes and removes the quotes. */
export function parseFontFamilies(value: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote = "";
  for (const ch of value) {
    if (quote) {
      if (ch === quote) quote = "";
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ",") {
      out.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current.trim());
  return out.filter(Boolean);
}

function direction(style: CSSStyleDeclaration): LayoutDirection | null {
  const display = style.display;
  if (display.includes("flex")) return style.flexDirection.startsWith("column") ? "column" : "row";
  if (display.includes("grid")) return style.gridAutoFlow.startsWith("column") ? "column" : "row";
  return null;
}

function readStyle(style: CSSStyleDeclaration, width: number): StyleSnapshot {
  const fontFamilies = parseFontFamilies(style.fontFamily);
  return {
    fontFamily: fontFamilies[0] ?? "",
    fontFamilies,
    fontSize: px(style.fontSize),
    fontWeight: px(style.fontWeight) || 400,
    fontStyle: style.fontStyle,
    lineHeight: style.lineHeight === "normal" || style.lineHeight === "" ? null : px(style.lineHeight),
    letterSpacing: px(style.letterSpacing),
    color: style.color,
    textAlign: style.textAlign,
    textTransform: style.textTransform,
    textDecorationLine: style.textDecorationLine,
    transform: style.transform || "none",
    padding: sides(style, "padding"),
    margin: sides(style, "margin"),
    gap: { row: px(style.rowGap), column: px(style.columnGap) },
    borderWidth: sides(style, "border", "-width"),
    borderStyle: style.borderTopStyle,
    borderColor: style.borderTopColor,
    radius: {
      topLeft: radius(style.borderTopLeftRadius, width),
      topRight: radius(style.borderTopRightRadius, width),
      bottomRight: radius(style.borderBottomRightRadius, width),
      bottomLeft: radius(style.borderBottomLeftRadius, width),
    },
    boxShadow: style.boxShadow || "none",
    backgroundColor: style.backgroundColor,
    backgroundImage: style.backgroundImage || "none",
    overflowX: style.overflowX || "visible",
    overflowY: style.overflowY || "visible",
  };
}

/** One document being walked: the top page or a same-origin iframe. */
interface FrameContext {
  index: number;
  view: Window;
  /** Added to a viewport rectangle of this document to get page coordinates. */
  dx: number;
  dy: number;
  /** Reused for measuring text nodes. */
  range: Range | null;
  /** Left edge of the area that can be scrolled to (negative in right-to-left documents). */
  minX: number;
  minY: number;
}

interface ParentContext {
  index: number;
  depth: number;
  display: string;
  direction: LayoutDirection | null;
  inShadowTree: boolean;
}

function frameContext(index: number, view: Window, originX: number, originY: number): FrameContext {
  const root = view.document.documentElement;
  const dx = originX + (view.scrollX || 0);
  const dy = originY + (view.scrollY || 0);
  // A right-to-left document scrolls towards negative x.
  const rtl = view.getComputedStyle(root).direction === "rtl";
  const minX = rtl ? originX - Math.max(0, root.scrollWidth - root.clientWidth) : originX;
  return { index, view, dx, dy, range: view.document.createRange?.() ?? null, minX, minY: originY };
}

function overflows(value: string): boolean {
  return value !== "visible" && value !== "";
}

/** The children as rendered: a shadow root replaces the light children, a slot shows what is assigned to it. */
function renderedChildren(el: Element): Element[] {
  if (el.shadowRoot) return Array.from(el.shadowRoot.children);
  if (el.localName === "slot") {
    const assigned = (el as HTMLSlotElement).assignedElements?.() ?? [];
    if (assigned.length > 0) return assigned;
  }
  // A closed <details> renders its summary only.
  if (el.localName === "details" && !(el as HTMLDetailsElement).open) {
    return Array.from(el.children).filter((c) => c.localName === "summary").slice(0, 1);
  }
  return Array.from(el.children);
}

function closedShadowRoot(el: Element): boolean {
  if (el.shadowRoot || !el.localName.includes("-")) return false;
  try {
    // Only available to the extension's content script.
    const dom = (globalThis as unknown as { chrome?: { dom?: { openOrClosedShadowRoot?: (e: Element) => ShadowRoot | null } } }).chrome?.dom;
    return Boolean(dom?.openOrClosedShadowRoot?.(el as HTMLElement));
  } catch {
    return false;
  }
}

/** Reads the area of the element's own text nodes, in viewport coordinates of its document. */
function ownText(el: Element, range: Range | null): { text: string; rect: { left: number; top: number; right: number; bottom: number } | null } {
  let text = "";
  let rect: { left: number; top: number; right: number; bottom: number } | null = null;
  for (let node = el.firstChild; node; node = node.nextSibling) {
    if (node.nodeType !== 3) continue;
    const data = node.nodeValue ?? "";
    if (!data.trim()) continue;
    text += (text ? " " : "") + data;
    if (!range || typeof range.getBoundingClientRect !== "function") continue;
    range.selectNodeContents(node);
    const r = range.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    rect = rect
      ? { left: Math.min(rect.left, r.left), top: Math.min(rect.top, r.top), right: Math.max(rect.right, r.right), bottom: Math.max(rect.bottom, r.bottom) }
      : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }
  text = text.replace(/\s+/g, " ").trim();
  return { text: text.length > TEXT_MAX ? text.slice(0, TEXT_MAX) : text, rect };
}

const ON = new Set(["true", "mixed"]);

/** The states that make an element look different from its peers on purpose. */
function readState(el: Element): string[] {
  const out: string[] = [];
  const attr = (name: string): string => el.getAttribute(name) ?? "";
  if (attr("aria-selected") === "true") out.push("selected");
  const current = attr("aria-current");
  if (current && current !== "false") out.push("current");
  if (ON.has(attr("aria-pressed"))) out.push("pressed");
  if (ON.has(attr("aria-checked")) || (el as HTMLInputElement).checked === true) out.push("checked");
  if (attr("aria-expanded") === "true") out.push("expanded");
  if (attr("aria-disabled") === "true" || (el as HTMLButtonElement).disabled === true) out.push("disabled");
  return out;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Measures every visible element under `root`.
 * `root` belongs to the top document of the scan; its window is `view`.
 */
export function takeSnapshot(root: Element, view: Window = window): PageSnapshot {
  const started = performance.now();
  const elements: ElementSnapshot[] = [];
  const nodes: Element[] = [];
  const frames: FrameSnapshot[] = [{ element: -1, origin: { x: 0, y: 0 } }];
  /** Elements whose overflow is handed to the viewport and so does not clip: <html>, and <body> under a visible <html>. */
  const noClip = new Set<number>();
  const skipped = { crossOriginFrames: 0, closedShadowRoots: 0, canvases: 0 };

  const walk = (el: Element, parent: ParentContext, frame: FrameContext): void => {
    const tag = el.localName;
    if (NON_VISUAL.has(tag) || el.hasAttribute(OWN_UI_ATTR)) return;

    const style = frame.view.getComputedStyle(el);
    // display:none and opacity:0 hide the whole subtree.
    if (style.display === "none") return;
    // parseFloat, not Number: an empty value must not read as 0.
    if (Number.parseFloat(style.opacity) === 0) return;

    const rect = el.getBoundingClientRect();
    const clipsOwnContent = overflows(style.overflowX) || overflows(style.overflowY);
    // The usual "visually hidden" pattern: a 1px box that clips its content.
    if (rect.width <= 1 && rect.height <= 1 && clipsOwnContent && tag !== "body" && tag !== "html") return;

    const box: Box = { x: rect.left + frame.dx, y: rect.top + frame.dy, width: rect.width, height: rect.height };
    const hidden = style.visibility === "hidden" || style.visibility === "collapse";
    const empty = rect.width <= 0 || rect.height <= 0;
    // Entirely left of or above the area the user can scroll to.
    const unreachable = box.x + box.width <= frame.minX || box.y + box.height <= frame.minY;

    const here: ParentContext = {
      index: parent.index,
      depth: parent.depth + 1,
      display: style.display,
      direction: direction(style),
      inShadowTree: parent.inShadowTree,
    };

    // A descendant can still show: visibility can be switched back on, and
    // content can overflow an empty or off-page box. So skip only this element.
    if (!(hidden || empty || unreachable)) {
      const index = elements.length;
      const text = ownText(el, frame.range);
      const scrolls = clipsOwnContent && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
      elements.push({
        index,
        parent: parent.index,
        children: [],
        depth: parent.depth + 1,
        frame: frame.index,
        inShadowTree: parent.inShadowTree,
        tag,
        role: el.getAttribute("role"),
        classList: Array.from(el.classList),
        state: readState(el),
        childCount: el.childElementCount,
        text: text.text,
        box,
        textBox: text.rect
          ? { x: text.rect.left + frame.dx, y: text.rect.top + frame.dy, width: text.rect.right - text.rect.left, height: text.rect.bottom - text.rect.top }
          : null,
        style: readStyle(style, rect.width),
        layout: {
          display: style.display,
          position: style.position || "static",
          direction: here.direction,
          parentDisplay: parent.display,
          parentDirection: parent.direction,
        },
        clip: "none",
        clippedBy: null,
        scrollContainer: null,
        scrolls,
      });
      nodes.push(el);
      if (parent.index >= 0) elements[parent.index].children.push(index);
      here.index = index;

      if (tag === "html") noClip.add(index);
      if (tag === "body") {
        const html = frame.view.getComputedStyle(frame.view.document.documentElement);
        if (!overflows(html.overflowX) && !overflows(html.overflowY)) noClip.add(index);
      }
      if (tag === "canvas") skipped.canvases++;
      if (closedShadowRoot(el)) skipped.closedShadowRoots++;

      // Drawings are measured as one box.
      if (tag === "svg") return;

      if (tag === "iframe" || tag === "frame") {
        let doc: Document | null = null;
        try {
          doc = (el as HTMLIFrameElement).contentDocument;
        } catch {
          doc = null;
        }
        const inner = doc?.defaultView;
        const innerRoot = doc?.body ?? doc?.documentElement;
        if (!doc || !inner || !innerRoot) {
          skipped.crossOriginFrames++;
          return;
        }
        // The frame's document starts inside the iframe's border and padding.
        const originX = box.x + el.clientLeft + px(style.paddingLeft);
        const originY = box.y + el.clientTop + px(style.paddingTop);
        frames.push({ element: index, origin: { x: originX, y: originY } });
        const innerFrame = frameContext(frames.length - 1, inner, originX, originY);
        walk(innerRoot, { index, depth: here.depth, display: "block", direction: null, inShadowTree: false }, innerFrame);
        return;
      }
    }

    if (el.shadowRoot) here.inShadowTree = true;
    for (const child of renderedChildren(el)) walk(child, here, frame);
  };

  walk(root, { index: -1, depth: -1, display: "", direction: null, inShadowTree: false }, frameContext(0, view, 0, 0));
  markClipping(elements, noClip);

  const notScanned: string[] = [];
  if (skipped.crossOriginFrames > 0) {
    notScanned.push(`${count(skipped.crossOriginFrames, "frame", "frames")} from another site: the content inside cannot be read.`);
  }
  if (skipped.closedShadowRoots > 0) {
    notScanned.push(`${count(skipped.closedShadowRoots, "component", "components")} with a closed shadow root: the content inside cannot be read.`);
  }
  if (skipped.canvases > 0) {
    notScanned.push(`${count(skipped.canvases, "canvas", "canvases")}: what is drawn on a canvas cannot be read.`);
  }

  return { elements, nodes, frames, notScanned, durationMs: performance.now() - started };
}

/**
 * Fills `clip`, `clippedBy` and `scrollContainer` from the recorded boxes.
 * An ancestor clips when its overflow is not visible; an iframe clips its
 * document. Absolutely positioned elements are only clipped from their
 * containing block upwards, fixed ones not at all.
 */
function markClipping(elements: ElementSnapshot[], noClip: Set<number>): void {
  const EPS = 0.5;
  for (const el of elements) {
    let left = el.box.x;
    let top = el.box.y;
    let right = el.box.x + el.box.width;
    let bottom = el.box.y + el.box.height;
    // How the element escapes clipping: "absolute" is only clipped from its containing
    // block upwards, "fixed" only by a transformed ancestor (or the frame it is in).
    let escape = el.layout.position === "absolute" || el.layout.position === "fixed" ? el.layout.position : "";

    for (let i = el.parent; i >= 0; i = elements[i].parent) {
      const a = elements[i];
      const isFrame = a.tag === "iframe" || a.tag === "frame";
      if (!isFrame) {
        if (escape === "fixed" && a.style.transform === "none") continue;
        if (escape === "absolute" && a.layout.position === "static" && a.style.transform === "none") continue;
      }
      // `a` holds the element. Whether the ancestors above clip it depends on how `a` itself is positioned.
      escape = !isFrame && (a.layout.position === "absolute" || a.layout.position === "fixed") ? a.layout.position : "";

      const clipX = isFrame || (overflows(a.style.overflowX) && !noClip.has(i));
      const clipY = isFrame || (overflows(a.style.overflowY) && !noClip.has(i));
      if (!clipX && !clipY) continue;

      if (el.scrollContainer === null && (isFrame || a.scrolls)) el.scrollContainer = i;

      const b = a.style.borderWidth;
      let cut = false;
      if (clipX) {
        const min = a.box.x + b.left;
        const max = a.box.x + a.box.width - b.right;
        if (left < min - EPS || right > max + EPS) cut = true;
        left = Math.max(left, min);
        right = Math.min(right, max);
      }
      if (clipY) {
        const min = a.box.y + b.top;
        const max = a.box.y + a.box.height - b.bottom;
        if (top < min - EPS || bottom > max + EPS) cut = true;
        top = Math.max(top, min);
        bottom = Math.min(bottom, max);
      }
      if (cut && el.clippedBy === null) el.clippedBy = i;
    }

    if (el.clippedBy !== null) el.clip = right - left <= EPS || bottom - top <= EPS ? "full" : "partial";
  }
}
