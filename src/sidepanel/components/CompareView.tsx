import { useEffect, useId, useMemo, useRef, useState } from "react";
import { diffScans } from "@shared/compare";
import { getRule } from "@shared/rules";
import type { Finding, SavedScan, ScanResult, ScanSummary } from "@shared/types";
import { sendToBackground } from "@shared/messages";
import { SEVERITIES, useStore, type CompareSide } from "@src/sidepanel/store";
import { useFocusHeading } from "@src/sidepanel/hooks/useFocusHeading";
import { BackButton } from "./BackButton";
import { CompareIcon } from "./icons";
import { SeverityLabel } from "./SeverityLabel";

interface Loaded {
  label: string;
  result: ScanResult;
}

const SUMMARY_ROWS: Array<{ key: keyof ScanSummary; label: string }> = [
  { key: "high", label: "High" },
  { key: "medium", label: "Medium" },
  { key: "low", label: "Low" },
  { key: "review", label: "Needs review" },
];

function sideKey(side: CompareSide): string {
  return side.kind === "current" ? "current" : `saved:${side.id}`;
}

function delta(n: number): string {
  if (n === 0) return "±0";
  return n > 0 ? `+${n}` : String(n);
}

function titleOf(f: Finding): string {
  return getRule(f.ruleId)?.name ?? f.ruleId;
}

