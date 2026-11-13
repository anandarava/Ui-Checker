import { useState } from "react";
import type { ExportFormat } from "@shared/types";
import { sendToBackground } from "@shared/messages";
import { useStore } from "@src/sidepanel/store";
import { Popover } from "./Popover";
import { DownloadIcon } from "./icons";

interface ExportOption {
  id: string;
  format: ExportFormat;
  screenshots?: boolean;
  label: string;
  hint: string;
  /** Icon chip text, and whether it is highlighted. */
  chip: string;
  featured?: boolean;
}

const OPTIONS: ExportOption[] = [
  { id: "html-shots", format: "html", screenshots: true, label: "HTML report with screenshots", hint: "Photographs every issue with its measurement drawn on it. The page scrolls while it runs.", chip: "HTML", featured: true },
  { id: "html", format: "html", label: "HTML report", hint: "Summary and developer details", chip: "HTML" },
  { id: "json", format: "json", label: "JSON", hint: "Raw results for tooling and CI", chip: "JSON" },
];

export interface ReportFile {
  filename: string;
  mime: string;
  content: string;
  /** Screenshots taken, and findings that could not be photographed. */
  captured?: number;
  skipped?: number;
}

/** Saves the file from the panel: the report is built on this machine and goes nowhere else. */
export function download(file: ReportFile): void {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ExportMenu() {
  const tabId = useStore((s) => s.tabId);
  const hasResult = useStore((s) => Boolean(s.result));
  const saved = useStore((s) => s.viewingSaved);
  const showToast = useStore((s) => s.showToast);
  const [busy, setBusy] = useState<string | null>(null);

  const exportAs = async (option: ExportOption) => {
    if (busy || tabId === null) return;
    const { format } = option;
    setBusy(option.id);
    showToast({ kind: "info", message: option.screenshots ? "Capturing screenshots, then building the report… Keep this tab open." : `Building ${format.toUpperCase()} report…` });
    // A saved scan is exported as it was saved: its page may be gone, so no screenshots are taken now.
    const res = saved
      ? await sendToBackground<ReportFile>({ type: "SAVED_SCAN_EXPORT", id: saved.id, format })
      : await sendToBackground<ReportFile>({ type: "EXPORT_REPORT", tabId, format, screenshots: option.screenshots });
    setBusy(null);
    if (!res.ok || !res.data) {
      showToast({ kind: "error", message: `Export failed: ${res.error ?? "unknown error"}`, autoDismiss: false });
      return;
    }
    download(res.data);
    const missed = res.data.skipped ? ` ${res.data.skipped} issue${res.data.skipped === 1 ? "" : "s"} could not be photographed.` : "";
    showToast({ kind: "success", message: `Report exported: ${res.data.filename}.${missed}` });
  };

  return (
    <Popover
      side="top"
      label={
        <>
          <DownloadIcon /> Export
        </>
      }
      ariaLabel="Export report"
      disabled={!hasResult || tabId === null}
      panelClassName="w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border border-slate-300 p-2"
    >
      <p className="px-2 pt-1 pb-1.5 text-[11px] font-semibold tracking-wide text-slate-600 uppercase">Export as</p>
      <ul aria-label="Export formats">
        {OPTIONS.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              onClick={() => void exportAs(f)}
              // aria-disabled (not disabled) so the focused item keeps focus while an export runs; exportAs ignores clicks when busy.
              aria-disabled={busy !== null ? true : undefined}
              className="flex w-full cursor-pointer items-start gap-2.5 rounded-md px-2 py-2 text-left text-sm text-slate-900 hover:bg-slate-50 aria-disabled:cursor-not-allowed aria-disabled:text-slate-500"
            >
              <span aria-hidden="true" className={`flex h-7 w-9 shrink-0 items-center justify-center rounded-md text-[11px] font-bold ${f.featured ? "bg-blue-50 text-blue-800" : "bg-slate-100 text-slate-700"}`}>
                {f.chip}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold">{busy === f.id ? `${f.label}…` : f.label}</span>
                {f.featured && (
                  <span className="my-0.5 inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-800">
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-green-600" />
                    Best for clients
                  </span>
                )}
                <span className="block text-xs text-slate-600">{f.hint}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Popover>
  );
}
