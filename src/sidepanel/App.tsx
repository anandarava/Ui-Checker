import { useCallback, useId } from "react";
import { sendToBackground } from "@shared/messages";
import { useStore } from "./store";
import { useActiveTab } from "./hooks/useActiveTab";
import { changeSettings, useBackgroundEvents } from "./hooks/useBackgroundEvents";
import { Button } from "./components/Button";
import { ScanButton, ScanProgressBar } from "./components/ScanButton";
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
import { ResetIcon, SettingsIcon } from "./components/icons";

interface AppProps {
  /** Binds the panel to a fixed tab (tests, demos, DevTools); the side panel resolves the active tab itself. */
  tabIdOverride?: number;
  /** DevTools only: selector of the element selected in the Elements panel ($0). */
  getInspectedSelector?(): Promise<string | null>;
}

/**
 * Side panel. Layout follows the PalTech Accessibility Testing extension:
 * header with the scan settings, action row, progress bar, the summary with
 * the result tabs, filters and issue list (or one issue), and the toast.
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
  const landing = !result;

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
          <Button onClick={() => void reset()} disabled={scanning} size="action" className="flex-1 basis-[5.5rem] whitespace-normal leading-tight">
            <ResetIcon /> Reset
          </Button>
          <Button onClick={() => void chrome.runtime.openOptionsPage()} size="action" className="flex-1 basis-[5.5rem] whitespace-normal leading-tight">
            <SettingsIcon /> Rules
          </Button>
        </nav>
      )}

      <ScanProgressBar />

      <main className="flex min-h-0 flex-1 flex-col">
        {landing && <LandingView />}
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
          <span className="flex-1" />
          <ExportMenu />
        </footer>
      )}

      <Toast />
    </div>
  );
}

export default App;
