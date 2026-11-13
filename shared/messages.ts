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
import type { ExportFormat, FindingStatus, ScanOptions, ScanResult } from "./types";

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
  /** Forget the scan result and remove everything the extension drew on the page (panel "Reset"). */
  | { type: "CS_RESET"; tabId: number }
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
