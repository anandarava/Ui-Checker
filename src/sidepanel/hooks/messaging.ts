/**
 * Messages from the panel to the page (content script) and to the service
 * worker that several components send.
 */
import { isScanResult, sendToBackground, sendToTab, type Response } from "@shared/messages";
import type { Finding, FindingStatus, ScanResult } from "@shared/types";
import { useStore } from "@src/sidepanel/store";

/** Scrolls to a finding and draws its element, its peers and what was measured. */
export function locateIssue(tabId: number, finding: Finding, peers = true): Promise<Response> {
  return sendToTab(tabId, { type: "CS_FOCUS_FINDING", tabId, findingId: finding.id, peers }, 0);
}

/** Removes the outline of the finding that was open. */
export function clearLocatedIssue(tabId: number): Promise<Response> {
  return sendToTab(tabId, { type: "CS_FOCUS_FINDING", tabId, findingId: null, peers: false }, 0);
}

/** Draws (or removes) the numbered badges for the open findings of the result. */
export async function drawBadges(tabId: number, result: ScanResult | null, on: boolean): Promise<Response> {
  const findingIds = on && result ? result.findings.filter((f) => f.status === "new").map((f) => f.id) : [];
  return sendToTab(tabId, { type: "CS_SHOW_BADGES", tabId, findingIds }, 0);
}

const DONE: Record<FindingStatus, string> = {
  ignored: "Finding ignored for this site.",
  baselined: "Finding added to the baseline of this site.",
  intentional: "Finding marked as intentional for this site.",
  new: "Finding reopened.",
};

/** Ignores, baselines, marks intentional or reopens findings, and shows the outcome. */
export async function setStatus(findings: Finding[], status: FindingStatus, reason?: string): Promise<boolean> {
  const store = useStore.getState();
  if (store.tabId === null) return false;
  const res = await sendToBackground<ScanResult>({ type: "SET_STATUS", tabId: store.tabId, fingerprints: findings.map((f) => f.fingerprint), status, reason });
  if (!res.ok || !isScanResult(res.data)) {
    store.showToast({ kind: "error", message: `Could not update the finding: ${res.error ?? "unknown error"}`, autoDismiss: false });
    return false;
  }
  store.setResult(res.data);
  store.showToast({ kind: "success", message: findings.length === 1 ? DONE[status] : `${findings.length} findings updated.` });
  return true;
}
