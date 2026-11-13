/**
 * Overlay root: a fixed, pointer-transparent host attached to <html> with a
 * closed shadow root. Everything the extension draws on the page lives here.
 * Same host, box and label styles as the PalTech Accessibility Testing
 * extension's overlay.
 *
 * Built so far: the peer-group layer (PLAN.md, Phase 2 step 7), which outlines
 * the members of each group in the group's colour so a tester can see what the
 * tool treats as "the same". Phase 4 adds the issue badges and the redlines.
 *
 * Positions are recomputed from getBoundingClientRect on scroll and resize.
 */
import { OVERLAY_HOST_ID, OWN_UI_ATTR } from "@shared/constants";

const HOST_STYLE =
  "all:initial!important;position:fixed!important;inset:0!important;top:0!important;left:0!important;width:auto!important;height:auto!important;" +
  "margin:0!important;padding:0!important;border:0!important;overflow:visible!important;pointer-events:none!important;" +
  "z-index:2147483647!important;display:block!important;contain:layout style!important;";

const SHADOW_CSS = `
:host { font: 11px/1.2 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #fff; }
*, *::before, *::after { box-sizing: border-box; }
.layer { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
.box {
  position: absolute; pointer-events: none;
  border: 2px solid var(--c, #2e86de); border-radius: 2px;
  background: color-mix(in srgb, var(--c, #2e86de) 8%, transparent);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.55), 0 0 0 1px rgba(0,0,0,.25);
}
.pill {
  position: absolute; left: -2px; top: -2px; transform: translateY(-100%);
  padding: 1px 5px; border-radius: 3px 3px 3px 0;
  background: var(--c, #2e86de); color: #fff; font-weight: 700; font-size: 11px; line-height: 15px;
  white-space: nowrap; text-shadow: 0 0 2px rgba(0,0,0,.9), 0 1px 1px rgba(0,0,0,.6);
  box-shadow: 0 1px 3px rgba(0,0,0,.4);
}
`;

/** Colours with at least 4.5:1 against the white label text. */
const GROUP_COLORS = ["#b02a5b", "#1864ab", "#2b7a3d", "#b34700", "#6741d9", "#0b7285", "#862e9c", "#5c6b00"];

export interface OverlayGroup {
  id: string;
  /** Short name drawn on each member, e.g. "G3". */
  badge: string;
  nodes: Element[];
}

let host: HTMLElement | null = null;
let layer: HTMLElement | null = null;
let shown: Array<{ box: HTMLElement; node: Element }> = [];
let frameRequest = 0;

function ensureLayer(): HTMLElement {
  if (layer && host?.isConnected) return layer;
  host = document.createElement("div");
  host.id = OVERLAY_HOST_ID;
  host.setAttribute(OWN_UI_ATTR, "");
  host.setAttribute("aria-hidden", "true");
  host.setAttribute("style", HOST_STYLE);
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = SHADOW_CSS;
  layer = document.createElement("div");
  layer.className = "layer";
  shadow.append(style, layer);
  document.documentElement.appendChild(host);
  window.addEventListener("scroll", schedule, { passive: true, capture: true });
  window.addEventListener("resize", schedule, { passive: true });
  return layer;
}

/** Viewport rectangle of an element, through the iframes it sits in. */
function viewportRect(node: Element): { left: number; top: number; width: number; height: number } {
  const rect = node.getBoundingClientRect();
  let left = rect.left;
  let top = rect.top;
  let view: Window | null = node.ownerDocument.defaultView;
  while (view && view !== window) {
    const frame = view.frameElement;
    if (!frame) break;
    const outer = frame.getBoundingClientRect();
    left += outer.left + frame.clientLeft;
    top += outer.top + frame.clientTop;
    view = frame.ownerDocument.defaultView;
  }
  return { left, top, width: rect.width, height: rect.height };
}

function place(): void {
  frameRequest = 0;
  for (const { box, node } of shown) {
    if (!node.isConnected) {
      box.style.display = "none";
      continue;
    }
    const rect = viewportRect(node);
    box.style.display = rect.width > 0 && rect.height > 0 ? "block" : "none";
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
  }
}

function schedule(): void {
  if (!frameRequest) frameRequest = requestAnimationFrame(place);
}

/** Outlines the members of the given groups; replaces what was shown before. */
export function showGroups(groups: OverlayGroup[]): number {
  const target = ensureLayer();
  target.replaceChildren();
  shown = [];
  groups.forEach((group, g) => {
    const colour = GROUP_COLORS[g % GROUP_COLORS.length];
    for (const node of group.nodes) {
      const box = document.createElement("div");
      box.className = "box";
      box.style.setProperty("--c", colour);
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = group.badge;
      box.appendChild(pill);
      target.appendChild(box);
      shown.push({ box, node });
    }
  });
  place();
  return shown.length;
}

/** Removes everything the extension drew on the page. */
export function clearOverlay(): void {
  if (frameRequest) cancelAnimationFrame(frameRequest);
  frameRequest = 0;
  shown = [];
  window.removeEventListener("scroll", schedule, { capture: true });
  window.removeEventListener("resize", schedule);
  host?.remove();
  host = null;
  layer = null;
}
