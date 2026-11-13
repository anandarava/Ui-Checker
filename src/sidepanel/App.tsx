import { useCallback, useId } from "react";
import { sendToBackground } from "@shared/messages";
import { useStore } from "./store";
import { useActiveTab } from "./hooks/useActiveTab";
import { changeSettings, useBackgroundEvents } from "./hooks/useBackgroundEvents";
import { Button } from "./components/Button";
import { ScanButton, ScanProgressBar, useStartScan } from "./components/ScanButton";
import { SavedScans } from "./components/SavedScans";
import { SaveScanButton } from "./components/SaveScanButton";
import { CompareView } from "./components/CompareView";
import { SiteScan } from "./components/SiteScan";
import { PageChangedBanner } from "./components/PageChangedBanner";
import { LandingView } from "./components/LandingView";
import { ScopeControl } from "./components/ScopeControl";
import { ScoreCard } from "./components/ScoreCard";
import { ResizableSummary } from "./components/ResizableSummary";
import { ResultTabs } from "./components/ResultTabs";
import { Filters } from "./components/Filters";
import { IssueList } from "./components/IssueList";
import { IssueDetail } from "./components/IssueDetail";
import { ExportMenu } from "./components/ExportMenu";
import { OverlayMenu, useOverlaySync } from "./components/OverlayMenu";
import { SelectMenu, TOLERANCE_PRESET_OPTIONS } from "./components/SelectMenu";
import { Toast } from "./components/Toast";
import { BookmarkIcon, GlobeIcon, ResetIcon, SettingsIcon } from "./components/icons";

/** Shown while a saved scan is on screen instead of the live result of the tab. */
function SavedBanner() {
  const saved = useStore((s) => s.viewingSaved);
  const exitSaved = useStore((s) => s.exitSaved);
  const setView = useStore((s) => s.setView);
  if (!saved) return null;
  // A page opened from the Site scan list (its id is "<site scan id>:<page index>").
  const fromSiteScan = saved.id.startsWith("site_");
  return (
    <div role="status" className="flex items-center gap-2 border-b border-indigo-700 bg-indigo-50 px-3 py-2 text-sm text-indigo-950">
      <div className="min-w-0 flex-1">
        <strong>{fromSiteScan ? "Viewing:" : "Viewing saved scan:"}</strong> <span className="truncate">{saved.name}</span>
        <span className="block text-xs">{new Date(saved.scannedAt).toLocaleString()} · read-only</span>
      </div>
      {fromSiteScan ? (
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            exitSaved();
            setView("site");
          }}
        >
          Back to site scan
        </Button>
      ) : (
        <Button size="sm" variant="primary" onClick={exitSaved}>
          Back to live results
        </Button>
      )}
    </div>
  );
}

interface AppProps {
  /** Binds the panel to a fixed tab (tests, demos, DevTools); the side panel resolves the active tab itself. */
  tabIdOverride?: number;
  /** DevTools only: selector of the element selected in the Elements panel ($0). */
  getInspectedSelector?(): Promise<string | null>;
}

/**
 * Side panel. Layout follows the PalTech Accessibility Testing extension:
 * header with the scan settings, action row, progress bar, the summary with
 * the result tabs, filters and issue list (or one issue), the saved scans and
 * the comparison of two scans, and the toast.
 */
export function App({ tabIdOverride, getInspectedSelector }: AppProps) {
  const id = useId();
  useActiveTab(tabIdOverride);
  useBackgroundEvents();
  useOverlaySync();

  const tabId = useStore((s) => s.tabId);
  const settings = useStore((s) => s.settings);
  const scanning = useStore((s) => s.scanning);
  const result = useStore((s) => s.result);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const selectedIssueId = useStore((s) => s.selectedIssueId);
  const selectIssue = useStore((s) => s.selectIssue);
  const startScan = useStartScan();
  // Saved scans can be opened before the page has been scanned.
  const landing = !result && view !== "saved" && view !== "compare" && view !== "site";

  const reset = useCallback(async () => {
    const store = useStore.getState();
    if (store.tabId === null) return;
    await sendToBackground({ type: "RESET_RESULT", tabId: store.tabId });
    store.setResult(null);
  }, []);

  const openIssue = useCallback(
    (issueId: string) => {
      selectIssue(issueId);
      setView("detail");
    },
    [selectIssue, setView],
  );
  const backToList = useCallback(() => setView("list"), [setView]);

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-white text-slate-900">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
        <h1 className="text-base font-bold">PalTech UI Consistency Checker</h1>
        {/* The landing view has the same setting in its card; the header shows it with the results. */}
        {!landing && (
          <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
            <span id={`${id}-preset-lbl`} className="text-xs text-slate-700">
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
              align="right"
            />
          </div>
        )}
      </header>

      {tabId === null && !landing && (
        <p role="status" className="border-b border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          No active tab detected. Open a regular web page in this window to scan it.
        </p>
      )}

      {!landing && (
        <nav aria-label="Actions" className="flex flex-wrap gap-1.5 border-b border-slate-200 px-3 py-2">
          <ScanButton icon="refresh" />
          <ScopeControl getInspectedSelector={getInspectedSelector} />
          <OverlayMenu />
          <Button onClick={() => setView("saved")} aria-pressed={view === "saved" || view === "compare"} size="action" className="flex-1 basis-[5.5rem] whitespace-normal leading-tight">
            <BookmarkIcon /> Saved Scans
          </Button>
          <Button onClick={() => setView("site")} aria-pressed={view === "site"} size="action" className="flex-1 basis-[5.5rem] whitespace-normal leading-tight">
            <GlobeIcon /> Site Scan
          </Button>
          <Button onClick={() => void reset()} disabled={scanning} size="action" className="flex-1 basis-[5.5rem] whitespace-normal leading-tight">
            <ResetIcon /> Reset
          </Button>
          <Button onClick={() => void chrome.runtime.openOptionsPage()} size="action" className="flex-1 basis-[5.5rem] whitespace-normal leading-tight">
            <SettingsIcon /> Rules
          </Button>
        </nav>
      )}

      <ScanProgressBar />
      <SavedBanner />
      {!landing && <PageChangedBanner onRescan={() => void startScan()} />}

      <main className="flex min-h-0 flex-1 flex-col">
        {landing && <LandingView />}
        {landing && (
          <p className="px-3 pb-3 text-center">
            <Button size="sm" onClick={() => setView("saved")}>
              <BookmarkIcon /> Saved Scans
            </Button>{" "}
            <Button size="sm" onClick={() => setView("site")}>
              <GlobeIcon /> Site Scan
            </Button>
          </p>
        )}
        {view === "saved" && <SavedScans onBack={backToList} />}
        {view === "compare" && <CompareView onBack={() => setView("saved")} />}
        {view === "site" && <SiteScan onBack={backToList} />}
        {!landing && view === "list" && (
          <>
            <ResizableSummary>
              <ScoreCard />
            </ResizableSummary>
            <ResultTabs />
            <Filters />
            <IssueList onOpen={openIssue} />
          </>
        )}
        {!landing && view === "detail" && selectedIssueId && <IssueDetail issueId={selectedIssueId} onBack={backToList} />}
      </main>

      {/* The issue view has its own action bar; the export bar returns with the list. */}
      {!landing && view === "list" && (
        <footer className="sticky bottom-0 flex shrink-0 flex-wrap items-center gap-1.5 border-t border-slate-200 bg-white px-3 py-2">
          <SaveScanButton />
          <span className="flex-1" />
          <ExportMenu />
        </footer>
      )}

      <Toast />
    </div>
  );
}

export default App;
