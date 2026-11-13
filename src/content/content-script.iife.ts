/**
 * Content script, injected by the service worker with
 * `chrome.scripting.executeScript({ files })`. It is idempotent: a second
 * injection into the same frame does nothing.
 */
import { isMessage, type Message, type Response } from "@shared/messages";
import { LOADED_FLAG } from "@shared/constants";
import { clearOverlay, showGroups } from "./overlay/overlay-root";
import { forgetGroups, overlayGroups, runScan } from "./scanner";

type Flagged = Window & { [LOADED_FLAG]?: boolean };

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function onMessage(raw: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (r: Response) => void): boolean {
  if (!isMessage(raw)) return false;
  const msg: Message = raw;

  switch (msg.type) {
    case "CS_PING":
      sendResponse({ ok: true });
      return false;

    case "CS_SCAN": {
      const { tabId, options } = msg;
      const progress = (percent: number, stage: string): void => {
        chrome.runtime.sendMessage({ type: "SCAN_PROGRESS", tabId, percent, stage } satisfies Message).catch(() => undefined);
      };
      // What the last scan drew belongs to elements that may be gone.
      clearOverlay();
      runScan(options, progress).then(
        (result) => sendResponse({ ok: true, data: result }),
        (e) => sendResponse({ ok: false, error: describeError(e) }),
      );
      return true; // answered asynchronously
    }

    case "CS_SHOW_GROUPS": {
      const groups = overlayGroups(msg.groupIds);
      if (groups.length === 0) {
        clearOverlay();
        // Asked for groups this page no longer has: the page was reloaded since the scan.
        const missing = msg.groupIds === null || msg.groupIds.length > 0;
        sendResponse(missing ? { ok: false, error: "No scan of this page to show." } : { ok: true, data: 0 });
      } else {
        sendResponse({ ok: true, data: showGroups(groups) });
      }
      return false;
    }

    case "CS_RESET":
      clearOverlay();
      forgetGroups();
      sendResponse({ ok: true });
      return false;

    default:
      return false;
  }
}

const flagged = window as Flagged;
if (!flagged[LOADED_FLAG]) {
  flagged[LOADED_FLAG] = true;
  chrome.runtime.onMessage.addListener(onMessage);
}
