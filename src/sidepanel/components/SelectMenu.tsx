import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { TolerancePreset } from "@shared/types";
import { CheckIcon, ChevronDownIcon } from "./icons";

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  /** Small chip (or icon) shown before the label. */
  leading?: ReactNode;
}

interface Props<T extends string> {
  id: string;
  /** Accessible name. Visually hidden unless `labelledBy` points at a visible label. */
  label: string;
  /** Id of a visible element that already names this control (used instead of the hidden label). */
  labelledBy?: string;
  value: T;
  options: Array<SelectOption<T>>;
  onChange(value: T): void;
  disabled?: boolean;
  /** What the trigger shows; defaults to the selected option's label. */
  triggerContent?: ReactNode;
  align?: "left" | "right";
  /** Trigger and panel take the full width of the container. */
  fullWidth?: boolean;
  className?: string;
}

function chip(text: string) {
  return <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-bold text-slate-800">{text}</span>;
}

export const TOLERANCE_PRESET_OPTIONS: Array<SelectOption<TolerancePreset>> = [
  { value: "strict", label: "Strict", description: "Flags differences from 1 px", leading: chip("1px") },
  { value: "normal", label: "Normal", description: "Recommended: differences from 2 px", leading: chip("2px") },
  { value: "relaxed", label: "Relaxed", description: "Only clear differences, from 4 px", leading: chip("4px") },
];

/**
 * Accessible single-select dropdown: a button (aria-haspopup="listbox") that opens a
 * listbox with aria-activedescendant navigation. Replaces the native select where the
 * options need descriptions.
 */
export function SelectMenu<T extends string>({
  id,
  label,
  labelledBy,
  value,
  options,
  onChange,
  disabled = false,
  triggerContent,
  align = "left",
  fullWidth = false,
  className = "",
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const [active, setActive] = useState(selectedIndex);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const labelId = labelledBy ?? `${id}-lbl`;
  const listId = `${id}-list`;
  const optId = (i: number) => `${id}-opt-${i}`;
  const selected = options[selectedIndex];

  const show = () => {
    if (disabled) return;
    setActive(selectedIndex);
    setOpen(true);
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };
  const choose = (i: number) => {
    const o = options[i];
    if (o && o.value !== value) onChange(o.value);
    close(true);
  };

  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(optId(active))?.scrollIntoView?.({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  const onTriggerKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      show();
    }
  };

  const onListKey = (e: KeyboardEvent) => {
    const last = options.length - 1;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((a) => Math.min(last, a + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((a) => Math.max(0, a - 1));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(last);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        choose(active);
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        close(true);
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const ch = e.key.toLowerCase();
          const n = options.length;
          for (let k = 1; k <= n; k++) {
            const i = (active + k) % n;
            if (options[i].label.toLowerCase().startsWith(ch)) {
              setActive(i);
              break;
            }
          }
        }
    }
  };

  return (
    <div ref={rootRef} className={`relative ${fullWidth ? "w-full" : "inline-block"} ${className}`}>
      {!labelledBy && (
        <span id={labelId} className="sr-only">
          {label}
        </span>
      )}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={`${labelId} ${id}`}
        disabled={disabled}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={onTriggerKey}
        className={`flex items-center justify-between gap-2 rounded-lg border bg-white px-2.5 py-1 text-left text-xs font-medium text-slate-900 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-white disabled:text-slate-500 ${
          fullWidth ? "w-full py-2 text-sm" : ""
        } ${open ? "border-blue-700 ring-2 ring-blue-200" : "border-slate-500"}`}
      >
        <span className="flex min-w-0 items-center gap-2 truncate">{triggerContent ?? selected?.label}</span>
        <ChevronDownIcon size={14} className={`text-slate-700 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-labelledby={labelId}
          aria-activedescendant={optId(active)}
          onKeyDown={onListKey}
          className={`absolute ${fullWidth ? "left-0 right-0" : align === "left" ? "left-0 min-w-64" : "right-0 min-w-64"} top-full z-20 mt-1 max-w-[calc(100vw-1.5rem)] rounded-lg border border-slate-300 bg-white p-1.5 shadow-lg focus:outline-none`}
        >
          {options.map((o, i) => {
            const isSel = o.value === value;
            return (
              <div
                key={o.value}
                id={optId(i)}
                role="option"
                aria-selected={isSel}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(i)}
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 ${
                  isSel ? "bg-blue-50" : ""
                } ${i === active ? (isSel ? "bg-blue-100 ring-2 ring-inset ring-blue-700" : "bg-slate-100 ring-2 ring-inset ring-blue-700") : ""}`}
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    {o.leading}
                    {o.label}
                  </span>
                  {o.description && <span className="block text-xs text-slate-600">{o.description}</span>}
                </span>
                {isSel && <CheckIcon size={16} className="text-blue-700" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
