/**
 * Programmatic injection of the content script. The script is idempotent, so
 * re-injecting is harmless, but we avoid it by probing first.
 *
 * Phase 0 scans the top frame only. Same-origin iframes are read from the top
 * frame by the snapshot engine (Phase 1); cross-origin frames are reported as
 * "not scanned".
 */
import csFile from "@src/content/content-script.iife.ts?script";
import { sendToTab } from "@shared/messages";
import { LOADED_FLAG } from "@shared/constants";

const PING_TIMEOUT_MS = 1500;

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(fallback);
      },
    );
  });
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Returns true when the top frame answers CS_PING. */
export async function pingContentScript(tabId: number): Promise<boolean> {
  const res = await withTimeout(sendToTab(tabId, { type: "CS_PING" }, 0), PING_TIMEOUT_MS, { ok: false });
  return res.ok;
}

/**
 * Pings the content script; if there is no answer, injects it into the top
 * frame. Rejects when the tab cannot be scripted at all (chrome://, the Web
 * Store, the PDF viewer, missing host permission...).
 */
export async function ensureContentScript(tabId: number): Promise<void> {
  if (await pingContentScript(tabId)) return;

  let loaded: boolean;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (flag: string) => Boolean((window as unknown as Record<string, unknown>)[flag]),
      args: [LOADED_FLAG],
    });
    loaded = results?.[0]?.result === true;
  } catch (e) {
    throw new Error(
      `Cannot access this page (${describeError(e)}). Chrome internal pages, the Web Store and pages without host permission cannot be scanned.`,
    );
  }

  if (!loaded) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: [csFile] });
    } catch (e) {
      throw new Error(`Content script injection failed: ${describeError(e)}`);
    }
  }

  if (!(await pingContentScript(tabId))) {
    throw new Error("The content script did not respond after injection. Reload the page and try again.");
  }
}
