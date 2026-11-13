/**
 * Service worker: opens the side panel, injects the content script, starts
 * scans, keeps the last result of every tab (chrome.storage.session) and the
 * settings (chrome.storage.sync).
 */
import { isMessage, isScanResult, sendToTab, type Message, type Response } from "@shared/messages";
import { STORAGE_RESULT_PREFIX, STORAGE_SETTINGS, STORAGE_STATUS_PREFIX } from "@shared/constants";
import { withFindings } from "@shared/scoring";
import { DEFAULT_SETTINGS, type FindingStatus, type ScanResult, type Settings, type StoredStatus } from "@shared/types";
import { captureEvidence } from "./evidence";
import { buildReport } from "./exporters";
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
// Statuses: ignored, baselined, intentional. Kept per site, keyed by fingerprint,
// so the next scan of the same page keeps the tester's decisions.
// ---------------------------------------------------------------------------

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

const statusKey = (url: string) => `${STORAGE_STATUS_PREFIX}${originOf(url)}`;

async function loadStatuses(url: string): Promise<Record<string, StoredStatus>> {
  try {
    return ((await chrome.storage.local.get(statusKey(url)))[statusKey(url)] as Record<string, StoredStatus> | undefined) ?? {};
  } catch {
    return {};
  }
}

/** Applies the stored decisions to a fresh result and recomputes its score and counts. */
async function applyStatuses(result: ScanResult): Promise<ScanResult> {
  const stored = await loadStatuses(result.url);
  const findings = result.findings.map((f) => {
    const entry = stored[f.fingerprint];
    return entry ? { ...f, status: entry.status, reason: entry.reason } : f;
  });
  return withFindings(result, findings);
}

async function setStatus(tabId: number, fingerprints: string[], status: FindingStatus, reason = ""): Promise<Response<ScanResult>> {
  const result = await loadResult(tabId);
  if (!result) return { ok: false, error: "There is no scan result for this tab. Scan the page again." };
  const wanted = new Set(fingerprints);
  const stored = await loadStatuses(result.url);
  const findings = result.findings.map((f) => {
    if (!wanted.has(f.fingerprint)) return f;
    if (status === "new") {
      delete stored[f.fingerprint];
      const { reason: _reason, ...open } = f;
      return { ...open, status };
    }
    stored[f.fingerprint] = { fingerprint: f.fingerprint, ruleId: f.ruleId, selector: f.element.selector, status, reason, createdAt: new Date().toISOString() };
    return { ...f, status, reason };
  });
  await chrome.storage.local.set({ [statusKey(result.url)]: stored });
  const updated = withFindings(result, findings);
  await saveResult(tabId, updated);
  broadcast({ type: "SCAN_RESULT", tabId, result: updated });
  return { ok: true, data: updated };
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

    const result = await applyStatuses(res.data);
    await saveResult(tabId, result);
    broadcast({ type: "SCAN_RESULT", tabId, result });
    return { ok: true, data: result };
  } catch (e) {
    const error = describeError(e);
    broadcast({ type: "SCAN_ERROR", tabId, error });
    return { ok: false, error };
  } finally {
    scanning.delete(tabId);
  }
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

async function exportReport(msg: Extract<Message, { type: "EXPORT_REPORT" }>): Promise<Response> {
  const stored = await loadResult(msg.tabId);
  if (!stored) return { ok: false, error: "There is no scan result for this tab. Scan the page first." };
  const settings = await getSettings();
  let result = stored;
  let captured = 0;
  let skipped = 0;
  if (msg.screenshots && msg.format === "html") {
    const evidence = await captureEvidence(msg.tabId, stored, (done, total) => {
      broadcast({ type: "SCAN_PROGRESS", tabId: msg.tabId, percent: total === 0 ? 100 : Math.round((100 * done) / total), stage: `Capturing screenshot ${Math.min(done + 1, total)} of ${total}` });
    });
    ({ result, captured, skipped } = evidence);
  }
  const file = buildReport(msg.format, result, { preparedBy: settings.reportPreparedBy, organisation: settings.reportOrganisation });
  return { ok: true, data: { ...file, captured, skipped } };
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
    case "SET_STATUS":
      return setStatus(msg.tabId, msg.fingerprints, msg.status, msg.reason);
    case "EXPORT_REPORT":
      return exportReport(msg);
    case "GET_SETTINGS":
      return { ok: true, data: await getSettings() };
    default:
      // Events (SCAN_PROGRESS, SCAN_RESULT...) are for the UI; the service worker ignores them.
      return { ok: true };
  }
}

/** Messages the service worker answers. Everything else is a broadcast meant for the UI. */
const REQUESTS = new Set<Message["type"]>(["SCAN_START", "GET_LAST_RESULT", "RESET_RESULT", "GET_SETTINGS", "SET_STATUS", "EXPORT_REPORT"]);

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