function IssueRows({ issues }: { issues: Finding[] }) {
  if (issues.length === 0) return <p className="px-1 py-1 text-xs text-slate-600">None.</p>;
  const sorted = [...issues].sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || titleOf(a).localeCompare(titleOf(b)));
  return (
    <ul className="text-xs">
      {sorted.map((i, idx) => (
        <li key={`${i.fingerprint}:${idx}`} className="border-b border-slate-100 px-1 py-1">
          <span className="block text-slate-900">
            <span className="font-mono text-slate-700">{i.ruleId}</span> {titleOf(i)}
          </span>
          <span className="block text-slate-700">{i.message}</span>
          <span className="flex flex-wrap items-center gap-2">
            <SeverityLabel issue={i} />
            <code className="truncate font-mono text-[11px] text-slate-600">{i.element.selector}</code>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Side-by-side comparison of two scans by finding fingerprint (new / fixed / unchanged). */
export function CompareView({ onBack }: { onBack(): void }) {
  const id = useId();
  const compare = useStore((s) => s.compare);
  const live = useStore((s) => (s.viewingSaved ? s.liveResult : s.result));
  const headingRef = useFocusHeading<HTMLHeadingElement>([]);
  const [sides, setSides] = useState<[Loaded, Loaded] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Stable keys: reload only when the compared scans change, not whenever the store hands out a new object.
  const compareKey = compare ? `${sideKey(compare.a)}|${sideKey(compare.b)}` : "";
  const liveScanId = live?.scanId;
  const liveRef = useRef(live);
  liveRef.current = live;

  useEffect(() => {
    // Drop whatever the previous comparison produced so stale sides / errors never show.
    setSides(null);
    setError(null);
    if (!compare) return;
    let cancelled = false;
    const load = async (side: CompareSide): Promise<Loaded> => {
      if (side.kind === "current") {
        const current = liveRef.current;
        if (!current) throw new Error("There is no current scan to compare.");
        return { label: "Current scan", result: current };
      }
      const res = await sendToBackground<SavedScan>({ type: "SAVED_SCAN_GET", id: side.id });
      if (!res.ok || !res.data) throw new Error(res.error ?? "Saved scan not found.");
      return { label: res.data.meta.name, result: res.data.result };
    };
    Promise.all([load(compare.a), load(compare.b)])
      .then(([a, b]) => {
        if (cancelled) return;
        // Older scan on the left so "new" / "fixed" read naturally.
        const ordered: [Loaded, Loaded] = new Date(a.result.scannedAt) <= new Date(b.result.scannedAt) ? [a, b] : [b, a];
        setSides(ordered);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `compare` and `live` are read via compareKey / liveScanId / liveRef
  }, [compareKey, liveScanId]);

  const diff = useMemo(() => (sides ? diffScans(sides[0].result, sides[1].result) : null), [sides]);

  return (
    <section aria-labelledby={`${id}-h`} className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="compare-view">
      <div className="px-3 pt-3">
        <BackButton onClick={onBack} ariaLabel="Back to saved scans" />
      </div>
      <div className="flex items-center gap-2.5 px-3 py-3">
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700">
          <CompareIcon size={18} />
        </span>
        <h2 id={`${id}-h`} ref={headingRef} tabIndex={-1} className="text-xl font-bold text-slate-900">
          Compare scans
        </h2>
      </div>
      {error && (
        <p role="alert" className="px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {!sides && !error && <p className="px-3 py-2 text-sm text-slate-700">Loading…</p>}
      {sides && diff && (
        <>
          <table className="mx-3 my-2 text-xs">
            <caption className="sr-only">Summary of both scans</caption>
            <thead>
              <tr className="text-left">
                <th scope="col" className="pr-3 font-medium text-slate-700">
                  <span className="sr-only">Measure</span>
                </th>
                <th scope="col" className="pr-3 font-semibold text-slate-900">
                  Before: {sides[0].label}
                  <span className="block font-normal text-slate-600">{new Date(sides[0].result.scannedAt).toLocaleString()}</span>
                </th>
                <th scope="col" className="pr-3 font-semibold text-slate-900">
                  After: {sides[1].label}
                  <span className="block font-normal text-slate-600">{new Date(sides[1].result.scannedAt).toLocaleString()}</span>
                </th>
                <th scope="col" className="font-semibold text-slate-900">
                  Change
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row" className="pr-3 text-left font-medium text-slate-700">
                  Score
                </th>
                <td className="tabular-nums">{sides[0].result.score}</td>
                <td className="tabular-nums">{sides[1].result.score}</td>
                <td className="tabular-nums">{delta(Math.round((sides[1].result.score - sides[0].result.score) * 10) / 10)}</td>
              </tr>
              {SUMMARY_ROWS.map((r) => (
                <tr key={r.key}>
                  <th scope="row" className="pr-3 text-left font-medium text-slate-700">
                    {r.label}
                  </th>
                  <td className="tabular-nums">{sides[0].result.summary[r.key]}</td>
                  <td className="tabular-nums">{sides[1].result.summary[r.key]}</td>
                  <td className="tabular-nums">{delta(sides[1].result.summary[r.key] - sides[0].result.summary[r.key])}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sides[0].result.url !== sides[1].result.url && (
            <p className="mx-3 mb-2 rounded-md border border-amber-700 bg-amber-50 px-2 py-1 text-xs text-amber-900">These scans are of different URLs, so most issues will show as new / fixed.</p>
          )}
          {sides[0].result.viewport.width !== sides[1].result.viewport.width && (
            <p className="mx-3 mb-2 rounded-md border border-amber-700 bg-amber-50 px-2 py-1 text-xs text-amber-900">
              These scans were made at different window widths ({sides[0].result.viewport.width}px and {sides[1].result.viewport.width}px), so the layout may differ.
            </p>
          )}
          <div className="px-2 pb-3">
            <details open className="mb-2">
              <summary className="cursor-pointer px-1 text-sm font-semibold text-red-800">New issues ({diff.added.length})</summary>
              <IssueRows issues={diff.added} />
            </details>
            <details open className="mb-2">
              <summary className="cursor-pointer px-1 text-sm font-semibold text-green-800">Fixed issues ({diff.fixed.length})</summary>
              <IssueRows issues={diff.fixed} />
            </details>
            <details className="mb-2">
              <summary className="cursor-pointer px-1 text-sm font-semibold text-slate-800">Unchanged ({diff.unchanged.length})</summary>
              <IssueRows issues={diff.unchanged} />
            </details>
          </div>
        </>
      )}
    </section>
  );
}
