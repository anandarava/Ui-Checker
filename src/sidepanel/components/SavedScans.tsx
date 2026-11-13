import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { ExportFormat, SavedScan, SavedScanMeta } from "@shared/types";
import { sendToBackground } from "@shared/messages";
import { useStore, type CompareSide } from "@src/sidepanel/store";
import { useFocusHeading } from "@src/sidepanel/hooks/useFocusHeading";
import { Button } from "./Button";
import { BackButton } from "./BackButton";
import { BookmarkIcon, CheckIcon, ChevronDownIcon, CompareIcon, DownloadIcon, MoreVerticalIcon, PencilIcon, RefreshIcon, TrashIcon } from "./icons";
import { RowMenu } from "./RowMenu";
import { ScoreRing } from "./ScoreRing";
import { displayUrl, sameUrlIgnoringHash, splitScanName } from "./scanRowHelpers";
import { changeSettings } from "@src/sidepanel/hooks/useBackgroundEvents";
import { useStartScan } from "./ScanButton";
import { download, type ReportFile } from "./ExportMenu";
import { EmptyState, SavedScansIllustration } from "./EmptyState";

/** The name a scan is stored under: what the tester typed plus the moment it was saved. */
export function savedScanName(typed: string, now: Date = new Date()): string {
  const when = now.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return `${typed.trim()} – ${when}`;
}

const ACTION_BTN =
  "inline-flex h-8 items-center justify-center rounded-md border border-slate-500 bg-white font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-500";

/** Small rounded chip; with `n` it is tinted (and gets a dot) only while the count is above zero. */
function Chip({ children, n, tone, dot }: { children: string; n?: number; tone?: string; dot?: string }) {
  const tinted = n !== undefined && n > 0 && tone;
  return (
    <li className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tinted ? tone : "border-slate-200 bg-slate-100 text-slate-700"}`}>
      {tinted && <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dot}`} />}
      {children}
    </li>
  );
}

/**
 * Saved scans: named snapshots of results kept across sessions. Open one
 * read-only, rename, export, delete, or pick two (or one plus the current
 * scan) to compare.
 *
 * Copied from the PalTech Accessibility Testing extension; only the wording
 * and the data shown differ.
 */
