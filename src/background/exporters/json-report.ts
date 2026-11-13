/**
 * JSON export: a pretty-printed ScanResult with top-level `tool` and
 * `exportedAt` metadata. Screenshots (which can be several MB of base64)
 * are stripped unless the whole set is small, so the file stays portable
 * and diff-friendly for CI comparison.
 *
 * Same shape as the PalTech Accessibility Testing extension's JSON export.
 */
import type { Finding, ScanResult } from "@shared/types";

/** Total base64 payload (bytes, approximated by string length) allowed before screenshots are dropped. */
export const JSON_SCREENSHOT_BUDGET_BYTES = 200 * 1024;

export interface ToolInfo {
  name: string;
  version: string;
}

/** Name/version of the extension, safe to call outside an extension context (unit tests). */
export function toolInfo(): ToolInfo {
  try {
    if (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.getManifest === "function") {
      const m = chrome.runtime.getManifest();
      if (m && typeof m.name === "string" && typeof m.version === "string") {
        // version_name carries a pre-release label that version cannot.
        return { name: m.name, version: typeof m.version_name === "string" ? m.version_name : m.version };
      }
    }
  } catch {
    // Not running inside the extension; fall through to the static default.
  }
  return { name: "PalTech UI Consistency Checker", version: "0.1.0" };
}

export interface JsonReportDocument extends ScanResult {
  tool: ToolInfo;
  exportedAt: string;
  /** True when embedded screenshots were removed to keep the file small. */
  screenshotsStripped: boolean;
  /** Number of screenshots removed (0 when none were stripped). */
  screenshotsOmitted: number;
}

function screenshotBytes(result: ScanResult): number {
  let total = 0;
  for (const f of result.findings ?? []) {
    const s = f.evidence?.screenshot;
    if (typeof s === "string") total += s.length;
  }
  return total;
}

function stripFinding(f: Finding): Finding {
  if (!f.evidence || f.evidence.screenshot === undefined) return f;
  const { evidence: _dropped, ...rest } = f;
  return rest;
}

/** Build the export document without mutating the input result. */
export function buildJsonReportDocument(result: ScanResult, now: Date = new Date()): JsonReportDocument {
  const findings = result.findings ?? [];
  const strip = screenshotBytes(result) > JSON_SCREENSHOT_BUDGET_BYTES;

  let omitted = 0;
  const outFindings = strip
    ? findings.map((f) => {
        if (typeof f.evidence?.screenshot === "string") omitted++;
        return stripFinding(f);
      })
    : findings;

  return {
    tool: toolInfo(),
    exportedAt: now.toISOString(),
    screenshotsStripped: strip,
    screenshotsOmitted: omitted,
    ...result,
    findings: outFindings,
  };
}

export function buildJsonReport(result: ScanResult): string {
  return JSON.stringify(buildJsonReportDocument(result), null, 2) + "\n";
}
