import { useEffect } from "react";
import { useStore } from "@src/sidepanel/store";

/**
 * Resolves the tab the panel is attached to and follows tab activation.
 * When `tabIdOverride` is given (DevTools) the override is used as-is.
 */
export function useActiveTab(tabIdOverride?: number): void {
  const setTabId = useStore((s) => s.setTabId);

  useEffect(() => {
    if (tabIdOverride !== undefined) {
      setTabId(tabIdOverride);
      return;
    }

    let disposed = false;
    let windowId: number | undefined;

    const resolveWindow = async (): Promise<number | undefined> => {
      try {
        const win = await chrome.windows.getCurrent();
        return win.id;
      } catch {
        return undefined;
      }
    };

    const query = async (): Promise<void> => {
      try {
        if (windowId === undefined) windowId = await resolveWindow();
        const tabs = await chrome.tabs.query(
          windowId === undefined ? { active: true, lastFocusedWindow: true } : { active: true, windowId },
        );
        const tab = tabs[0];
        if (!disposed && tab && typeof tab.id === "number") {
          windowId = tab.windowId;
          setTabId(tab.id);
        }
      } catch {
        // No tab access (e.g. chrome:// pages); leave tabId unset.
      }
    };

    const onActivated = (info: chrome.tabs.OnActivatedInfo): void => {
      if (windowId !== undefined && info.windowId !== windowId) return;
      setTabId(info.tabId);
    };
    const onRemoved = (removedTabId: number): void => {
      if (useStore.getState().tabId === removedTabId) void query();
    };

    void query();
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    return () => {
      disposed = true;
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    };
  }, [tabIdOverride, setTabId]);
}
