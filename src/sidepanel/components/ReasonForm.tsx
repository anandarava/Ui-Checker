import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "./Button";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isFocusable(el: Element | null | undefined): el is HTMLElement {
  return !!el && el instanceof HTMLElement && el.isConnected && !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true";
}

/**
 * Pick where keyboard focus should land once the form is gone (WCAG 2.4.3):
 * 1. the control that opened the form, if it is still in the DOM and enabled;
 * 2. otherwise the last focusable control that preceded the form inside its host
 *    container (e.g. the remaining "Ignore…"/"Add to baseline…" toggle);
 * 3. otherwise the heading that labels the enclosing section, or the nearest
 *    programmatically focusable ancestor.
 */
function findRestoreTarget(opener: Element | null, host: HTMLElement | null, nextSibling: Node | null): HTMLElement | null {
  if (isFocusable(opener)) return opener;
  if (!host || !host.isConnected) return null;

  const candidates = Array.from(host.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isFocusable);
  const before = nextSibling
    ? candidates.filter((el) => nextSibling.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING)
    : candidates;
  const preceding = before[before.length - 1] ?? candidates[0];
  if (preceding) return preceding;

  const section = host.closest<HTMLElement>("[aria-labelledby]");
  const headingId = section?.getAttribute("aria-labelledby");
  const heading = headingId ? document.getElementById(headingId) : null;
  if (heading instanceof HTMLElement && heading.isConnected) return heading;

  return host.closest<HTMLElement>("[tabindex]");
}

interface Props {
  title: string;
  description: string;
  submitLabel: string;
  busy?: boolean;
  onSubmit(reason: string): void;
  onCancel(): void;
}

/**
 * Accessible inline replacement for window.prompt(): a small labelled form
 * with a required reason field, focus moved into it on open and Escape to cancel.
 */
export function ReasonForm({ title, description, submitLabel, busy = false, onSubmit, onCancel }: Props) {
  const id = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Remember what had focus (the toggle that opened us) and where we live, so
    // focus can be restored when the form unmounts on cancel/submit instead of
    // silently dropping to <body>.
    const opener = document.activeElement;
    const form = formRef.current;
    const host = form?.parentElement ?? null;
    const nextSibling = form?.nextSibling ?? null;
    inputRef.current?.focus();

    return () => {
      const active = document.activeElement;
      // Only restore if focus was lost (form removed) or is still inside the
      // form; never steal focus from something the app moved focus to itself.
      if (active && active !== document.body && !(form && form.contains(active))) return;
      const target = findRestoreTarget(opener, host, nextSibling);
      if (target) {
        if (target.tabIndex < 0 && !target.hasAttribute("tabindex")) target.tabIndex = -1;
        target.focus();
      }
    };
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("Please enter a reason.");
      inputRef.current?.focus();
      return;
    }
    setError(null);
    onSubmit(trimmed);
  };

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
      className="mt-2 rounded border border-slate-400 bg-slate-50 p-2"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-desc`}
    >
      <h4 id={`${id}-title`} className="text-sm font-semibold text-slate-900">
        {title}
      </h4>
      <p id={`${id}-desc`} className="mb-1 text-xs text-slate-700">
        {description}
      </p>
      <label htmlFor={`${id}-reason`} className="block text-xs font-medium text-slate-800">
        Reason <span aria-hidden="true">*</span>
      </label>
      <textarea
        id={`${id}-reason`}
        ref={inputRef}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        required
        aria-required="true"
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="mt-0.5 w-full rounded border border-slate-500 bg-white px-2 py-1 text-sm text-slate-900"
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-red-700">
          {error}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </Button>
        <Button type="button" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
