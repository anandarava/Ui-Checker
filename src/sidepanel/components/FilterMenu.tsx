import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CheckIcon, ChevronDownIcon } from "./icons";

interface Props {
  /** Trigger content (before the chevron). */
  children: ReactNode;
  ariaLabel: string;
  panel: ReactNode;
  align?: "left" | "right";
  panelClassName?: string;
  className?: string;
}

/**
 * Filter dropdown: a disclosure button (aria-expanded/aria-controls) toggling a panel of
 * controls. Escape, an outside click or tabbing away closes it; Escape returns focus.
 */
export function FilterMenu({ children, ariaLabel, panel, align = "left", panelClassName = "w-64", className = "" }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      if (next && rootRef.current && !rootRef.current.contains(next)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    const root = rootRef.current;
    root?.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
      root?.removeEventListener("focusout", onFocusOut);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? `${id}-panel` : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-full w-full items-center justify-between gap-1.5 rounded-lg border bg-white px-2.5 py-1 text-xs text-slate-800 hover:bg-slate-50 ${
          open ? "border-blue-700 ring-2 ring-blue-200" : "border-slate-500"
        }`}
      >
        <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">{children}</span>
        <ChevronDownIcon size={14} className={`text-slate-700 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          id={`${id}-panel`}
          className={`absolute ${align === "left" ? "left-0" : "right-0"} top-full z-20 mt-1 max-w-[calc(100vw-1.5rem)] rounded-lg border border-slate-300 bg-white p-2 shadow-lg ${panelClassName}`}
        >
          {panel}
        </div>
      )}
    </div>
  );
}

/** Small uppercase heading used as the fieldset legend of a filter panel. */
export function FilterHeading({ children }: { children: ReactNode }) {
  return <legend className="mb-1 px-1 text-[11px] font-semibold tracking-wide text-slate-600 uppercase">{children}</legend>;
}

/** A styled checkbox row: native input (visually hidden) + drawn box, label text and a right-aligned count. */
export function FilterCheckRow({
  checked,
  onChange,
  children,
  hint,
  count,
  dimmed = false,
  describedBy,
}: {
  checked: boolean;
  onChange(): void;
  children: ReactNode;
  hint?: string;
  count?: number;
  /** Shown as unavailable (still focusable so its explanation can be read). */
  dimmed?: boolean;
  describedBy?: string;
}) {
  return (
    <label className={`flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1.5 hover:bg-slate-50 ${dimmed ? "cursor-not-allowed" : ""}`}>
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={onChange} aria-disabled={dimmed || undefined} aria-describedby={describedBy} />
      <span
        aria-hidden="true"
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue-700 ${
          checked ? "border-blue-600 bg-blue-600" : "border-slate-500 bg-white"
        }`}
      >
        {checked && <CheckIcon size={12} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-medium text-slate-900">{children}</span>
        {hint && <span className="block text-[11px] text-slate-600">{hint}</span>}
      </span>
      {count !== undefined && <span className="text-xs tabular-nums text-slate-600">{count}</span>}
    </label>
  );
}