export function SavedScans({ onBack }: { onBack(): void }) {
  const id = useId();
  const tabId = useStore((s) => s.tabId);
  const result = useStore((s) => s.viewingSaved ? s.liveResult : s.result);
  const openSaved = useStore((s) => s.openSaved);
  const setCompare = useStore((s) => s.setCompare);
  const setView = useStore((s) => s.setView);
  const showToast = useStore((s) => s.showToast);
  const headingRef = useFocusHeading<HTMLHeadingElement>([]);
  const [items, setItems] = useState<SavedScanMeta[] | null>(null);
  const [name, setName] = useState("");
  const [withShots, setWithShots] = useState(true);
  const [nameError, setNameError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const rootRef = useRef<HTMLElement>(null);
  const scanning = useStore((s) => s.scanning);
  const startScan = useStartScan();
  /** URL of the active tab, read when a row's More menu opens (used to enable "Rescan this page"). */
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  /** CSS selector of the element to focus once the list/rename form has re-rendered; "heading" means the view heading. */
  const pendingFocus = useRef<string | null>(null);

  // Keyboard users must not lose focus when the control they used is removed or replaced.
  useEffect(() => {
    const sel = pendingFocus.current;
    if (!sel) return;
    const el = sel === "heading" ? headingRef.current : rootRef.current?.querySelector<HTMLElement>(sel);
    if (el) {
      pendingFocus.current = null;
      el.focus();
    }
  }, [items, renaming, headingRef]);

  const load = useCallback(async () => {
    const res = await sendToBackground<SavedScanMeta[]>({ type: "SAVED_SCANS_LIST" });
    if (res.ok && Array.isArray(res.data)) setItems(res.data);
    else {
      setItems([]);
      showToast({ kind: "error", message: `Could not load saved scans: ${res.error ?? "unknown error"}` });
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (tabId === null || !result) return;
    if (!name.trim()) {
      setNameError("Enter a name for this scan.");
      nameRef.current?.focus();
      return;
    }
    setNameError(null);
    setBusy("save");
    const res = await sendToBackground<SavedScanMeta>({ type: "SAVED_SCAN_SAVE", tabId, name: savedScanName(name), screenshots: withShots });
    setBusy(null);
    if (!res.ok) {
      showToast({ kind: "error", message: `Could not save the scan: ${res.error ?? "unknown error"}`, autoDismiss: false });
      return;
    }
    showToast({ kind: "success", message: `Saved "${res.data?.name ?? name}".` });
    setName("");
    void load();
  };

  const open = async (meta: SavedScanMeta) => {
    setBusy(`open:${meta.id}`);
    const res = await sendToBackground<SavedScan>({ type: "SAVED_SCAN_GET", id: meta.id });
    setBusy(null);
    if (!res.ok || !res.data) {
      showToast({ kind: "error", message: `Could not open the scan: ${res.error ?? "not found"}` });
      return;
    }
    openSaved(res.data.meta, res.data.result);
  };

  const remove = async (meta: SavedScanMeta) => {
    if (!window.confirm(`Delete the saved scan "${meta.name}"? This cannot be undone.`)) return;
    // The deleted row disappears (and the focused button is disabled meanwhile): hand focus to a neighbouring row, else the heading.
    const list = items ?? [];
    const at = list.findIndex((m) => m.id === meta.id);
    const neighbour = list[at + 1] ?? list[at - 1];
    setBusy(`del:${meta.id}`);
    const res = await sendToBackground({ type: "SAVED_SCAN_DELETE", id: meta.id });
    setBusy(null);
    if (!res.ok) {
      showToast({ kind: "error", message: `Could not delete: ${res.error ?? "unknown error"}` });
      pendingFocus.current = `[data-more-id="${CSS.escape(meta.id)}"]`;
    } else {
      pendingFocus.current = neighbour ? `[data-open-id="${CSS.escape(neighbour.id)}"]` : "heading";
    }
    setSelected((s) => s.filter((x) => x !== meta.id));
    void load();
  };

  const closeRename = (meta: SavedScanMeta) => {
    pendingFocus.current = `[data-more-id="${CSS.escape(meta.id)}"]`;
    setRenaming(null);
  };

  const rename = async (e: FormEvent, meta: SavedScanMeta) => {
    e.preventDefault();
    const res = await sendToBackground({ type: "SAVED_SCAN_RENAME", id: meta.id, name: renameValue });
    if (!res.ok) showToast({ kind: "error", message: `Could not rename: ${res.error ?? "unknown error"}` });
    closeRename(meta);
    void load();
  };

  const exportAs = async (meta: SavedScanMeta, format: ExportFormat) => {
    setBusy(`exp:${meta.id}`);
    const res = await sendToBackground<ReportFile>({ type: "SAVED_SCAN_EXPORT", id: meta.id, format });
    setBusy(null);
    if (res.ok && res.data) {
      download(res.data);
      showToast({ kind: "success", message: `Report exported: ${res.data.filename}` });
    } else showToast({ kind: "error", message: `Export failed: ${res.error ?? "unknown error"}`, autoDismiss: false });
  };

  const refreshActiveUrl = async () => {
    try {
      if (tabId === null) return setActiveUrl(null);
      const tab = await chrome.tabs.get(tabId);
      setActiveUrl(tab.url ?? null);
    } catch {
      setActiveUrl(null);
    }
  };

  /** Re-scan the page the saved scan was taken on, with the tolerance of that scan. */
  const rescan = async (meta: SavedScanMeta) => {
    await changeSettings({ tolerancePreset: meta.tolerancePreset });
    onBack();
    void startScan();
  };

  const compare = () => {
    const sides: CompareSide[] = selected.map((sid) => ({ kind: "saved", id: sid }));
    if (sides.length === 1 && result) sides.push({ kind: "current" });
    if (sides.length !== 2) return;
    setCompare({ a: sides[0], b: sides[1] });
    setView("compare");
  };

  const toggle = (sid: string) => setSelected((s) => (s.includes(sid) ? s.filter((x) => x !== sid) : [...s, sid]));

  const canCompare = selected.length === 2 || (selected.length === 1 && Boolean(result));
  const allSelected = Boolean(items?.length) && selected.length === items?.length;
  // "Select all" reads as partly ticked (mixed) when only some scans are selected.
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selected.length > 0 && !allSelected;
  }, [selected.length, allSelected]);

  return (
    <section ref={rootRef} aria-labelledby={`${id}-h`} className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="saved-scans">
      <div className="px-3 pt-3">
        <BackButton onClick={onBack} ariaLabel="Back to results" />
      </div>
      <div className="flex items-center gap-2.5 px-3 py-3">
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700">
          <BookmarkIcon size={18} />
        </span>
        <h2 id={`${id}-h`} ref={headingRef} tabIndex={-1} className="text-xl font-bold text-slate-900">
          Saved scans
        </h2>
      </div>

      <form onSubmit={(e) => void save(e)} className="mx-3 rounded-xl border border-slate-200 bg-white p-3">
        {/* aria-labelledby (not htmlFor): clicking the caption must not move focus into the field. */}
        <p id={`${id}-name-label`} className="block text-xs font-bold text-slate-900">
          Save the current scan as
        </p>
        <div className="mt-1.5 flex gap-2">
          <input
            id={`${id}-name`}
            ref={nameRef}
            aria-labelledby={`${id}-name-label`}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError(null);
            }}
            disabled={!result}
            placeholder="e.g. Checkout page"
            aria-invalid={nameError ? "true" : undefined}
            aria-describedby={`${id}-name-hint${nameError ? ` ${id}-name-err` : ""}`}
            className="min-w-0 flex-1 rounded-md border border-slate-500 bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-500"
          />
          <Button type="submit" variant="primary" size="md"disabled={!result || tabId === null || busy === "save"}>
            {busy === "save" ? (withShots ? "Taking screenshots…" : "Saving…") : "Save"}
          </Button>
        </div>
        {nameError && (
          <p id={`${id}-name-err`} role="alert" className="mt-1 text-xs text-red-700">
            {nameError}
          </p>
        )}
        <p id={`${id}-name-hint`} className="mt-1.5 text-xs text-slate-700">
          {result ? "The date and time are added when you save." : "Run a scan first to save it."}
        </p>
        <label className="mt-2 flex items-start gap-2 text-sm text-slate-800">
          <input type="checkbox" className="mt-1" checked={withShots} onChange={(e) => setWithShots(e.target.checked)} />
          <span>
            Include screenshots
            <span className="block text-xs text-slate-700">Photographs every open issue now, so the reports of this scan show them. The page scrolls while it runs.</span>
          </span>
        </label>
      </form>

      <div className="mx-3 mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
              <CompareIcon size={16} />
            </span>
            <p className="text-xs text-slate-800">
              {selected.length === 0
                ? "Tick two scans (or one to compare with the current scan)."
                : selected.length > 2
                  ? `${selected.length} selected – tick exactly two to compare.`
                  : `${selected.length} selected${selected.length === 1 && result ? " – compares with the current scan" : ""}.`}
            </p>
          </div>
          <Button size="md" onClick={compare} disabled={!canCompare} className="bg-white">
            Compare
          </Button>
        </div>
        {items === null && <p className="mt-2 text-xs text-slate-700">Loading…</p>}
        {items?.length === 0 && <p className="mt-2 text-xs text-slate-700">No saved scans yet.</p>}
      </div>

      {Boolean(items?.length) && (
        // Lined up with the rows' checkboxes: list padding + row padding + row border.
        <div className="mx-3 mt-3 flex items-center justify-between gap-2 px-[13px]">
          <label className="flex cursor-pointer items-center gap-2.5 text-xs font-medium text-slate-800">
            <input
              ref={selectAllRef}
              type="checkbox"
              className="peer sr-only"
              checked={allSelected}
              onChange={() => setSelected(allSelected ? [] : (items ?? []).map((m) => m.id))}
            />
            <span
              aria-hidden="true"
              className={`flex h-4 w-4 items-center justify-center rounded border text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue-700 ${
                selected.length > 0 ? "border-blue-600 bg-blue-600" : "border-slate-500 bg-white"
              }`}
            >
              {allSelected ? <CheckIcon size={12} /> : selected.length > 0 && <span className="h-0.5 w-2 rounded bg-white" />}
            </span>
            Select all
          </label>
          <span aria-live="polite" className="text-xs text-slate-700">
            {selected.length} of {items?.length} selected
          </span>
        </div>
      )}

      <ul className="px-3 pt-2 pb-3">
        {items?.map((meta) => {
          const checked = selected.includes(meta.id);
          const { title, when } = splitScanName(meta.name);
          const sameTab = sameUrlIgnoringHash(activeUrl, meta.url);
          const s = meta.summary;
          return (
            <li key={meta.id} className={`mb-2 rounded-xl border p-3 ${checked ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white"}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
                <div className="flex min-w-0 flex-1 basis-56 items-start gap-3">
                  <label className="flex h-11 shrink-0 cursor-pointer items-center">
                    <input type="checkbox" className="peer sr-only" checked={checked} onChange={() => toggle(meta.id)} aria-label={`Select "${meta.name}" to compare`} />
                    <span
                      aria-hidden="true"
                      className={`flex h-4 w-4 items-center justify-center rounded border text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue-700 ${
                        checked ? "border-blue-600 bg-blue-600" : "border-slate-500 bg-white"
                      }`}
                    >
                      {checked && <CheckIcon size={12} />}
                    </span>
                  </label>
                  <ScoreRing score={meta.score} />
                  <div className="min-w-0 flex-1">
                    {renaming === meta.id ? (
                      <form onSubmit={(e) => void rename(e, meta)} className="flex gap-1">
                        <label htmlFor={`${id}-rn-${meta.id}`} className="sr-only">
                          New name
                        </label>
                        <input
                          id={`${id}-rn-${meta.id}`}
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => e.key === "Escape" && closeRename(meta)}
                          autoFocus
                          className="min-w-0 flex-1 rounded border border-slate-500 bg-white px-1.5 py-0.5 text-sm text-slate-900"
                        />
                        <Button type="submit" size="sm" variant="primary">
                          Rename
                        </Button>
                      </form>
                    ) : (
                      <h3 className="flex min-w-0 items-baseline gap-2 text-sm">
                        <span className="truncate font-bold text-slate-900" title={title}>
                          {title}
                        </span>
                        <span className="shrink-0 text-xs font-normal text-slate-600">{when ?? new Date(meta.scannedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
                      </h3>
                    )}
                    <p className="truncate font-mono text-[11px] text-slate-600" title={meta.url}>
                      {displayUrl(meta.url)}
                    </p>
                    <ul aria-label="Scan summary" className="mt-1.5 flex flex-wrap gap-1">
                      <Chip>{`Tolerance: ${meta.tolerancePreset}`}</Chip>
                      {meta.scope === "selector" && <Chip>Part of page</Chip>}
                      <Chip n={s.high} tone="border-orange-200 bg-orange-50 text-orange-900" dot="bg-orange-600">{`${s.high} high`}</Chip>
                      <Chip n={s.medium} tone="border-amber-200 bg-amber-100 text-amber-900" dot="bg-amber-600">{`${s.medium} medium`}</Chip>
                      <Chip n={s.low} tone="border-slate-300 bg-slate-200 text-slate-800" dot="bg-slate-500">{`${s.low} low`}</Chip>
                      <Chip n={s.review} tone="border-cyan-200 bg-cyan-50 text-cyan-900" dot="bg-cyan-700">{`${s.review} for review`}</Chip>
                    </ul>
                  </div>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                  <Button size="sm" variant="primary" data-open-id={meta.id} onClick={() => void open(meta)} disabled={busy === `open:${meta.id}`}>
                    Open
                  </Button>
                  <RowMenu
                    ariaLabel={`Export "${meta.name}"`}
                    triggerClassName={`${ACTION_BTN} gap-1 px-2.5 text-xs`}
                    trigger={
                      <>
                        Export
                        <ChevronDownIcon size={14} className="text-slate-700" />
                      </>
                    }
                    items={[
                      { key: "html", label: "HTML report", icon: <DownloadIcon />, disabled: busy === `exp:${meta.id}`, onSelect: () => void exportAs(meta, "html") },
                      { key: "json", label: "JSON", icon: <DownloadIcon />, disabled: busy === `exp:${meta.id}`, onSelect: () => void exportAs(meta, "json") },
                    ]}
                  />
                  <RowMenu
                    ariaLabel={`More actions for "${meta.name}"`}
                    triggerClassName={`${ACTION_BTN} w-8`}
                    triggerProps={{ "data-more-id": meta.id }}
                    trigger={<MoreVerticalIcon size={16} />}
                    onOpen={() => void refreshActiveUrl()}
                    items={[
                      {
                        key: "rename",
                        label: "Rename",
                        icon: <PencilIcon />,
                        onSelect: () => {
                          setRenaming(meta.id);
                          setRenameValue(meta.name);
                        },
                      },
                      {
                        key: "rescan",
                        label: "Rescan this page",
                        icon: <RefreshIcon />,
                        disabled: !sameTab || scanning,
                        hint: sameTab ? undefined : "Open this page in the current tab to rescan it",
                        onSelect: () => void rescan(meta),
                      },
                      {
                        key: "delete",
                        label: "Delete…",
                        icon: <TrashIcon />,
                        danger: true,
                        separatorBefore: true,
                        disabled: busy === `del:${meta.id}`,
                        onSelect: () => void remove(meta),
                      },
                    ]}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {items?.length === 0 && (
        <EmptyState illustration={<SavedScansIllustration />} heading="No saved scans yet">
          Save a scan to view it here and compare with other scans.
        </EmptyState>
      )}

    </section>
  );
}
