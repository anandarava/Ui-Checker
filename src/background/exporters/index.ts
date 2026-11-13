/**
 * Report exporters. Everything here only produces strings, so it runs in the
 * service worker, in unit tests and in CI. The side panel saves the file.
 */
import type { ExportFormat, ScanResult } from "@shared/types";
import { crossPageFindings } from "@shared/cross-page";
import { buildHtmlReport, buildSiteHtmlReport, type ReportMeta } from "./html-report";
import { buildJsonReport, buildJsonReportDocument, toolInfo } from "./json-report";

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

/**
 * One report for several scanned pages (a site scan, or saved scans ticked
 * together): an overview, what differs across the pages, then each page.
 * The pages are compared here, so the report always matches its pages.
 */
export function buildMultiPageReport(format: ExportFormat, results: ScanResult[], meta: ReportMeta = {}): ReportFile {
  if (results.length === 0) throw new Error("No scanned pages to export.");
  const crossPage = crossPageFindings(results);
  const name = `${appName(results[0])}_UI_Consistency_Site_Report`;
  if (format === "json") {
    const document = { tool: toolInfo(), exportedAt: new Date().toISOString(), pageCount: results.length, crossPage, pages: results.map((r) => buildJsonReportDocument(r)) };
    return { filename: `${name}.json`, mime: FORMATS.json.mime, content: JSON.stringify(document, null, 2) + "\n" };
  }
  return { filename: `${name}.html`, mime: FORMATS.html.mime, content: buildSiteHtmlReport(results, crossPage, meta) };
}
