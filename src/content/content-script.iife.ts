/**
 * Content script, injected by the service worker with
 * `chrome.scripting.executeScript({ files })`. It is idempotent: a second
 * injection into the same frame does nothing.
 */
import { isMessage, type Message, type Response } from "@shared/messages";
import { LOADED_FLAG } from "@shared/constants";
import { clearOverlay, focusFinding, scrollToElement, showBadges, showGroups } from "./overlay/overlay-root";
import { startSpaObserver } from "./observers/spa-observer";
import { cancelPicker, startPicker } from "./picker";
import { forgetGroups, overlayFinding, overlayFindings, overlayGroups, overlayUses, runScan } from "./scanner";

type Flagged = Window & { [LOADED_FLAG]?: boolean };

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Stops watching the page for changes; set while a scan result is on screen. */
let stopWatching: (() => void) | null = null;

/**
 * After a scan, tells the panel when the page is no longer the page that was
 * scanned: a single-page app went to another route, a dialog opened, or much
 * of the content changed.
 */
function watchPage(tabId: number): void {
  stopWatching?.();
  stopWatching = startSpaObserver((reason) => {
    chrome.runtime.sendMessage({ type: "PAGE_CHANGED", tabId, reason } satisfies Message).catch(() => undefined);
  });
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
      stopWatching?.();
      stopWatching = null;
      runScan(options, progress).then(
        (result) => {
          watchPage(tabId);
          sendResponse({ ok: true, data: result });
        },
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

    case "CS_SHOW_USES": {
      if (msg.kind === null) {
        sendResponse({ ok: true, data: showGroups([]) });
        return false;
      }
      const uses = overlayUses(msg.kind, msg.value);
      const first = uses?.nodes.find((node) => node.isConnected);
      if (!uses || !first) {
        showGroups([]);
        sendResponse({ ok: false, error: "No scan of this page to show." });
        return false;
      }
      scrollToElement(first);
      sendResponse({ ok: true, data: showGroups([uses]) });
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

    case "CS_PREPARE_SHOT": {
      const finding = overlayFinding(msg.findingId);
      if (!finding || !finding.node.isConnected) {
        sendResponse({ ok: false, error: "The element is no longer on the page." });
        return false;
      }
      finding.node.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
      focusFinding(finding, false);
      // Two frames: one for the scroll, one for the overlay to be painted.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const rect = finding.node.getBoundingClientRect();
          let left = rect.left;
          let top = rect.top;
          let right = rect.right;
          let bottom = rect.bottom;
          // The measurement may reach outside the element (a gap, an offset).
          for (const mark of finding.marks) {
            left = Math.min(left, mark.box.x - window.scrollX);
            top = Math.min(top, mark.box.y - window.scrollY);
            right = Math.max(right, mark.box.x + mark.box.width - window.scrollX);
            bottom = Math.max(bottom, mark.box.y + mark.box.height - window.scrollY);
          }
          sendResponse({
            ok: true,
            data: { rect: { x: left, y: top, width: right - left, height: bottom - top }, devicePixelRatio: window.devicePixelRatio, viewport: { width: window.innerWidth, height: window.innerHeight } },
          });
        }),
      );
      return true; // answered asynchronously
    }

    case "CS_PICK_START": {
      const { tabId } = msg;
      startPicker((picked) => {
        chrome.runtime.sendMessage({ type: "PICKED", tabId, selector: picked.selector } satisfies Message).catch(() => undefined);
      });
      sendResponse({ ok: true });
      return false;
    }

    case "CS_PICK_CANCEL":
      cancelPicker();
      sendResponse({ ok: true });
      return false;

    case "CS_RESET":
      stopWatching?.();
      stopWatching = null;
      cancelPicker();
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
