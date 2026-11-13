import { useId } from "react";
import { useStore } from "@src/sidepanel/store";
import { changeSettings } from "@src/sidepanel/hooks/useBackgroundEvents";
import { Button } from "./Button";
import { useStartScan } from "./ScanButton";
import { LandingIllustration } from "./EmptyState";
import { LightbulbIcon, PlayIcon } from "./icons";
import { SelectMenu, TOLERANCE_PRESET_OPTIONS } from "./SelectMenu";

/**
 * Initial view of the side panel, before the first scan of a tab: choose how
 * strict the comparison is, then start. Same layout as the landing view of the
 * PalTech Accessibility Testing extension.
 */
export function LandingView() {
  const id = useId();
  const tabId = useStore((s) => s.tabId);
  const settings = useStore((s) => s.settings);
  const scanning = useStore((s) => s.scanning);
  const startScan = useStartScan();
  const noTab = tabId === null;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-gradient-to-b from-blue-50 to-white p-3">
      <section aria-labelledby={`${id}-h`} className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
        <div className="flex flex-col items-center text-center">
          <div aria-hidden="true" className="flex h-36 w-36 items-center justify-center rounded-full bg-blue-100">
            <LandingIllustration />
          </div>
          <h2 id={`${id}-h`} className="mt-4 text-lg font-bold text-slate-900">
            Scan your page for UI consistency issues
          </h2>
          <p className="mt-1 text-sm text-slate-700">
            Finds uneven padding, misaligned elements and mismatched fonts between elements that should look the same.
          </p>
        </div>

        {noTab && (
          <p role="status" className="mt-4 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            No active tab detected. Open a regular web page in this window to scan it.
          </p>
        )}

        <div className="mt-4 space-y-3 rounded-xl border border-slate-300 bg-white p-3">
          <div>
            <span id={`${id}-preset-lbl`} className="mb-1 block text-xs font-semibold text-slate-800">
              Tolerance
            </span>
            <SelectMenu
              id={`${id}-preset`}
              label="Tolerance"
              labelledBy={`${id}-preset-lbl`}
              value={settings.tolerancePreset}
              options={TOLERANCE_PRESET_OPTIONS}
              onChange={(v) => void changeSettings({ tolerancePreset: v })}
              disabled={scanning}
              fullWidth
            />
          </div>

          <div className="flex gap-2 rounded-md border border-blue-100 bg-blue-50 p-2.5 text-xs text-slate-800">
            <LightbulbIcon size={16} className="mt-0.5 text-blue-700" />
            <p>
              The scan compares each element with the elements that play the same role on this page, such as the cards of a row or the
              titles of each section. It works on any web application and sends nothing off your machine.
            </p>
          </div>

          <Button variant="primary" size="md" className="w-full py-2.5" onClick={() => void startScan()} disabled={noTab || scanning}>
            <PlayIcon size={12} />
            {scanning ? "Scanning…" : "Start scan"}
          </Button>
        </div>
      </section>
    </div>
  );
}
