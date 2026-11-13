/**
 * Overlay root: a fixed, pointer-transparent host attached to <html> with a
 * closed shadow root. Everything the extension draws on the page lives here.
 * Same host, box, badge and label styles as the PalTech Accessibility Testing
 * extension's overlay.
 *
 * Layers:
 *   groups   outlines of the members of peer groups, one colour per group
 *   badges   a numbered badge on the element of every finding (click opens it)
 *   focus    the finding open in the panel: its element, its peers (dashed)
 *            and the measurement that was compared (the redline)
 *
 * Positions are recomputed from getBoundingClientRect on scroll and resize.
 */
import { OVERLAY_HOST_ID, OWN_UI_ATTR } from "@shared/constants";
import type { Mark, Severity } from "@shared/types";

const HOST_STYLE =
  "all:initial!important;position:fixed!important;inset:0!important;top:0!important;left:0!important;width:auto!important;height:auto!important;" +
  "margin:0!important;padding:0!important;border:0!important;overflow:visible!important;pointer-events:none!important;" +
  "z-index:2147483647!important;display:block!important;contain:layout style!important;";

const SHADOW_CSS = `
:host { font: 11px/1.2 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #fff; }
*, *::before, *::after { box-sizing: border-box; }
.layer { position: absolute; inset: 0; pointer-events: none; overflow: visible; font: 11px/1.2 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.box {
  position: absolute; pointer-events: none;
  border: 2px solid var(--c, #2e86de); border-radius: 2px;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.55), 0 0 0 1px rgba(0,0,0,.25);
}
.box.tint { background: color-mix(in srgb, var(--c, #2e86de) 8%, transparent); }
.box.thin { border-width: 1px; box-shadow: none; }
.box.peer { border-style: dashed; box-shadow: none; }
.box.focused { border-width: 3px; animation: uic-pulse 1.2s ease-out 3; }
@media (prefers-reduced-motion: reduce) {
  .box.focused { animation: none; box-shadow: 0 0 0 2px #fff, 0 0 0 5px var(--c, #2e86de); }
}
@keyframes uic-pulse {
  0%   { box-shadow: 0 0 0 0 var(--c, #2e86de), inset 0 0 0 1px rgba(255,255,255,.55); }
  60%  { box-shadow: 0 0 0 12px rgba(0,0,0,0), inset 0 0 0 1px rgba(255,255,255,.55); }
  100% { box-shadow: 0 0 0 0 rgba(0,0,0,0), inset 0 0 0 1px rgba(255,255,255,.55); }
}
.badge {
  position: absolute; left: -2px; top: -2px; transform: translate(-40%, -40%);
  min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px;
  background: var(--c, #2e86de); color: #fff; font-weight: 700; font-size: 11px; line-height: 20px;
  text-align: center; white-space: nowrap; text-shadow: 0 0 2px rgba(0,0,0,.9), 0 1px 1px rgba(0,0,0,.6);
  box-shadow: 0 0 0 1.5px #fff, 0 1px 4px rgba(0,0,0,.5);
  pointer-events: auto; cursor: pointer; user-select: none; -webkit-user-select: none; border: 0; font-family: inherit;
}
.badge:hover { filter: brightness(1.1); }
.badge:focus-visible { outline: none; box-shadow: 0 0 0 2px #fff, 0 0 0 4px #000; }
.pill {
  position: absolute; left: -2px; top: -2px; transform: translateY(-100%);
  padding: 1px 5px; border-radius: 3px 3px 3px 0;
  background: var(--c, #2e86de); color: #fff; font-weight: 700; font-size: 11px; line-height: 15px;
  white-space: nowrap; text-shadow: 0 0 2px rgba(0,0,0,.9), 0 1px 1px rgba(0,0,0,.6);
  box-shadow: 0 1px 3px rgba(0,0,0,.4);
}
/* The redline: the stretch that was measured, with its size, as in a design tool. */
.mark { position: absolute; pointer-events: none; background: rgba(214, 51, 108, .28); outline: 1px solid #d6336c; }
.mark-label {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  padding: 1px 4px; border-radius: 3px; background: #d6336c; color: #fff; font-weight: 700; font-size: 11px; line-height: 14px;
  white-space: nowrap; box-shadow: 0 0 0 1px #fff; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
`;

/** Colours with at least 4.5:1 against the white label text. */
const GROUP_COLORS = ["#b02a5b", "#1864ab", "#2b7a3d", "#b34700", "#6741d9", "#0b7285", "#862e9c", "#5c6b00"];
/** Severity colours of the badges; darker than the panel dots so the white number stays readable. */
const SEVERITY_COLORS: Record<Severity | "review", string> = { High: "#c2410c", Medium: "#92600a", Low: "#55606e", review: "#0b7285" };
const FOCUS_COLOR = "#1d4ed8";

export interface OverlayGroup {
  id: string;
  /** Short name drawn on each member, e.g. "G3". */
  badge: string;
  nodes: Element[];
}

export interface OverlayFinding {
  id: string;
  /** Number shown on the badge: the finding's position in the result, from 1. */
  number: number;
  severity: Severity;
  review: boolean;
  node: Element;
  /** The other members of the group that was compared. */
  peers: Element[];
  /** What was measured, in page coordinates of the top document. */
  marks: Mark[];
}

interface Placed {
  box: HTMLElement;
  node?: Element;
  /** Page coordinates, for marks. */
  page?: { x: number; y: number; width: number; height: number };
}

