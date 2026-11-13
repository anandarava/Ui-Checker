import { useCallback } from "react";
import { isScanResult, sendToBackground } from "@shared/messages";
import { useStore } from "@src/sidepanel/store";
import { Button } from "./Button";
import { PlayIcon, RefreshIcon } from "./icons";

/** Starts a full-page scan for the current tab. Exposed so other components can reuse it. */
export function useStartScan(): () => Promise<void> {
  return useCallback(async () => {
    const store = useStore.getState();
    const { tabId, settings, scanning, scope } = store;
    if (tabId === null || scanning) return;
    store.setScanning(true);
    store.setProgress({ percent: 0, stage: "Starting scan" });
    const res = await sendToBackground<unknown>({
      type: "SCAN_START",
      tabId,
      options: scope.kind === "selector" && scope.selector ? { scope: "selector", selector: scope.selector, tolerancePreset: settings.tolerancePreset, rules: [] } : { scope: "page", tolerancePreset: settings.tolerancePreset, rules: [] },
    });
    const after = useStore.getState();
    if (after.tabId !== tabId) return;
    if (!res.ok) {
      after.setScanning(false);
      after.setProgress(null);
      after.showToast({ kind: "error", message: `Scan failed: ${res.error ?? "unknown error"}`, autoDismiss: false });
      return;
    }
    // The service worker answers with the finished result and also broadcasts SCAN_RESULT; accept either.
    if (isScanResult(res.data)) after.setResult(res.data);
  }, []);
}

export function ScanButton({ icon = "play", className = "flex-1 basis-[5.5rem] whitespace-normal leading-tight" }: { icon?: "play" | "refresh"; className?: string }) {
  const tabId = useStore((s) => s.tabId);
  const scanning = useStore((s) => s.scanning);
  const hasResult = useStore((s) => Boolean(s.result));
  const start = useStartScan();
  const part = useStore((s) => s.scope.kind === "selector" && Boolean(s.scope.selector));
  const label = scanning ? "Scanning…" : part ? (hasResult ? "Rescan part" : "Scan part") : hasResult ? "Rescan page" : "Scan page";
  return (
    <Button variant="primary" size="action" onClick={() => void start()} disabled={tabId === null || scanning} className={className}>
      {icon === "play" ? <PlayIcon size={11} /> : <RefreshIcon size={14} />}
      {label}
    </Button>
  );
}

export function ScanProgressBar() {
  const progress = useStore((s) => s.progress);
  const scanning = useStore((s) => s.scanning);
  if (!scanning) return null;
  const percent = progress?.percent ?? 0;
  const stage = progress?.stage ?? "Preparing";
  return (
    <div className="px-3 py-2">
      <div
        role="progressbar"
        aria-label="Scan progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}% – ${stage}`}
        className="h-2 w-full overflow-hidden rounded bg-slate-200"
      >
        <div className="h-full bg-blue-600 transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-700" aria-live="polite">
        {percent}% – {stage}
      </p>
    </div>
  );
}
