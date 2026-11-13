import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDownIcon } from "./icons";

interface Props {
  /** Trigger button content. */
  label: ReactNode;
  /** Accessible name of the trigger when the visible label is not enough. */
  ariaLabel?: string;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  /** Which edge of the trigger the panel aligns to. */
  align?: "left" | "right";
  /** Open below the trigger (default) or above it, e.g. for buttons in a bottom bar. */
  side?: "bottom" | "top";
  /** "sm" is the compact dropdown button used by the filters. */
  size?: "sm" | "md";
  /** Replaces the default no-wrap on the trigger, e.g. "whitespace-normal" so a long label can wrap. */
  wrap?: string;
  /** Replaces the default panel look (border, radius, padding, width). */
  panelClassName?: string;
}

/**
 * Disclosure popover: a button with aria-expanded/aria-controls that toggles a
 * panel. Escape or an outside click closes it and focus returns to the trigger.
 */
export function Popover({ label, ariaLabel, children, disabled = false, className = "", align = "right", side = "bottom", size = "md", wrap = "whitespace-nowrap", panelClassName = "min-w-48 rounded-md border border-slate-400 p-2" }: Props) {
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
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex h-full w-full items-center justify-center gap-1 rounded-md border ${open ? "border-blue-600" : "border-slate-500"} bg-white font-medium leading-tight text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-500 ${
          size === "sm" ? "px-2.5 py-1 text-xs" : "px-2 py-1.5 text-xs"
        } ${wrap}`}
      >
        {label}
        {/* The same chevron as the WCAG menus; it points the way the panel will open (or close). */}
        <ChevronDownIcon size={14} className={`text-slate-700 ${(side === "top") !== open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          id={`${id}-panel`}
          className={`absolute ${align === "left" ? "left-0" : "right-0"} ${side === "top" ? "bottom-full mb-1" : "top-full mt-1"} z-20 bg-white shadow-lg ${panelClassName}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
