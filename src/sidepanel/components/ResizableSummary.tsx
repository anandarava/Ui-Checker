import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

/** Where the chosen summary height is remembered between panel sessions. */
const STORAGE_KEY = "ui-consistency-checker.summaryHeight";
/** Arrow-key step, in CSS px. */
const STEP = 32;

function loadHeight(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

function saveHeight(height: number | null): void {
  try {
    if (height === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(Math.round(height)));
  } catch {
    // Storage unavailable: the size simply is not remembered.
  }
}

/**
 * The scan summary with a draggable divider below it. Dragging the divider up
 * shrinks the summary (down to hidden) so the issue list gets the space; the
 * summary scrolls when it is partly shown. The divider is a focusable
 * separator: Arrow Up/Down resize, Home hides the summary, End shows all of it,
 * Enter toggles between the two. The chosen size is remembered.
 */
export function ResizableSummary({ children }: { children: ReactNode }) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ startY: number; startHeight: number } | null>(null);
  const [natural, setNatural] = useState(0);
  // null = show the whole summary.
  const [height, setHeight] = useState<number | null>(loadHeight);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setNatural(el.offsetHeight));
    ro.observe(el);
    setNatural(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

  const shown = height === null ? natural : Math.min(height, natural);
  const hidden = natural > 0 && shown <= 0;
  const full = height === null || height >= natural;

  const commit = (next: number | null) => {
    // Snap to "full" at the natural size so the summary grows again when a later scan makes it taller.
    const value = next === null || next >= natural ? null : Math.max(0, next);
    setHeight(value);
    saveHeight(value);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, startHeight: shown };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const next = drag.current.startHeight + (e.clientY - drag.current.startY);
    setHeight(Math.max(0, Math.min(natural, next)));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    commit(height);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null;
    if (e.key === "ArrowUp") next = shown - STEP;
    else if (e.key === "ArrowDown") next = shown + STEP;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = null;
    else if (e.key === "Enter" || e.key === " ") next = hidden ? null : 0;
    else return;
    e.preventDefault();
    commit(next);
  };

  const percent = natural > 0 ? Math.round((shown / natural) * 100) : 100;

  return (
    <>
      <div
        id="summary-region"
        className={`shrink-0 ${full ? "" : "overflow-y-auto"}`}
        // visibility (not display) keeps the summary measurable while it takes it out of
        // the tab order and the accessibility tree when fully collapsed.
        style={full ? undefined : { height: shown, visibility: hidden ? "hidden" : undefined }}
      >
        <div ref={innerRef}>{children}</div>
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize summary"
        aria-controls="summary-region"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={hidden ? "Summary hidden" : full ? "Summary fully shown" : `Summary ${percent}% shown`}
        tabIndex={0}
        title="Drag to resize the summary. Double-click to hide or show it."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => commit(hidden ? null : 0)}
        onKeyDown={onKeyDown}
        className="group flex h-3 shrink-0 cursor-row-resize touch-none select-none items-center justify-center border-b border-slate-300 bg-slate-50 hover:bg-slate-200 focus-visible:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600"
      >
        <span aria-hidden="true" className="h-1 w-10 rounded-full bg-slate-400 group-hover:bg-slate-600" />
      </div>
    </>
  );
}
