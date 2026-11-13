import { useEffect } from "react";
import { drawBadges } from "@src/sidepanel/hooks/messaging";
import { useStore } from "@src/sidepanel/store";
import { Popover } from "./Popover";
import { EyeIcon } from "./icons";

/**
 * Keeps the badges on the page in step with the panel: drawn again when a
 * finding is ignored or reopened, removed when the switch goes off. Runs for
 * the whole life of the panel, not inside the menu.
 */
export function useOverlaySync(): void {
  const tabId = useStore((s) => s.tabId);
  const result = useStore((s) => s.result);
  const showBadges = useStore((s) => s.showBadges);
  useEffect(() => {
    if (tabId === null || !result) return;
    void drawBadges(tabId, result, showBadges).then((res) => {
      if (!res.ok && showBadges) {
        const store = useStore.getState();
        store.setShowBadges(false);
        store.showToast({ kind: "error", message: "The page has changed since the scan. Scan again to show the issues on the page." });
      }
    });
  }, [tabId, result, showBadges]);
}

/**
 * What the extension draws on the page: numbered badges on the elements of
 * the open findings, and the peer groups (from the Peer groups tab). The
 * measurement of a finding is drawn while that finding is open.
 */
export function OverlayMenu() {
  const result = useStore((s) => s.result);
  const showBadges = useStore((s) => s.showBadges);
  const setShowBadges = useStore((s) => s.setShowBadges);
  const autoHighlight = useStore((s) => s.autoHighlight);
  const setAutoHighlight = useStore((s) => s.setAutoHighlight);
  const setResultTab = useStore((s) => s.setResultTab);
  const setView = useStore((s) => s.setView);

  return (
    <Popover
      label={
        <>
          <EyeIcon /> Overlay{showBadges ? ": on" : ""}
        </>
      }
      ariaLabel={`Overlay on the page${showBadges ? ", issue badges shown" : ""}`}
      disabled={!result}
      size="sm"
      className="flex-1 basis-[5.5rem]"
      panelClassName="w-72 rounded-md border border-slate-400 p-2"
    >
      <fieldset>
        <legend className="px-1 pb-1 text-xs font-semibold text-slate-800">Show on the page</legend>
        <label className="flex items-start gap-2 rounded px-1 py-1 text-[13px] text-slate-900 hover:bg-slate-50">
          <input type="checkbox" className="mt-0.5" checked={showBadges} onChange={(e) => setShowBadges(e.target.checked)} />
          <span>
            Numbered badges
            <span className="block text-[11px] text-slate-600">One badge per open issue; select a badge to open the issue</span>
          </span>
        </label>
        <label className="flex items-start gap-2 rounded px-1 py-1 text-[13px] text-slate-900 hover:bg-slate-50">
          <input type="checkbox" className="mt-0.5" checked={autoHighlight} onChange={(e) => setAutoHighlight(e.target.checked)} />
          <span>
            Measurements of the open issue
            <span className="block text-[11px] text-slate-600">Its element, its peers and what was measured, drawn like a redline</span>
          </span>
        </label>
        <button
          type="button"
          onClick={() => {
            setResultTab("groups");
            setView("list");
          }}
          className="mt-1 rounded px-1 py-0.5 text-xs font-medium text-blue-800 hover:bg-blue-50 hover:underline"
        >
          Peer groups: choose which ones to outline
        </button>
      </fieldset>
    </Popover>
  );
}
