import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from "react";
import type { ExportFormat, SavedScanMeta, ScanResult } from "@shared/types";
import { isMessage, sendToBackground } from "@shared/messages";
import { DEFAULT_SITE_SCAN_OPTIONS, defaultWithin, type SitePage, type SiteScanOptions, type SiteScanState } from "@shared/site-crawl";
import { useStore } from "@src/sidepanel/store";
import { useFocusHeading } from "@src/sidepanel/hooks/useFocusHeading";
import { BackButton } from "./BackButton";
import { Button } from "./Button";
import { GlobeIcon } from "./icons";
import { download, type ReportFile } from "./ExportMenu";
import { SeverityLabel } from "./SeverityLabel";
import type { CrossPageFinding } from "@shared/cross-page";

/** The site scan the service worker holds, kept current from SITE_SCAN_STATE broadcasts. */
function useSiteScanState(): [SiteScanState | null | undefined, (s: SiteScanState | null) => void] {
  const [state, setState] = useState<SiteScanState | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void sendToBackground<SiteScanState | null>({ type: "SITE_SCAN_GET" }).then((res) => {
      if (alive) setState(res.ok ? (res.data ?? null) : null);
    });
    const onMessage = (msg: unknown) => {
      if (isMessage(msg) && msg.type === "SITE_SCAN_STATE") setState(msg.state);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => {
      alive = false;
      chrome.runtime.onMessage.removeListener(onMessage);
    };
  }, []);
  return [state, setState];
}

function pathOf(url: string, origin: string): string {
  return url.startsWith(origin) ? url.slice(origin.length) || "/" : url;
}

const inputClass = "w-full rounded-md border border-slate-500 bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-500";

