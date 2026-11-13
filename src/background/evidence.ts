/**
 * Screenshots for the report: one cropped picture per finding, with the
 * element outlined and the measurement drawn on it (the redline).
 *
 * For each finding the page scrolls to the element and draws it; the service
 * worker photographs the visible tab and crops the picture to the element.
 * Chrome allows two captures a second, so the findings are taken in turn.
 * Nothing leaves the machine: the pictures go into the report file only.
 */
import { sendToTab } from "@shared/messages";
import type { Box, Finding, ScanResult } from "@shared/types";

/** Chrome's limit is 2 captureVisibleTab calls per second. */
const CAPTURE_INTERVAL_MS = 550;
/** A report with more pictures than this gets too large to open and mail. */
export const MAX_SCREENSHOTS = 40;
/** Space kept around the element, in CSS px. */
const PADDING = 16;
/** Largest picture, in CSS px, so a full-width section stays readable. */
const MAX_WIDTH = 900;
const MAX_HEIGHT = 600;

interface Shot {
  /** What to cut out, in viewport coordinates (CSS px). */
  rect: Box;
  devicePixelRatio: number;
  viewport: { width: number; height: number };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function toDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return `data:${blob.type};base64,${btoa(binary)}`;
}

/** Cuts `shot.rect` (plus padding) out of a capture of the whole viewport. */
async function crop(capture: string, shot: Shot): Promise<string> {
  const bitmap = await createImageBitmap(await (await fetch(capture)).blob());
  // The capture may be scaled differently from devicePixelRatio (browser zoom): measure it.
  const scale = bitmap.width / shot.viewport.width;
  const left = Math.max(0, shot.rect.x - PADDING);
  const top = Math.max(0, shot.rect.y - PADDING);
  const width = Math.min(MAX_WIDTH, shot.viewport.width - left, shot.rect.width + PADDING * 2);
  const height = Math.min(MAX_HEIGHT, shot.viewport.height - top, shot.rect.height + PADDING * 2);
  if (width <= 0 || height <= 0) return "";
  const canvas = new OffscreenCanvas(Math.round(width * scale), Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) return "";
  context.drawImage(bitmap, Math.round(left * scale), Math.round(top * scale), canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return toDataUrl(await canvas.convertToBlob({ type: "image/png" }));
}

/** The findings that get a picture: open issues first, most severe first, then the ones for review. */
function inOrder(findings: Finding[]): Finding[] {
  const rank = { High: 0, Medium: 1, Low: 2 } as const;
  return findings
    .filter((f) => f.status === "new")
    .sort((a, b) => Number(a.type === "Review") - Number(b.type === "Review") || rank[a.severity] - rank[b.severity]);
}

/**
 * Returns a copy of the result whose findings carry a screenshot. Findings
 * that could not be photographed (the page changed, the element is gone) are
 * left without one; the report still lists them.
 */
export async function captureEvidence(tabId: number, result: ScanResult, onProgress: (done: number, total: number) => void = () => undefined): Promise<{ result: ScanResult; captured: number; skipped: number }> {
  const tab = await chrome.tabs.get(tabId);
  const targets = inOrder(result.findings).slice(0, MAX_SCREENSHOTS);
  const shots = new Map<string, string>();
  let lastCapture = 0;

  for (const [index, finding] of targets.entries()) {
    onProgress(index, targets.length);
    const prepared = await sendToTab<Shot>(tabId, { type: "CS_PREPARE_SHOT", tabId, findingId: finding.id }, 0);
    if (!prepared.ok || !prepared.data) continue;
    const wait = lastCapture + CAPTURE_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      const capture = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      lastCapture = Date.now();
      const picture = await crop(capture, prepared.data);
      if (picture) shots.set(finding.id, picture);
    } catch {
      // The tab is not the visible one, or the page cannot be captured: go on without this picture.
      lastCapture = Date.now();
    }
  }
  // Remove what was drawn for the pictures.
  await sendToTab(tabId, { type: "CS_FOCUS_FINDING", tabId, findingId: null, peers: false }, 0);
  onProgress(targets.length, targets.length);

  const capturedAt = new Date().toISOString();
  const findings = result.findings.map((f) => (shots.has(f.id) ? { ...f, evidence: { screenshot: shots.get(f.id), capturedAt } } : f));
  return { result: { ...result, findings }, captured: shots.size, skipped: targets.length - shots.size };
}
