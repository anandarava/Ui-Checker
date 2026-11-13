/**
 * The parts a page shares with the other pages of its site (PLAN.md, Phase 6):
 * the page title, the header, the navigation, the footer and tab bars. A site
 * scan compares them across pages (shared/cross-page.ts).
 *
 * They are found from standard elements and roles (h1, header, nav, footer,
 * role="banner", "navigation", "contentinfo", "tablist") and described by
 * what was measured. Never from class names, ids or text.
 */
import type { Facts } from "./facts";
import type { ElementSnapshot } from "./snapshot";

export type PartKind = "pageTitle" | "header" | "navigation" | "footer" | "tabs";

export interface RawPartItem {
  /** The label of the item; "" when it shows an icon only. */
  text: string;
  /** True when the item shows an icon or image. */
  icon: boolean;
}

export interface RawPart {
  /** The same part has the same key on every page: "pageTitle", "navigation:side:1"... */
  key: string;
  kind: PartKind;
  /** As shown: "Page title", "Side navigation". */
  name: string;
  /** Snapshot index of the element. */
  element: number;
  /** Snapshot index of the element whose text style is compared (the part itself, or its first item with text). */
  styled: number;
  /** The text of a page title. */
  text?: string;
  /** The links, buttons or tabs of a navigation or tab bar, in order. */
  items?: RawPartItem[];
}

const MAX_ITEMS = 40;

export function findSharedParts(elements: ElementSnapshot[], facts: Facts): RawPart[] {
  const shown = (el: ElementSnapshot): boolean => el.clip !== "full";
  const is = (el: ElementSnapshot, tag: string, role: string): boolean => el.tag === tag || el.role === role;

  /** The first text in the element or inside it. */
  const textOf = (i: number): { text: string; el: number } | null => {
    if (elements[i].text) return { text: elements[i].text, el: i };
    for (const c of elements[i].children) {
      const found = textOf(c);
      if (found) return found;
    }
    return null;
  };

  const hasIcon = (i: number): boolean =>
    elements[i].children.some((c) => {
      const child = elements[c];
      if (child.tag === "svg" || child.tag === "img") return true;
      return child.children.length === 0 ? child.text === "" : hasIcon(c);
    });

  /** The links, buttons and tabs inside an element; one inside another counts once. */
  const itemsOf = (root: number): { items: RawPartItem[]; firstText: number } => {
    const items: RawPartItem[] = [];
    let firstText = -1;
    const walk = (i: number): void => {
      if (items.length >= MAX_ITEMS) return;
      if (i !== root && facts.isInteractive(i) && shown(elements[i])) {
        const label = textOf(i);
        items.push({ text: label?.text ?? "", icon: hasIcon(i) || (elements[i].children.length === 0 && elements[i].text === "") });
        if (label && firstText < 0 && !facts.inState(i)) firstText = label.el;
        return;
      }
      for (const c of elements[i].children) walk(c);
    };
    walk(root);
    return { items, firstText };
  };

  const parts: RawPart[] = [];

  const title = elements.find((el) => el.tag === "h1" && shown(el) && textOf(el.index) !== null);
  if (title) {
    const label = textOf(title.index)!;
    parts.push({ key: "pageTitle", kind: "pageTitle", name: "Page title", element: title.index, styled: label.el, text: label.text });
  }

  // The header and the footer of the page, not those of an article or a card inside it.
  const inside = (el: ElementSnapshot, tags: string[]): boolean => {
    for (let a = el.parent; a >= 0; a = elements[a].parent) if (tags.includes(elements[a].tag)) return true;
    return false;
  };
  const header = elements.find((el) => is(el, "header", "banner") && shown(el) && !inside(el, ["article", "section", "aside", "nav"]));
  if (header) parts.push({ key: "header", kind: "header", name: "Header", element: header.index, styled: header.index });

  const counts = { side: 0, bar: 0 };
  for (const el of elements) {
    if (!is(el, "nav", "navigation") || !shown(el)) continue;
    const { items, firstText } = itemsOf(el.index);
    if (items.length < 2) continue;
    const shape = el.box.height > el.box.width * 1.2 ? "side" : "bar";
    const n = ++counts[shape];
    const name = `${shape === "side" ? "Side navigation" : "Navigation bar"}${n > 1 ? ` ${n}` : ""}`;
    parts.push({ key: `navigation:${shape}:${n}`, kind: "navigation", name, element: el.index, styled: firstText >= 0 ? firstText : el.index, items });
  }

  let tabBars = 0;
  for (const el of elements) {
    if (el.role !== "tablist" || !shown(el)) continue;
    const { items, firstText } = itemsOf(el.index);
    if (items.length < 2) continue;
    const n = ++tabBars;
    parts.push({ key: `tabs:${n}`, kind: "tabs", name: `Tab bar${n > 1 ? ` ${n}` : ""}`, element: el.index, styled: firstText >= 0 ? firstText : el.index, items });
  }

  const footers = elements.filter((el) => is(el, "footer", "contentinfo") && shown(el) && !inside(el, ["article", "section", "aside", "nav"]));
  const footer = footers[footers.length - 1];
  if (footer) parts.push({ key: "footer", kind: "footer", name: "Footer", element: footer.index, styled: footer.index });

  return parts;
}
