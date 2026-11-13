/**
 * Message contract between the Side Panel / Options (UI), the Service Worker
 * (SW) and the Content Script (CS). Same shape and transport as the PalTech
 * Accessibility Testing extension:
 *
 *  - UI -> SW: chrome.runtime.sendMessage(msg)
 *  - SW -> CS: chrome.tabs.sendMessage(tabId, msg)
 *  - CS -> SW / UI: chrome.runtime.sendMessage(msg)   (broadcast; UI filters by tabId)
 *
 * Every message carries `type` and, where relevant, `tabId` so the side panel
 * (one per window) can ignore events from other tabs.
 */
import type { SiteScanOptions, SiteScanState } from "./site-crawl";
import type { ExportFormat, FindingStatus, PageChangeReason, ScaleKind, ScanOptions, ScanResult } from "./types";

export type Message =
  // ---- Scanning ----
  | { type: "SCAN_START"; tabId: number; options: ScanOptions }
  | { type: "SCAN_PROGRESS"; tabId: number; percent: number; stage: string }
  | { type: "SCAN_RESULT"; tabId: number; result: ScanResult }
  | { type: "SCAN_ERROR"; tabId: number; error: string }
  // ---- Content-script internals (SW -> CS) ----
  | { type: "CS_PING" }
  /** Run the scan in this frame and answer with a ScanResult. */
  | { type: "CS_SCAN"; tabId: number; options: ScanOptions }
  /** Outline peer groups of the last scan on the page: null = all, [] = none. Answers with the number of boxes drawn. */
  | { type: "CS_SHOW_GROUPS"; tabId: number; groupIds: string[] | null }
  /** Outline every element that uses a value of the design scale and scroll to the first; kind null removes the outlines. Answers with the number of boxes drawn. */
  | { type: "CS_SHOW_USES"; tabId: number; kind: ScaleKind | null; value: string }
  /** Draw numbered badges on the elements of these findings of the last scan: null = all, [] = none. */
  | { type: "CS_SHOW_BADGES"; tabId: number; findingIds: string[] | null }
  /** Scroll to a finding and draw its element, its peers and what was measured; null removes it. */
  | { type: "CS_FOCUS_FINDING"; tabId: number; findingId: string | null; peers: boolean }
  /** CS -> UI: a badge on the page was clicked. */
  | { type: "FINDING_CLICKED"; tabId: number; findingId: string }
  /** UI -> SW: build a report of the last scan. Answers with the file (name, type, content); the panel saves it. */
  | { type: "EXPORT_REPORT"; tabId: number; format: ExportFormat; screenshots?: boolean }
  /** SW -> CS: scroll to a finding and draw it for a screenshot. Answers with what to cut out of the capture. */
  | { type: "CS_PREPARE_SHOT"; tabId: number; findingId: string }
  /** UI -> SW: ignore, baseline, mark intentional or reopen findings. Answers with the updated ScanResult. */
  | { type: "SET_STATUS"; tabId: number; fingerprints: string[]; status: FindingStatus; reason?: string }
  /** Start (or cancel) the element picker of "Part of page". */
  | { type: "CS_PICK_START"; tabId: number }
  | { type: "CS_PICK_CANCEL"; tabId: number }
  /** CS -> UI: an element was picked (selector), or picking was cancelled (null). */
  | { type: "PICKED"; tabId: number; selector: string | null }
  /** Forget the scan result and remove everything the extension drew on the page (panel "Reset"). */
  | { type: "CS_RESET"; tabId: number }
  /** CS -> UI: the page changed since the scan (a single-page app went to another route, a dialog opened). */
  | { type: "PAGE_CHANGED"; tabId: number; reason: PageChangeReason }
  // ---- Saved scans (UI -> SW) ----
  /** Answers with SavedScanMeta[], newest first. */
  | { type: "SAVED_SCANS_LIST" }
  /** Save the last result of the tab under a name; with screenshots the open issues are photographed first. Answers with SavedScanMeta. */
  | { type: "SAVED_SCAN_SAVE"; tabId: number; name: string; screenshots?: boolean }
  /** Answers with SavedScan (metadata and the full result). */
  | { type: "SAVED_SCAN_GET"; id: string }
  | { type: "SAVED_SCAN_RENAME"; id: string; name: string }
  | { type: "SAVED_SCAN_DELETE"; id: string }
  /** Build a report of a saved scan. Answers with the file; the panel saves it. */
  | { type: "SAVED_SCAN_EXPORT"; id: string; format: ExportFormat }
  /** Build one report for several saved scans (an overview, what differs across them, then each page). Answers with the file. */
  | { type: "SAVED_SCANS_EXPORT"; ids: string[]; format: ExportFormat }
  // ---- Site scan (one at a time; the SW owns the state and broadcasts SITE_SCAN_STATE on every change) ----
  | { type: "SITE_SCAN_GET" }
  /** Find the pages of the site that `url` belongs to; ends in the "review" phase. */
  | { type: "SITE_SCAN_DISCOVER"; url: string; options: SiteScanOptions }
  /** Tick / untick listed pages and add addresses by hand (review phase, or between runs). */
  | { type: "SITE_SCAN_SET_PAGES"; include?: Record<string, boolean>; add?: string[] }
  /** Scan the ticked pages that are still pending (also resumes a paused run). */
  | { type: "SITE_SCAN_START" }
  /** Scan pages already scanned (or failed) again: the given indexes, or all of them. */
  | { type: "SITE_SCAN_RESCAN"; indexes?: number[] }
  | { type: "SITE_SCAN_PAUSE" }
  | { type: "SITE_SCAN_STOP" }
  /** The full result of one scanned page (index into `pages`). */
  | { type: "SITE_SCAN_RESULT"; index: number }
  /** One report for every scanned page. Answers with the file; the panel saves it. */
  | { type: "SITE_SCAN_EXPORT"; format: ExportFormat }
  | { type: "SITE_SCAN_CLEAR" }
  | { type: "SITE_SCAN_STATE"; state: SiteScanState | null }
  // ---- State queries ----
  | { type: "GET_LAST_RESULT"; tabId: number }
  | { type: "RESET_RESULT"; tabId: number }
  | { type: "GET_SETTINGS" }
  | { type: "SETTINGS_CHANGED" };

