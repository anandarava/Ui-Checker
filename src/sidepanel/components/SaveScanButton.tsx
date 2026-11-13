import { useId, useState, type FormEvent } from "react";
import type { SavedScanMeta } from "@shared/types";
import { sendToBackground } from "@shared/messages";
import { useStore } from "@src/sidepanel/store";
import { Button } from "./Button";
import { Popover } from "./Popover";
import { BookmarkIcon } from "./icons";
import { savedScanName } from "./SavedScans";

/**
 * Footer "Save scan": a small popup asks for a name, saves the current result and then opens the
 * Saved scans view, where the new entry is listed.
 */
export function SaveScanButton() {
  const id = useId();
  const tabId = useStore((s) => s.tabId);
  const hasResult = useStore((s) => Boolean(s.result));
  const setView = useStore((s) => s.setView);
  const showToast = useStore((s) => s.showToast);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [withShots, setWithShots] = useState(true);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (tabId === null) return;
    if (!name.trim()) {
      setError("Enter a name for this scan.");
      return;
    }
    setError(null);
    setBusy(true);
    const res = await sendToBackground<SavedScanMeta>({ type: "SAVED_SCAN_SAVE", tabId, name: savedScanName(name), screenshots: withShots });
    setBusy(false);
    if (!res.ok) {
      showToast({ kind: "error", message: `Could not save the scan: ${res.error ?? "unknown error"}`, autoDismiss: false });
      return;
    }
    showToast({ kind: "success", message: `Saved "${res.data?.name ?? name}".` });
    setName("");
    setView("saved");
  };

  return (
    <Popover
      label={
        <>
          <BookmarkIcon /> Save scan
        </>
      }
      side="top"
      align="left"
      disabled={tabId === null || !hasResult}
      panelClassName="w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border border-slate-300 p-3"
    >
      <form onSubmit={(e) => void save(e)}>
        {/* aria-labelledby (not htmlFor): clicking the caption must not move focus into the field. */}
        <p id={`${id}-label`} className="text-xs font-bold text-slate-900">
          Save the current scan as
        </p>
        <div className="mt-1.5 flex gap-2">
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus -- the popup opens for this one field
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            aria-labelledby={`${id}-label`}
            aria-invalid={error ? "true" : undefined}
            aria-describedby={`${id}-hint${error ? ` ${id}-err` : ""}`}
            placeholder="e.g. Checkout page"
            className="min-w-0 flex-1 rounded-md border border-slate-500 bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-600"
          />
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? (withShots ? "Taking screenshots…" : "Saving…") : "Save"}
          </Button>
        </div>
        {error && (
          <p id={`${id}-err`} role="alert" className="mt-1 text-xs text-red-700">
            {error}
          </p>
        )}
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-slate-700">
          The date and time are added when you save.
        </p>
        <label className="mt-2 flex items-start gap-2 text-sm text-slate-800">
          <input type="checkbox" className="mt-1" checked={withShots} onChange={(e) => setWithShots(e.target.checked)} />
          <span>
            Include screenshots
            <span className="block text-xs text-slate-700">Photographs every open issue now, so the reports of this scan show them. The page scrolls while it runs.</span>
          </span>
        </label>
      </form>
    </Popover>
  );
}
