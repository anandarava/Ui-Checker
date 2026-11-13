import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface RowMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  onSelect(): void;
  /** Shown as unavailable but still focusable (aria-disabled), so its hint can be read. */
  disabled?: boolean;
  /** Explanation, shown visibly while the item is disabled; also used as the title. */
  hint?: string;
  danger?: boolean;
  separatorBefore?: boolean;
}

interface Props {
  trigger: ReactNode;
  ariaLabel: string;
  items: RowMenuItem[];
  triggerClassName: string;
  /** Extra attributes for the trigger, e.g. a data-* hook used for focus restoration. */
  triggerProps?: Record<string, string>;
  onOpen?(): void;
  disabled?: boolean;
  panelClassName?: string;
  /** Open the panel above the trigger (for triggers at the bottom of the view). */
  above?: boolean;
}

/**
 * Menu button: trigger with aria-haspopup="menu" and a panel of role=menuitem buttons.
 * Arrow keys move, Escape closes and returns focus to the trigger, choosing an item closes the menu.
 */
export function RowMenu({ trigger, ariaLabel, items, triggerClassName, triggerProps, onOpen, disabled, panelClassName = "w-48", above = false }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
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

  const onPanelKey = (e: KeyboardEvent) => {
    const els = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (els.length === 0) return;
    const at = els.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === "ArrowDown") next = (at + 1) % els.length;
    else if (e.key === "ArrowUp") next = (at - 1 + els.length) % els.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = els.length - 1;
    if (next >= 0) {
      e.preventDefault();
      els[next]?.focus();
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen((o) => !o);
        }}
        className={triggerClassName}
        {...triggerProps}
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={panelRef}
          id={`${id}-menu`}
          role="menu"
          aria-label={ariaLabel}
          onKeyDown={onPanelKey}
          className={`absolute right-0 z-20 ${above ? "bottom-full mb-1" : "top-full mt-1"} rounded-xl border border-slate-300 bg-white p-1.5 shadow-lg ${panelClassName}`}
        >
          {items.map((it) => (
            <div key={it.key} role="none">
              {it.separatorBefore && <div role="separator" className="my-1 border-t border-slate-200" />}
              <button
                type="button"
                role="menuitem"
                title={it.hint}
                aria-disabled={it.disabled ? true : undefined}
                onClick={() => {
                  if (it.disabled) return;
                  setOpen(false);
                  triggerRef.current?.focus();
                  it.onSelect();
                }}
                className={`flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium aria-disabled:cursor-not-allowed aria-disabled:text-slate-500 aria-disabled:hover:bg-transparent ${
                  it.danger ? "text-red-700 hover:bg-red-50" : "text-slate-900 hover:bg-slate-50"
                }`}
              >
                <span className="mt-0.5">{it.icon}</span>
                <span className="min-w-0">
                  <span className="block">{it.label}</span>
                  {it.hint && it.disabled && <span className="block text-xs font-normal text-slate-600">{it.hint}</span>}
                </span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
