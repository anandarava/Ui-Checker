import { useEffect, useId, useState } from "react";
import { sendToTab } from "@shared/messages";
import { useStore } from "@src/sidepanel/store";
import { Button } from "./Button";
import { Popover } from "./Popover";
import { RadioRow } from "./RadioRow";
import { useStartScan } from "./ScanButton";
import { CrosshairIcon, MonitorIcon, PartOfPageIcon } from "./icons";

/** Event the background-events hook fires when an element was picked on the page. */
export const PICKED_EVENT = "ui-check:picked";

interface Props {
  /** DevTools only: resolves a selector for the element selected in the Elements panel ($0). */
  getInspectedSelector?(): Promise<string | null>;
}

/**
 * "Full page" / "Part of page" scope, as in the PalTech Accessibility Testing
 * extension: type a CSS selector, pick an element on the page, or (in
 * DevTools) use the element selected in the Elements panel. Picking starts the
 * scan straight away.
 */
export function ScopeControl({ getInspectedSelector }: Props) {
  const id = useId();
  const tabId = useStore((s) => s.tabId);
  const scanning = useStore((s) => s.scanning);
  const scope = useStore((s) => s.scope);
  const setScope = useStore((s) => s.setScope);
  const picking = useStore((s) => s.picking);
  const setPicking = useStore((s) => s.setPicking);
  const showToast = useStore((s) => s.showToast);
  const startScan = useStartScan();
  const [draft, setDraft] = useState(scope.selector ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDraft(scope.selector ?? ""), [scope.selector]);

  // The picker result arrives as a broadcast; scan the picked element right away.
  useEffect(() => {
    const onPicked = () => void startScan();
    window.addEventListener(PICKED_EVENT, onPicked);
    return () => window.removeEventListener(PICKED_EVENT, onPicked);
  }, [startScan]);

  const applySelector = (value: string): boolean => {
    const selector = value.trim();
    if (!selector) {
      setError("Enter a CSS selector, or pick an element on the page.");
      return false;
    }
    try {
      document.createDocumentFragment().querySelector(selector);
    } catch {
      setError(`"${selector}" is not a valid CSS selector.`);
      return false;
    }
    setError(null);
    setScope({ kind: "selector", selector });
    return true;
  };

  const pick = async () => {
    if (tabId === null) return;
    setPicking(true);
    const res = await sendToTab(tabId, { type: "CS_PICK_START", tabId }, 0);
    if (!res.ok) {
      setPicking(false);
      showToast({ kind: "error", message: "Could not start the element picker. Scan the page once, then try again." });
      return;
    }
    showToast({ kind: "info", message: "Click an element on the page to scan it. Press Esc to cancel." });
  };

  const cancelPick = () => {
    if (tabId === null) return;
    setPicking(false);
    void sendToTab(tabId, { type: "CS_PICK_CANCEL", tabId }, 0);
  };

  const useInspected = async () => {
    if (!getInspectedSelector) return;
    const selector = await getInspectedSelector();
    if (!selector) {
      showToast({ kind: "error", message: "Select an element in the Elements panel first." });
      return;
    }
    setDraft(selector);
    if (applySelector(selector)) void startScan();
  };

  const label = scope.kind === "page" ? "Full page" : "Part of page";

  return (
    <Popover
      label={
        <>
          {scope.kind === "page" ? <MonitorIcon size={14} /> : <PartOfPageIcon size={14} />} {label}
        </>
      }
      ariaLabel={`Scan scope: ${label}. Change scope`}
      align="left"
      disabled={tabId === null}
      size="sm"
      className="flex-1 basis-[5.5rem]"
      wrap="whitespace-normal"
      panelClassName="w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border border-slate-300 p-3"
    >
      <fieldset className="m-0 min-w-0 border-0 p-0" disabled={scanning}>
        <legend className="mb-1.5 p-0 text-[11px] font-semibold tracking-wide text-slate-600 uppercase">What to scan</legend>
        <RadioRow name={`${id}-scope`} checked={scope.kind === "page"} onChange={() => setScope({ kind: "page" })} title="Full page" hint="Everything currently rendered" />
        <RadioRow name={`${id}-scope`} checked={scope.kind === "selector"} onChange={() => setScope({ kind: "selector", selector: draft.trim() })} title="Part of page" hint="One region or component" />
      </fieldset>

      {/* Choosing what to scan only matters for "Part of page". */}
      {scope.kind === "selector" && (
        <fieldset className="m-0 mt-2 min-w-0 border-0 border-t border-slate-200 p-0 pt-3" disabled={scanning}>
          <label htmlFor={`${id}-selector`} className="block text-xs font-medium text-slate-800">
            CSS selector
          </label>
          <div className="mt-0.5 flex gap-1.5">
            <input
              id={`${id}-selector`}
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && applySelector(draft)) void startScan();
              }}
              placeholder="main, #results, .card"
              aria-invalid={error ? "true" : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              className="min-w-0 flex-1 rounded border border-slate-500 bg-white px-2 py-1 font-mono text-xs text-slate-900"
            />
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                if (applySelector(draft)) void startScan();
              }}
            >
              Scan
            </Button>
          </div>
          {error && (
            <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-red-700">
              {error}
            </p>
          )}
          {picking ? (
            <button type="button" onClick={cancelPick} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-red-700 bg-red-50 px-3 py-2 text-sm font-medium text-red-800 hover:bg-red-100">
              <CrosshairIcon size={16} /> Cancel picking
            </button>
          ) : (
            <button type="button" onClick={() => void pick()} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-blue-600 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-800 hover:bg-blue-100">
              <CrosshairIcon size={16} /> Pick an element on the page
            </button>
          )}
          {getInspectedSelector && (
            <Button className="mt-1.5 w-full rounded-lg" onClick={() => void useInspected()}>
              Scan selected element ($0)
            </Button>
          )}
          <p className="mt-2 text-xs text-slate-700">
            {scope.selector ? (
              <>
                Scanning only <code className="break-all font-mono">{scope.selector}</code> and everything inside it.
              </>
            ) : (
              "Type a selector or pick an element to choose what to scan."
            )}
          </p>
        </fieldset>
      )}
    </Popover>
  );
}
