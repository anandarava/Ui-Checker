/**
 * Service worker: opens the side panel, injects the content script, starts
 * scans, keeps the last result of every tab (chrome.storage.session) and the
 * settings (chrome.storage.sync).
 */
import { isMessage, isScanResult, sendToTab, type Message, type Response } from "@shared/messages";
import { STORAGE_RESULT_PREFIX, STORAGE_SETTINGS } from "@shared/constants";
import { DEFAULT_SETTINGS, type ScanResult, type Settings } from "@shared/types";
import { ensureContentScript } from "./injector";

const resultKey = (tabId: number) => `${STORAGE_RESULT_PREFIX}${tabId}`;

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Send to every extension page (side panel, options). Nobody listening is not an error. */
function broadcast(msg: Message): void {
  chrome.runtime.sendMessage(msg).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function getSettings(): Promise<Settings> {
  try {
    const stored = (await chrome.storage.sync.get(STORAGE_SETTINGS))[STORAGE_SETTINGS] as Partial<Settings> | undefined;
    return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

async function saveResult(tabId: number, result: ScanResult): Promise<void> {
  await chrome.storage.session.set({ [resultKey(tabId)]: result });
}

async function loadResult(tabId: number): Promise<ScanResult | undefined> {
  const stored = (await chrome.storage.session.get(resultKey(tabId)))[resultKey(tabId)];
  return isScanResult(stored) ? stored : undefined;
}

async function clearResult(tabId: number): Promise<void> {
  await chrome.storage.session.remove(resultKey(tabId));
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

const scanning = new Set<number>();

async function startScan(msg: Extract<Message, { type: "SCAN_START" }>): Promise<Response<ScanResult>> {
  const { tabId } = msg;
  if (scanning.has(tabId)) return { ok: false, error: "A scan is already running for this tab." };
  scanning.add(tabId);
  try {
    broadcast({ type: "SCAN_PROGRESS", tabId, percent: 5, stage: "Preparing the page" });
    await ensureContentScript(tabId);

    const settings = await getSettings();
    const options = {
      ...msg.options,
      disabledRules: msg.options.disabledRules ?? settings.disabledRules,
      minGroupSize: msg.options.minGroupSize ?? settings.minGroupSize,
    };

    const res = await sendToTab<ScanResult>(tabId, { type: "CS_SCAN", tabId, options }, 0);
    if (!res.ok || !isScanResult(res.data)) {
      const error = res.error ?? "The page did not return a scan result.";
      broadcast({ type: "SCAN_ERROR", tabId, error });
      return { ok: false, error };
    }

    await saveResult(tabId, res.data);
    broadcast({ type: "SCAN_RESULT", tabId, result: res.data });
    return { ok: true, data: res.data };
  } catch (e) {
    const error = describeError(e);
    broadcast({ type: "SCAN_ERROR", tabId, error });
    return { ok: false, error };
  } finally {
    scanning.delete(tabId);
  }
}

// ---------------------------------------------------------------------------
// Message routing
// ---------------------------------------------------------------------------

async function handle(msg: Message): Promise<Response> {
  switch (msg.type) {
    case "SCAN_START":
      return startScan(msg);
    case "GET_LAST_RESULT":
      return { ok: true, data: await loadResult(msg.tabId) };
    case "RESET_RESULT":
      await clearResult(msg.tabId);
      await sendToTab(msg.tabId, { type: "CS_RESET", tabId: msg.tabId }, 0);
      return { ok: true };
    case "GET_SETTINGS":
      return { ok: true, data: await getSettings() };
    default:
      // Events (SCAN_PROGRESS, SCAN_RESULT...) are for the UI; the service worker ignores them.
      return { ok: true };
  }
}

/** Messages the service worker answers. Everything else is a broadcast meant for the UI. */
const REQUESTS = new Set<Message["type"]>(["SCAN_START", "GET_LAST_RESULT", "RESET_RESULT", "GET_SETTINGS"]);

chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse: (r: Response) => void) => {
  if (!isMessage(raw) || !REQUESTS.has(raw.type)) return false;
  handle(raw).then(sendResponse, (e) => sendResponse({ ok: false, error: describeError(e) }));
  return true; // answered asynchronously
});

// A result belongs to the page that was scanned: drop it when the tab closes or loads another page.
chrome.tabs.onRemoved.addListener((tabId) => {
  void clearResult(tabId);
});
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "loading" && info.url) void clearResult(tabId);
});

// Clicking the toolbar icon opens the side panel.
function openPanelOnActionClick(): void {
  const sidePanel = (chrome as unknown as { sidePanel?: typeof chrome.sidePanel }).sidePanel;
  if (!sidePanel || typeof sidePanel.setPanelBehavior !== "function") return;
  void sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((e: unknown) => {
    console.warn(`[ui-check] could not set the side panel behaviour: ${describeError(e)}`);
  });
}
chrome.runtime.onInstalled.addListener(openPanelOnActionClick);
chrome.runtime.onStartup.addListener(openPanelOnActionClick);
openPanelOnActionClick();