function NumberField({ id, label, hint, value, min, max, onChange }: { id: string; label: string; hint?: string; value: number; min: number; max: number; onChange(v: number): void }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-semibold text-slate-800">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || 0)))}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={inputClass}
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-0.5 text-[11px] text-slate-700">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Step 1: the address and how far to look. */
function SetupForm({ onStart, busy }: { onStart(url: string, options: SiteScanOptions): void; busy: boolean }) {
  const id = useId();
  const tabId = useStore((s) => s.tabId);
  const [url, setUrl] = useState("");
  const [options, setOptions] = useState<SiteScanOptions>(DEFAULT_SITE_SCAN_OPTIONS);
  const [exclude, setExclude] = useState(DEFAULT_SITE_SCAN_OPTIONS.exclude.join(", "));
  const [within, setWithin] = useState("");
  /** The tester edited "Only pages under"; stop deriving it from the address. */
  const [withinEdited, setWithinEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changeUrl = (value: string) => {
    setUrl(value);
    if (!withinEdited) setWithin(defaultWithin(value.trim()));
  };

  // Start from the page the panel is showing (an application often lives in a folder: /hrms/...).
  useEffect(() => {
    if (tabId === null) return;
    void chrome.tabs.get(tabId).then(
      (t) => {
        if (!t.url || !/^https?:/i.test(t.url)) return;
        const u = new URL(t.url);
        u.hash = "";
        const address = u.toString();
        setUrl((prev) => prev || address);
        setWithin((prev) => prev || defaultWithin(address));
      },
      () => undefined,
    );
  }, [tabId]);

  const set = (patch: Partial<SiteScanOptions>) => setOptions((o) => ({ ...o, ...patch }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    let parsed: URL;
    try {
      parsed = new URL(url.trim());
      if (!/^https?:$/.test(parsed.protocol)) throw new Error();
    } catch {
      setError("Enter the application's address, starting with https:// or http://.");
      return;
    }
    setError(null);
    const folder = within.trim().replace(/^\/+|\/+$/g, "");
    onStart(parsed.toString(), {
      ...options,
      exclude: exclude.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
      within: folder ? `/${folder}/` : "",
    });
  };

  const checkbox = (label: string, checked: boolean, onChange: (v: boolean) => void, hint?: string) => (
    <label className="flex items-start gap-2 text-sm text-slate-800">
      <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <span className="block text-xs text-slate-700">{hint}</span>}
      </span>
    </label>
  );

  return (
    <form onSubmit={submit} className="mx-3 space-y-3 rounded-xl border border-slate-200 bg-white p-3" noValidate>
      <div>
        <label htmlFor={`${id}-url`} className="mb-1 block text-xs font-bold text-slate-900">
          Application address
        </label>
        <input
          id={`${id}-url`}
          type="url"
          value={url}
          onChange={(e) => changeUrl(e.target.value)}
          placeholder="https://app.example.com/"
          aria-invalid={error ? "true" : undefined}
          aria-describedby={`${id}-url-hint${error ? ` ${id}-url-err` : ""}`}
          className={inputClass}
        />
        {error && (
          <p id={`${id}-url-err`} role="alert" className="mt-1 text-xs text-red-700">
            {error}
          </p>
        )}
        <p id={`${id}-url-hint`} className="mt-1 text-xs text-slate-700">
          Sign in to the application in this browser first.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="w-32">
          <NumberField id={`${id}-max`} label="Pages to scan" value={options.maxPages} min={1} max={500} onChange={(v) => set({ maxPages: v })} />
        </div>
        <div className="w-56">
          <NumberField
            id={`${id}-width`}
            label="Screen width (px)"
            hint="The pages are scanned at this width: 1440, 1024, 768, 375… Scan again for another width."
            value={options.width ?? 1280}
            min={320}
            max={2560}
            onChange={(v) => set({ width: v })}
          />
        </div>
      </div>

      <details className="rounded-md border border-slate-200 px-2.5 py-1.5">
        <summary className="cursor-pointer text-sm font-semibold text-slate-800">More options</summary>
        <div className="mt-2 space-y-3 pb-1">
          <div>
            <label htmlFor={`${id}-within`} className="mb-1 block text-xs font-semibold text-slate-800">
              Only pages under
            </label>
            <input
              id={`${id}-within`}
              value={within}
              onChange={(e) => {
                setWithin(e.target.value);
                setWithinEdited(true);
              }}
              placeholder="/ (the whole site)"
              className={inputClass}
            />
          </div>
          <div className="w-32">
            <NumberField id={`${id}-depth`} label="Link depth" value={options.maxDepth} min={1} max={10} onChange={(v) => set({ maxDepth: v })} />
          </div>
          <div className="w-48">
            <NumberField
              id={`${id}-parallel`}
              label="Pages read at once"
              hint="Windows used to find the pages of apps built with script (1–3). Use 1 for production servers."
              value={options.parallel ?? 2}
              min={1}
              max={3}
              onChange={(v) => set({ parallel: v })}
            />
          </div>
          <div className="space-y-1.5">
            {checkbox("Use the site's sitemap", options.useSitemap, (v) => set({ useSitemap: v }))}
            {checkbox("Follow every link", options.allLinks === true, (v) => set({ allLinks: v }), "Not only menus, header and footer")}
            {checkbox("Include screenshots", options.screenshots === true, (v) => set({ screenshots: v }), "Photographs every open issue of each page for the report; slower")}
          </div>
          <div>
            <label htmlFor={`${id}-ex`} className="mb-1 block text-xs font-semibold text-slate-800">
              Skip addresses containing
            </label>
            <textarea id={`${id}-ex`} rows={3} value={exclude} onChange={(e) => setExclude(e.target.value)} className={inputClass} />
          </div>
        </div>
      </details>

      <Button type="submit" variant="primary" size="md" className="w-full py-2" disabled={busy}>
        Find pages
      </Button>
    </form>
  );
}

const STATUS_TEXT: Record<SitePage["status"], string> = {
  pending: "Not scanned",
  scanning: "Scanning…",
  done: "Scanned",
  failed: "Failed",
  skipped: "Skipped",
};

/** "91 (was 88)" when a rescan changed the figure. */
function withPrevious(now: number | undefined, before: number | undefined): string {
  const n = now ?? "–";
  return before !== undefined && before !== now ? `${n} (was ${before})` : `${n}`;
}

function PageRow({
  page,
  index,
  origin,
  editable,
  onToggle,
  onView,
  onRescan,
}: {
  page: SitePage;
  index: number;
  origin: string;
  editable: boolean;
  onToggle(include: boolean): void;
  onView(index: number): void;
  onRescan?(index: number): void;
}) {
  const id = useId();
  const path = pathOf(page.finalUrl ?? page.url, origin);
  const canTick = editable && page.status === "pending";
  return (
    <li className={`flex items-start gap-2 border-b border-slate-200 px-2 py-1.5 last:border-b-0 ${page.status === "scanning" ? "bg-blue-50" : ""}`}>
      <input
        id={`${id}-cb`}
        type="checkbox"
        className="mt-1 shrink-0"
        checked={page.include}
        disabled={!canTick}
        onChange={(e) => onToggle(e.target.checked)}
        aria-describedby={`${id}-st`}
      />
      <div className="min-w-0 flex-1">
        <label htmlFor={`${id}-cb`} className="block truncate text-sm text-slate-900" title={page.finalUrl ?? page.url}>
          {page.title && page.status === "done" ? page.title : path}
        </label>
        {page.title && page.status === "done" && <span className="block truncate text-[11px] text-slate-700">{path}</span>}
        <span id={`${id}-st`} className="block text-[11px] text-slate-700">
          {page.status === "done"
            ? `Score ${withPrevious(page.score, page.previous?.score)} · ${withPrevious(page.definite ?? 0, page.previous?.definite)} issues · ${withPrevious(page.review ?? 0, page.previous?.review)} to review${page.durationMs ? ` · ${Math.round(page.durationMs / 1000)} s` : ""}`
            : page.status === "pending"
              ? page.include
                ? `To scan · ${page.source === "sitemap" ? "from sitemap" : page.source === "manual" ? "added by you" : page.source === "start" ? "start page" : `link depth ${page.depth}`}`
                : (page.note ?? "Not selected")
              : `${STATUS_TEXT[page.status]}${page.error ? `: ${page.error}` : ""}`}
        </span>
      </div>
      {(page.status === "done" || page.status === "failed") && onRescan && (
        <Button size="sm" onClick={() => onRescan(index)} aria-label={`Rescan ${path}`}>
          Rescan
        </Button>
      )}
      {page.status === "done" && (
        <Button size="sm" onClick={() => onView(index)} aria-label={`View results for ${path}`}>
          View
        </Button>
      )}
    </li>
  );
}

/**
 * What differs between the scanned pages in the parts they share: the page
 * title, the header, the navigation, the footer and tab bars.
 */
function AcrossPages({ findings, origin, pages }: { findings: CrossPageFinding[]; origin: string; pages: number }) {
  const id = useId();
  const definite = findings.filter((f) => f.type === "Definite").length;
  return (
    <section aria-labelledby={`${id}-h`} className="mx-3 mt-3 rounded-xl border border-slate-200 bg-white" data-testid="across-pages">
      <div className="border-b border-slate-200 px-3 py-2">
        <h3 id={`${id}-h`} className="text-sm font-bold text-slate-900">
          Across pages ({findings.length})
        </h3>
        <p className="text-xs text-slate-700">
          {pages < 2
            ? "At least two scanned pages are needed to compare them."
            : findings.length === 0
              ? "The page title, header, navigation, footer and tab bars look the same on every page that has them."
              : `The parts the pages share, compared across the ${pages} pages: ${definite} ${definite === 1 ? "difference" : "differences"}${findings.length > definite ? `, ${findings.length - definite} to review` : ""}. Not part of the score of any page.`}
        </p>
      </div>
      {findings.length > 0 && (
        <ul className="px-1.5 py-1.5">
          {findings.map((f) => (
            <li key={f.id} className="px-1.5 py-1">
              <details>
                <summary className="cursor-pointer text-xs text-slate-900">
                  <span className="font-semibold">
                    {f.part}: {f.property}
                  </span>{" "}
                  <SeverityLabel issue={f} />
                  <span className="block text-slate-700">{f.message}</span>
                </summary>
                <ul className="mt-1 border-l-2 border-slate-200 pl-2 text-[11px]">
                  {f.pages.map((p) => (
                    <li key={p.url} className={p.differs ? "font-semibold text-slate-900" : "text-slate-700"}>
                      {pathOf(p.url, origin)}: {p.value}
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function SiteScan({ onBack }: { onBack(): void }) {
  const id = useId();
  const headingRef = useFocusHeading<HTMLHeadingElement>([]);
  const showToast = useStore((s) => s.showToast);
  const openSaved = useStore((s) => s.openSaved);
  const [state, setState] = useSiteScanState();
  const [busy, setBusy] = useState(false);
  const [addUrl, setAddUrl] = useState("");
  const [filter, setFilter] = useState<"all" | "selected" | "done" | "problems">("all");
  const [search, setSearch] = useState("");
  const searchId = useId();

  const call = useCallback(
    async <T,>(msg: Parameters<typeof sendToBackground>[0], failure: string): Promise<T | undefined> => {
      setBusy(true);
      const res = await sendToBackground<T>(msg);
      setBusy(false);
      if (!res.ok) {
        showToast({ kind: "error", message: `${failure}: ${res.error ?? "unknown error"}`, autoDismiss: false });
        return undefined;
      }
      return res.data;
    },
    [showToast],
  );

  const counts = useMemo(() => {
    const pages = state?.pages ?? [];
    const selected = pages.filter((p) => p.include);
    const done = pages.filter((p) => p.status === "done");
    return {
      total: pages.length,
      selected: selected.length,
      remaining: selected.filter((p) => p.status === "pending" || p.status === "scanning").length,
      finished: selected.filter((p) => p.status !== "pending" && p.status !== "scanning").length,
      done: done.length,
      failed: pages.filter((p) => p.status === "failed" || p.status === "skipped").length,
      failedOnly: pages.filter((p) => p.status === "failed").length,
      definite: done.reduce((n, p) => n + (p.definite ?? 0), 0),
      review: done.reduce((n, p) => n + (p.review ?? 0), 0),
      avgScore: done.length ? Math.round(done.reduce((n, p) => n + (p.score ?? 0), 0) / done.length) : null,
    };
  }, [state]);

  const discover = async (url: string, options: SiteScanOptions) => {
    const s = await call<SiteScanState>({ type: "SITE_SCAN_DISCOVER", url, options }, "Could not look for pages");
    if (s) setState(s);
  };
  const toggle = (url: string, include: boolean) => void call({ type: "SITE_SCAN_SET_PAGES", include: { [url]: include } }, "Could not change the page list");
  const tickAll = (include: boolean) => {
    const map: Record<string, boolean> = {};
    for (const p of state?.pages ?? []) if (p.status === "pending") map[p.url] = include;
    void call({ type: "SITE_SCAN_SET_PAGES", include: map }, "Could not change the page list");
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const urls = addUrl.split(/\s+/).filter(Boolean);
    if (!urls.length || !state) return;
    // Paths are taken relative to the site.
    const full = urls.map((u) => (/^https?:/i.test(u) ? u : state.origin + (u.startsWith("/") ? u : `/${u}`)));
    const s = await call<SiteScanState>({ type: "SITE_SCAN_SET_PAGES", add: full }, "Could not add the page");
    if (s) setAddUrl("");
  };
  const view = async (index: number) => {
    // The results of the page, read-only: the page itself was open in the scan window, not in this tab.
    const r = await call<ScanResult>({ type: "SITE_SCAN_RESULT", index }, "Could not open the results of the page");
    if (!r || !state) return;
    const meta: SavedScanMeta = {
      id: `${state.id}:${index}`,
      name: `Site scan · ${r.title || pathOf(r.url, state.origin)}`,
      url: r.url,
      title: r.title,
      scannedAt: r.scannedAt,
      savedAt: r.scannedAt,
      score: r.score,
      summary: r.summary,
      tolerancePreset: r.options.tolerancePreset,
      scope: r.options.scope,
      issueCount: r.findings.filter((f) => f.type === "Definite" && f.status === "new").length,
    };
    openSaved(meta, r);
  };
  /** Scan already-scanned pages again: one page, or every scanned (or failed) page. */
  const rescan = async (index?: number) => {
    const s = await call<SiteScanState>({ type: "SITE_SCAN_RESCAN", indexes: index === undefined ? undefined : [index] }, "Could not rescan");
    if (s) setState(s);
  };
  const exportAll = async (format: ExportFormat) => {
    showToast({ kind: "info", message: `Building one ${format.toUpperCase()} report for ${counts.done} pages…` });
    const r = await call<ReportFile>({ type: "SITE_SCAN_EXPORT", format }, "Export failed");
    if (r) {
      download(r);
      showToast({ kind: "success", message: `Report exported: ${r.filename}` });
    }
  };

  const phase = state?.phase ?? "idle";
  const editable = phase === "review" || phase === "paused" || phase === "done" || phase === "stopped";
  const running = phase === "scanning" || phase === "discovering";
  const pages = (state?.pages ?? [])
    .map((p, i) => ({ p, i }))
    .filter(({ p }) =>
      filter === "all" ? true : filter === "selected" ? p.include && (p.status === "pending" || p.status === "scanning") : filter === "done" ? p.status === "done" : p.status === "failed" || p.status === "skipped" || (p.definite ?? 0) > 0,
    );
  // Search the address (as typed, decoded) and the page title.
  const query = search.trim().toLowerCase();
  const shown = query ? pages.filter(({ p }) => searchText(p).includes(query)) : pages;
  const progress = counts.selected ? Math.round((counts.finished / counts.selected) * 100) : 0;

  return (
    <section aria-labelledby={`${id}-h`} className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3" data-testid="site-scan">
      <div className="px-3 pt-3">
        <BackButton onClick={onBack} ariaLabel="Back" />
      </div>
      <div className="flex items-center gap-2.5 px-3 py-3">
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700">
          <GlobeIcon size={18} />
        </span>
        <div className="min-w-0">
          <h2 id={`${id}-h`} ref={headingRef} tabIndex={-1} className="text-xl font-bold text-slate-900">
            Site scan
          </h2>
          {state && <p className="truncate text-xs text-slate-700">{state.origin}</p>}
        </div>
      </div>

      {state === undefined && <p className="px-3 text-sm text-slate-700">Loading…</p>}

      {(state === null || phase === "idle") && <SetupForm onStart={(u, o) => void discover(u, o)} busy={busy} />}

      {state && phase !== "idle" && (
        <>
          {/* Status card */}
          <div className="mx-3 rounded-xl border border-slate-200 bg-white p-3">
            <p role="status" className="text-sm text-slate-900">
              {phase === "discovering" && (state.message ?? "Looking for pages…")}
              {phase === "review" && (
                <>
                  <strong>{counts.total} pages found</strong> ({state.found.sitemap} from the sitemap, {state.found.links} from links
                  {state.found.excluded ? `, ${state.found.excluded} skipped by your rules` : ""}
                  {state.found.details ? `, ${state.found.details} detail pages and repeat views left out` : ""}). <strong>{counts.selected}</strong> ticked to scan.
                </>
              )}
              {(phase === "scanning" || phase === "paused") && (
                <>
                  <strong>
                    {counts.finished} of {counts.selected} pages
                  </strong>{" "}
                  {phase === "paused" ? "· paused" : "· scanning"}
                </>
              )}
              {(phase === "done" || phase === "stopped") && (
                <>
                  <strong>
                    {counts.done} pages scanned{phase === "stopped" ? " (stopped)" : ""}
                  </strong>{" "}
                  · {counts.definite} issues · {counts.review} to review{counts.avgScore !== null ? ` · average score ${counts.avgScore}` : ""}
                  {counts.failed ? ` · ${counts.failed} not scanned` : ""}
                </>
              )}
            </p>
            {state.message && phase !== "discovering" && <p className="mt-1 text-xs text-slate-800">{state.message}</p>}
            {phase === "scanning" && <p className="mt-1 text-xs text-slate-700">Pages open in a separate window. Leave it open (it can sit behind other windows, but don't minimise it).</p>}
            {(phase === "scanning" || phase === "paused") && (
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-label="Site scan progress" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-1.5">
              {phase === "discovering" && (
                <Button size="md" onClick={() => void call({ type: "SITE_SCAN_STOP" }, "Could not stop")}>
                  Stop looking
                </Button>
              )}
              {phase === "review" && (
                <Button variant="primary" size="md" disabled={busy || counts.selected === 0} onClick={() => void call({ type: "SITE_SCAN_START" }, "Could not start the scan")}>
                  Scan {counts.selected} {counts.selected === 1 ? "page" : "pages"}
                </Button>
              )}
              {phase === "scanning" && (
                <>
                  <Button size="md" onClick={() => void call({ type: "SITE_SCAN_PAUSE" }, "Could not pause")}>
                    Pause
                  </Button>
                  <Button variant="danger" size="md" onClick={() => void call({ type: "SITE_SCAN_STOP" }, "Could not stop")}>
                    Stop
                  </Button>
                </>
              )}
              {phase === "paused" && (
                <>
                  <Button variant="primary" size="md" disabled={busy} onClick={() => void call({ type: "SITE_SCAN_START" }, "Could not resume")}>
                    Resume
                  </Button>
                  <Button variant="danger" size="md" onClick={() => void call({ type: "SITE_SCAN_STOP" }, "Could not stop")}>
                    Stop
                  </Button>
                </>
              )}
              {(phase === "done" || phase === "stopped") && counts.remaining > 0 && (
                <Button variant="primary" size="md" disabled={busy} onClick={() => void call({ type: "SITE_SCAN_START" }, "Could not start the scan")}>
                  Scan {counts.remaining} more
                </Button>
              )}
              {(phase === "done" || phase === "stopped") && counts.done + counts.failedOnly > 0 && (
                <Button size="md" disabled={busy} onClick={() => void rescan()}>
                  Rescan {counts.done + counts.failedOnly === 1 ? "the page" : `all ${counts.done + counts.failedOnly}`}
                </Button>
              )}
              {counts.done > 0 && !running && (
                <>
                  <Button variant={phase === "done" ? "primary" : "secondary"} size="md" disabled={busy} onClick={() => void exportAll("html")}>
                    Export HTML
                  </Button>
                  <Button size="md" disabled={busy} onClick={() => void exportAll("json")}>
                    Export JSON
                  </Button>
                </>
              )}
              {!running && (
                <Button
                  size="md"
                  disabled={busy}
                  onClick={() => {
                    if (counts.done === 0 || window.confirm("Start a new site scan? The current results will be removed.")) void call({ type: "SITE_SCAN_CLEAR" }, "Could not clear");
                  }}
                >
                  New site scan
                </Button>
              )}
            </div>
          </div>

          {(phase === "done" || phase === "stopped") && state.crossPage && <AcrossPages findings={state.crossPage} origin={state.origin} pages={counts.done} />}

          {/* Add pages discovery cannot reach */}
          {editable && (
            <form onSubmit={(e) => void add(e)} className="mx-3 mt-3 flex gap-2">
              <label htmlFor={`${id}-add`} className="sr-only">
                Add a page address or path
              </label>
              <input id={`${id}-add`} value={addUrl} onChange={(e) => setAddUrl(e.target.value)} placeholder="Add a page: /checkout/step-2" className={inputClass} />
              <Button type="submit" size="md" disabled={busy || !addUrl.trim()}>
                Add
              </Button>
            </form>
          )}

          {/* Page list */}
          <div className="mx-3 mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Show pages">
            {(
              [
                ["all", `All ${counts.total}`],
                // Ticked = still to scan; scanned pages are under Scanned.
                ["selected", `Ticked ${counts.remaining}`],
                ["done", `Scanned ${counts.done}`],
                ["problems", "With issues"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${filter === key ? "border-blue-700 bg-blue-700 text-white" : "border-slate-400 bg-white text-slate-800"}`}
              >
                {label}
              </button>
            ))}
            {phase === "review" && (
              <span className="ml-auto flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => tickAll(true)}>
                  Tick all
                </Button>
                <Button variant="ghost" size="sm" onClick={() => tickAll(false)}>
                  Untick all
                </Button>
              </span>
            )}
          </div>
          <div className="mx-3 mt-2">
            <label htmlFor={searchId} className="sr-only">
              Search pages
            </label>
            <input
              id={searchId}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search pages by address or title"
              className="w-full rounded-lg border border-slate-400 bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-600"
            />
            <p className="mt-1 text-xs text-slate-700" aria-live="polite">
              {query ? `${shown.length} of ${pages.length} ${pages.length === 1 ? "page matches" : "pages match"}` : ""}
            </p>
          </div>
          <ul aria-label="Pages" className="mx-3 mt-1 rounded-xl border border-slate-200 bg-white">
            {shown.map(({ p, i }) => (
              <PageRow key={p.url} page={p} index={i} origin={state.origin} editable={editable} onToggle={(v) => toggle(p.url, v)} onView={(n) => void view(n)} onRescan={editable && phase !== "review" ? (n) => void rescan(n) : undefined} />
            ))}
            {shown.length === 0 && (
              <li className="px-2 py-2 text-sm text-slate-700">
                {query ? `No page matches “${search.trim()}”${filter !== "all" ? " in this tab. Try All." : `. It was not found${editable ? "; you can add it above" : ""}.`}` : "No pages here."}
              </li>
            )}
          </ul>
        </>
      )}
    </section>
  );
}

function searchText(p: { url: string; title?: string }): string {
  let url = p.url;
  try {
    url += " " + decodeURI(p.url);
  } catch {
    // Badly encoded address: search it as it is.
  }
  return `${url} ${p.title ?? ""}`.toLowerCase();
}
