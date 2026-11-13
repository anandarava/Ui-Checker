/**
 * DOM helpers for describing an element to the UI and the reports. Pure
 * functions over the live DOM; none of them modify the page.
 *
 * Copied from the PalTech Accessibility Testing extension (same names), so a
 * fix in one extension can be copied to the other.
 */

import { OWN_UI_ATTR } from "@shared/constants";

const MAX_HTML_SNIPPET = 160;

/** True when the element belongs to the extension (the overlay, the picker). */
export function isExtensionNode(el: Element | null | undefined): boolean {
  if (!el) return false;
  try {
    if (el.closest(`[${OWN_UI_ATTR}]`) !== null) return true;
  } catch {
    /* detached or exotic node */
  }
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? isExtensionNode(root.host) : false;
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/([^\w-])/g, "\\$1");
}

/** A class name that looks hand-written (not a CSS-module hash or utility with state). */
function isStableClass(cls: string): boolean {
  if (cls.length === 0 || cls.length > 32) return false;
  if (/\d{3,}/.test(cls)) return false;
  if (/^(is-|has-|js-|active|hover|focus|selected|open)/i.test(cls)) return false;
  if (/^[a-z]+_[A-Za-z0-9]{5,}$/.test(cls) || /__[A-Za-z0-9]{5,}$/.test(cls)) return false; // css-module style
  if (/^[A-Za-z0-9]{6,}$/.test(cls) && /\d/.test(cls) && /[A-Z]/.test(cls)) return false; // hashed
  return /^-?[_A-Za-z][-\w]*$/.test(cls);
}

function queryRoot(el: Element): Document | ShadowRoot {
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root : el.ownerDocument;
}

function countMatches(root: ParentNode, selector: string): number {
  try {
    return root.querySelectorAll(selector).length;
  } catch {
    return -1;
  }
}

function idSelector(el: Element, root: ParentNode): string | null {
  const id = el.getAttribute("id");
  if (!id || /\s/.test(id)) return null;
  const sel = `#${cssEscape(id)}`;
  return countMatches(root, sel) === 1 ? sel : null;
}

function segmentFor(el: Element): string {
  const tag = cssEscape(el.localName || el.tagName.toLowerCase());
  const parent = el.parentElement;
  let seg = tag;
  const classes = Array.from(el.classList).filter(isStableClass).slice(0, 2);
  if (classes.length) seg += classes.map((c) => `.${cssEscape(c)}`).join("");
  if (!parent) return seg;
  const sameTag = Array.from(parent.children).filter((c) => c.localName === el.localName);
  if (sameTag.length > 1) {
    const withSameClasses = sameTag.filter((c) => classes.every((cls) => c.classList.contains(cls)));
    if (withSameClasses.length > 1) {
      seg += `:nth-of-type(${sameTag.indexOf(el) + 1})`;
    }
  }
  return seg;
}

/**
 * Builds a short CSS selector that matches exactly one element in its root
 * (document or shadow root). Prefers a unique id, then the shortest ancestor
 * path (with :nth-of-type where needed) that is unique. Falls back to a full
 * path from the root when nothing shorter is unique.
 */
export function uniqueSelector(el: Element): string {
  const root = queryRoot(el);
  const direct = idSelector(el, root);
  if (direct) return direct;
  if (el === el.ownerDocument.documentElement) return "html";
  if (el === el.ownerDocument.body) return "body";

  const segments: string[] = [];
  let current: Element | null = el;
  while (current) {
    const anchor = current === el ? null : idSelector(current, root);
    if (anchor) {
      segments.unshift(anchor);
      const sel = segments.join(" > ");
      if (countMatches(root, sel) === 1) return sel;
      segments.shift();
    }
    segments.unshift(segmentFor(current));
    const candidate = segments.join(" > ");
    if (countMatches(root, candidate) === 1) return candidate;
    const parent: Element | null = current.parentElement;
    if (!parent) break;
    current = parent;
  }
  // Last resort: a fully-indexed path from the root, which is always unique.
  const parts: string[] = [];
  let node: Element | null = el;
  while (node) {
    const parent: Element | null = node.parentElement;
    let seg = cssEscape(node.localName);
    if (parent) {
      const idx = Array.from(parent.children).filter((c) => c.localName === node!.localName).indexOf(node) + 1;
      seg += `:nth-of-type(${idx})`;
    }
    parts.unshift(seg);
    node = parent;
  }
  return parts.join(" > ");
}

/** Whitespace-collapsed outerHTML, truncated to `max` characters. */
export function outerHtmlSnippet(el: Element, max: number = MAX_HTML_SNIPPET): string {
  let html = "";
  try {
    html = el.outerHTML;
  } catch {
    html = `<${el.localName}>`;
  }
  html = html.replace(/\s+/g, " ").trim();
  return html.length <= max ? html : html.slice(0, max - 1) + "…";
}
