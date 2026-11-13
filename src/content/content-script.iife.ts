/**
 * Content script, injected by the service worker with
 * `chrome.scripting.executeScript({ files })`. It is idempotent: a second
 * injection into the same frame does nothing.
 */
import { isMessage, type Message, type Response } from "@shared/messages";
import { LOADED_FLAG } from "@shared/constants";
import { clearOverlay, focusFinding, scrollToElement, showBadges, showGroups } from "./overlay/overlay-root";
import { forgetGroups, overlayFinding, overlayFindings, overlayGroups, runScan } from "./scanner";

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

    case "CS_SHOW_BADGES": {
      const { tabId } = msg;
      const findings = overlayFindings(msg.findingIds);
      const drawn = showBadges(findings, (findingId) => {
        chrome.runtime.sendMessage({ type: "FINDING_CLICKED", tabId, findingId } satisfies Message).catch(() => undefined);
      });
      sendResponse({ ok: true, data: drawn });
      return false;
    }

    case "CS_FOCUS_FINDING": {
      const finding = msg.findingId === null ? null : (overlayFinding(msg.findingId) ?? null);
      if (msg.findingId !== null && !finding) {
        // The page was reloaded since the scan.
        focusFinding(null, false);
        sendResponse({ ok: false, error: "This finding belongs to a scan of an earlier version of the page." });
        return false;
      }
      if (finding) scrollToElement(finding.node);
      focusFinding(finding, msg.peers);
      sendResponse({ ok: true });
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
