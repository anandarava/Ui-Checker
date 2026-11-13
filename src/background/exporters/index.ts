/**
 * Report exporters. Everything here only produces strings, so it runs in the
 * service worker, in unit tests and in CI. The side panel saves the file.
 */
import type { ExportFormat, ScanResult } from "@shared/types";
import { buildHtmlReport, type ReportMeta } from "./html-report";
import { buildJsonReport } from "./json-report";

export interface ReportFile {
  filename: string;
  mime: string;
  content: string;
}

export { buildHtmlReport, buildJsonReport };
export type { ReportMeta };

const FORMATS: Record<ExportFormat, { ext: string; mime: string; build: (r: ScanResult, meta: ReportMeta) => string }> = {
  html: { ext: "html", mime: "text/html;charset=utf-8", build: (r, meta) => buildHtmlReport(r, meta) },
  json: { ext: "json", mime: "application/json;charset=utf-8", build: (r) => buildJsonReport(r) },
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname || "page";
  } catch {
    return "page";
  }
}

/** The application's name for the filename: the scanned site's host without "www.". */
function appName(result: ScanResult): string {
  const host = hostOf(result.url ?? "").replace(/^www\./i, "");
  return host.replace(/[^a-z0-9.-]+/gi, "_").replace(/^[._-]+|[._-]+$/g, "").slice(0, 60) || "page";
}

/** "<application name>_UI_Consistency_Report.<ext>": safe as a file name on every platform. */
export function reportFilename(format: ExportFormat, result: ScanResult): string {
  return `${appName(result)}_UI_Consistency_Report.${FORMATS[format].ext}`;
}

export function buildReport(format: ExportFormat, result: ScanResult, meta: ReportMeta = {}): ReportFile {
  const spec = FORMATS[format];
  if (!spec) throw new Error(`Unsupported export format: ${String(format)}`);
  return { filename: reportFilename(format, result), mime: spec.mime, content: spec.build(result, meta) };
}