let host: HTMLElement | null = null;
const layers: Record<"groups" | "badges" | "focus", HTMLElement | null> = { groups: null, badges: null, focus: null };
const placed: Record<"groups" | "badges" | "focus", Placed[]> = { groups: [], badges: [], focus: [] };
let frameRequest = 0;
let onBadgeClick: (id: string) => void = () => undefined;

function ensureLayer(name: "groups" | "badges" | "focus"): HTMLElement {
  if (!host || !host.isConnected) {
    host = document.createElement("div");
    host.id = OVERLAY_HOST_ID;
    host.setAttribute(OWN_UI_ATTR, "");
    host.setAttribute("aria-hidden", "true");
    host.setAttribute("style", HOST_STYLE);
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = SHADOW_CSS;
    shadow.append(style);
    for (const key of ["groups", "focus", "badges"] as const) {
      const layer = document.createElement("div");
      layer.className = "layer";
      layer.dataset.layer = key;
      shadow.append(layer);
      layers[key] = layer;
      placed[key] = [];
    }
    document.documentElement.appendChild(host);
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.addEventListener("resize", schedule, { passive: true });
  }
  return layers[name]!;
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
  for (const list of Object.values(placed)) {
    for (const { box, node, page } of list) {
      let rect: { left: number; top: number; width: number; height: number };
      if (node) {
        if (!node.isConnected) {
          box.style.display = "none";
          continue;
        }
        rect = viewportRect(node);
      } else if (page) {
        rect = { left: page.x - window.scrollX, top: page.y - window.scrollY, width: page.width, height: page.height };
      } else {
        continue;
      }
      box.style.display = rect.width > 0 && rect.height > 0 ? "block" : "none";
      box.style.left = `${rect.left}px`;
      box.style.top = `${rect.top}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
    }
  }
}

function schedule(): void {
  if (!frameRequest) frameRequest = requestAnimationFrame(place);
}

function clearLayer(name: "groups" | "badges" | "focus"): void {
  layers[name]?.replaceChildren();
  placed[name] = [];
}

function removeHostIfEmpty(): void {
  if (placed.groups.length + placed.badges.length + placed.focus.length === 0) clearOverlay();
}

function addBox(layer: "groups" | "badges" | "focus", node: Element, colour: string, className: string): HTMLElement {
  const box = document.createElement("div");
  box.className = `box ${className}`;
  box.style.setProperty("--c", colour);
  ensureLayer(layer).appendChild(box);
  placed[layer].push({ box, node });
  return box;
}

/** Outlines the members of the given groups; replaces the groups shown before. */
export function showGroups(groups: OverlayGroup[]): number {
  ensureLayer("groups");
  clearLayer("groups");
  groups.forEach((group, g) => {
    const colour = GROUP_COLORS[g % GROUP_COLORS.length];
    for (const node of group.nodes) {
      const box = addBox("groups", node, colour, "tint");
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = group.badge;
      box.appendChild(pill);
    }
  });
  place();
  const count = placed.groups.length;
  removeHostIfEmpty();
  return count;
}

/** Draws a numbered badge on the element of each finding; replaces the badges shown before. */
export function showBadges(findings: OverlayFinding[], onClick: (id: string) => void): number {
  ensureLayer("badges");
  clearLayer("badges");
  onBadgeClick = onClick;
  for (const f of findings) {
    const colour = SEVERITY_COLORS[f.review ? "review" : f.severity];
    const box = addBox("badges", f.node, colour, "thin");
    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = "badge";
    badge.textContent = String(f.number);
    badge.setAttribute("aria-label", `Issue ${f.number}`);
    badge.tabIndex = -1;
    badge.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      onBadgeClick(f.id);
    });
    box.appendChild(badge);
  }
  place();
  const count = placed.badges.length;
  removeHostIfEmpty();
  return count;
}

/**
 * Shows one finding: its element, the peers it was compared with (dashed) and
 * the measurement (redline). Pass null to remove it.
 */
export function focusFinding(finding: OverlayFinding | null, withPeers: boolean): void {
  ensureLayer("focus");
  clearLayer("focus");
  if (finding) {
    if (withPeers) for (const peer of finding.peers) if (peer !== finding.node) addBox("focus", peer, FOCUS_COLOR, "peer");
    addBox("focus", finding.node, FOCUS_COLOR, "focused");
    for (const mark of finding.marks) {
      const el = document.createElement("div");
      el.className = "mark";
      if (mark.label) {
        const label = document.createElement("span");
        label.className = "mark-label";
        label.textContent = mark.label;
        el.appendChild(label);
      }
      layers.focus!.appendChild(el);
      // A measurement thinner than 2px is still drawn as a visible line.
      placed.focus.push({ box: el, page: { x: mark.box.x, y: mark.box.y, width: Math.max(2, mark.box.width), height: Math.max(2, mark.box.height) } });
    }
    place();
  }
  removeHostIfEmpty();
}

/** Scrolls the element to the middle of the viewport when it is not fully in view. */
export function scrollToElement(node: Element): void {
  const rect = node.getBoundingClientRect();
  const visible = rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth;
  if (!visible) node.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
}

/** Removes everything the extension drew on the page. */
export function clearOverlay(): void {
  if (frameRequest) cancelAnimationFrame(frameRequest);
  frameRequest = 0;
  for (const key of ["groups", "badges", "focus"] as const) {
    placed[key] = [];
    layers[key] = null;
  }
  window.removeEventListener("scroll", schedule, { capture: true });
  window.removeEventListener("resize", schedule);
  host?.remove();
  host = null;
}
