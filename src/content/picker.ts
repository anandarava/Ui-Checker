/**
 * On-page element picker for "Scan part of page": hovering outlines the
 * element under the pointer, a click (or Enter) picks it, Escape cancels.
 * Arrow Up / Down walk to the parent / first child of the current target so
 * a container can be picked even when its children cover it.
 *
 * The picker draws in its own closed Shadow DOM host marked with
 * OWN_UI_ATTR (excluded from scans) and removes every listener when done.
 */
import { OWN_UI_ATTR } from "@shared/constants";
import { isExtensionNode, outerHtmlSnippet, uniqueSelector } from "./dom-utils";

export interface PickResult {
  selector: string | null;
  html?: string;
}

let active: { stop(result: PickResult): void } | null = null;

export function isPicking(): boolean {
  return active !== null;
}

export function cancelPicker(): void {
  active?.stop({ selector: null });
}

function describe(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : "";
  const cls = typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
  const rect = el.getBoundingClientRect();
  return `${tag}${id}${cls}  ${Math.round(rect.width)}×${Math.round(rect.height)}`;
}

/** Start picking; resolves once with the picked selector, or null when cancelled. */
export function startPicker(onDone: (result: PickResult) => void): void {
  cancelPicker();

  const host = document.createElement("div");
  host.setAttribute(OWN_UI_ATTR, "picker");
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      .box { position: fixed; border: 2px solid #2563eb; background: rgba(37, 99, 235, 0.12); box-sizing: border-box; transition: all 60ms linear; display: none; }
      .tag { position: fixed; background: #1e3a8a; color: #fff; font: 600 12px/1.4 system-ui, sans-serif; padding: 2px 6px; border-radius: 3px; white-space: nowrap; display: none; }
      .hint { position: fixed; top: 8px; left: 50%; transform: translateX(-50%); background: #0f172a; color: #fff; font: 13px/1.4 system-ui, sans-serif; padding: 6px 12px; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,.3); }
      kbd { background: #334155; border-radius: 3px; padding: 0 4px; font: inherit; }
    </style>
    <div class="box"></div>
    <div class="tag"></div>
    <div class="hint" role="status">Click an element to scan it · <kbd>↑</kbd>/<kbd>↓</kbd> parent/child · <kbd>Enter</kbd> pick · <kbd>Esc</kbd> cancel</div>`;
  const box = root.querySelector<HTMLDivElement>(".box")!;
  const tag = root.querySelector<HTMLDivElement>(".tag")!;
  document.documentElement.appendChild(host);

  let target: Element | null = null;

  const draw = (): void => {
    if (!target) {
      box.style.display = "none";
      tag.style.display = "none";
      return;
    }
    const r = target.getBoundingClientRect();
    Object.assign(box.style, { display: "block", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    tag.textContent = describe(target);
    const top = r.top > 24 ? r.top - 22 : r.bottom + 4;
    Object.assign(tag.style, { display: "block", left: `${Math.max(0, r.left)}px`, top: `${top}px` });
  };

  const setTarget = (el: Element | null): void => {
    if (el && (isExtensionNode(el) || el === document.documentElement)) return;
    target = el;
    draw();
  };

  const onMove = (e: MouseEvent): void => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el && el !== target) setTarget(el);
  };
  const swallow = (e: Event): void => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };
  const onClick = (e: MouseEvent): void => {
    swallow(e);
    const el = document.elementFromPoint(e.clientX, e.clientY) ?? target;
    if (el && !isExtensionNode(el)) target = el;
    finish();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      swallow(e);
      stop({ selector: null });
    } else if (e.key === "Enter") {
      swallow(e);
      finish();
    } else if (e.key === "ArrowUp" && target?.parentElement && target.parentElement !== document.documentElement) {
      swallow(e);
      setTarget(target.parentElement);
    } else if (e.key === "ArrowDown" && target?.firstElementChild) {
      swallow(e);
      setTarget(target.firstElementChild);
    }
  };
  const onScroll = (): void => draw();

  const opts = { capture: true } as const;
  window.addEventListener("mousemove", onMove, opts);
  window.addEventListener("click", onClick, opts);
  // Stop the page reacting to the press that precedes the pick click.
  window.addEventListener("mousedown", swallow, opts);
  window.addEventListener("mouseup", swallow, opts);
  window.addEventListener("pointerdown", swallow, opts);
  window.addEventListener("pointerup", swallow, opts);
  window.addEventListener("keydown", onKey, opts);
  window.addEventListener("scroll", onScroll, { capture: true, passive: true });

  let done = false;
  function stop(result: PickResult): void {
    if (done) return;
    done = true;
    active = null;
    window.removeEventListener("mousemove", onMove, opts);
    window.removeEventListener("click", onClick, opts);
    window.removeEventListener("mousedown", swallow, opts);
    window.removeEventListener("mouseup", swallow, opts);
    window.removeEventListener("pointerdown", swallow, opts);
    window.removeEventListener("pointerup", swallow, opts);
    window.removeEventListener("keydown", onKey, opts);
    window.removeEventListener("scroll", onScroll, { capture: true });
    host.remove();
    onDone(result);
  }
  function finish(): void {
    if (!target) {
      stop({ selector: null });
      return;
    }
    let selector: string | null = null;
    try {
      selector = uniqueSelector(target);
    } catch {
      selector = null;
    }
    stop({ selector, html: selector ? outerHtmlSnippet(target) : undefined });
  }

  active = { stop };
}