export type MessageType = Message["type"];

/** Extract a message by its `type` literal. */
export type MessageOf<T extends MessageType> = Extract<Message, { type: T }>;

/** Generic response envelope used for request/response style messages. */
export interface Response<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export function isMessage(value: unknown): value is Message {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

/** Promise wrapper around chrome.runtime.sendMessage. */
export function sendToBackground<T = unknown>(msg: Message): Promise<Response<T>> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (response: Response<T> | undefined) => {
        const err = chrome.runtime.lastError;
        if (err) resolve({ ok: false, error: err.message });
        else resolve(response ?? { ok: true });
      });
    } catch (e) {
      resolve({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}

/** Promise wrapper around chrome.tabs.sendMessage. */
export function sendToTab<T = unknown>(tabId: number, msg: Message, frameId?: number): Promise<Response<T>> {
  return new Promise((resolve) => {
    try {
      const options = frameId === undefined ? undefined : { frameId };
      chrome.tabs.sendMessage(tabId, msg, options as chrome.tabs.MessageSendOptions, (response: Response<T> | undefined) => {
        const err = chrome.runtime.lastError;
        if (err) resolve({ ok: false, error: err.message });
        else resolve(response ?? { ok: true });
      });
    } catch (e) {
      resolve({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}

export function isScanResult(value: unknown): value is ScanResult {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { findings?: unknown }).findings) &&
    typeof (value as { scanId?: unknown }).scanId === "string"
  );
}
