import { useEffect } from "react";
import { isMessage, isScanResult, sendToBackground } from "@shared/messages";
import { STORAGE_SETTINGS } from "@shared/constants";
import type { ScanResult, Settings } from "@shared/types";
import { useStore } from "@src/sidepanel/store";

/** Fetch settings from the service worker and store them. */
export async function refreshSettings(): Promise<void> {
  const res = await sendToBackground<Settings>({ type: "GET_SETTINGS" });
  if (res.ok && res.data && typeof res.data === "object") useStore.getState().setSettings(res.data);
}

/** Save a settings change and tell every other extension page about it. */
export async function changeSettings(patch: Partial<Settings>): Promise<void> {
  const next = { ...useStore.getState().settings, ...patch };
  useStore.getState().setSettings(next);
  try {
    await chrome.storage.sync.set({ [STORAGE_SETTINGS]: next });
    chrome.runtime.sendMessage({ type: "SETTINGS_CHANGED" }).catch(() => undefined);
  } catch (e) {
    useStore.getState().showToast({
      kind: "error",
      message: `Could not save the setting: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}

/** Restore the last scan of a tab (kept by the service worker for the browser session). */
async function restoreLastResult(tabId: number): Promise<void> {
  const res = await sendToBackground<ScanResult | undefined>({ type: "GET_LAST_RESULT", tabId });
  const store = useStore.getState();
  // The tab may have changed while we were waiting.
  if (store.tabId !== tabId) return;
  if (res.ok && isScanResult(res.data)) store.setResult(res.data);
}

/** Listens to scan events from the service worker and the content script. */
export function useBackgroundEvents(): void {
  const tabId = useStore((s) => s.tabId);

  useEffect(() => {
    void refreshSettings();
  }, []);

  useEffect(() => {
    if (tabId !== null) void restoreLastResult(tabId);
  }, [tabId]);

  useEffect(() => {
    const onMessage = (raw: unknown): void => {
      if (!isMessage(raw)) return;
      const store = useStore.getState();
      switch (raw.type) {
        case "SCAN_PROGRESS":
          if (raw.tabId === store.tabId && store.scanning) store.setProgress({ percent: raw.percent, stage: raw.stage });
          break;
        case "SCAN_RESULT":
          if (raw.tabId === store.tabId) store.setResult(raw.result);
          break;
        case "SCAN_ERROR":
          if (raw.tabId === store.tabId) {
            store.setScanning(false);
            store.setProgress(null);
          }
          break;
        case "SETTINGS_CHANGED":
          void refreshSettings();
          break;
        default:
          break;
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);
}
