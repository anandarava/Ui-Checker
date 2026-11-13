import { useMemo, useRef, type KeyboardEvent } from "react";
import { DEFAULT_FILTERS, failedRules, matchesFilters, useStore, type ResultTab } from "@src/sidepanel/store";
import { flaggedValues } from "./DesignScale";

const TABS: Array<{ value: ResultTab; label: string }> = [
  { value: "all", label: "All" },
  { value: "typography", label: "Typography" },
  { value: "layout", label: "Layout & spacing" },
  { value: "group", label: "Group structure" },
  { value: "box", label: "Box style" },
  { value: "content", label: "Text & content" },
  { value: "review", label: "Needs review" },
  { value: "failed", label: "Failed rules" },
  { value: "passed", label: "Passed rules" },
  { value: "groups", label: "Peer groups" },
  { value: "scale", label: "Design scale" },
];

/**
 * Result tabs. Counts honour the status filter (ignored / baselined /
 * intentional) but not the severity, group or search filters, so they read as
 * totals. Implemented as a tablist with roving focus (arrow keys, Home, End).
 */
export function ResultTabs() {
  const result = useStore((s) => s.result);
  const tab = useStore((s) => s.resultTab);
  const setTab = useStore((s) => s.setResultTab);
  const filters = useStore((s) => s.filters);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const counts = useMemo(() => {
    // Same rules as the list (IssueList): the status filter applies, severity / group / search do not.
    const base = { ...DEFAULT_FILTERS, statuses: filters.statuses };
    const findings = result?.findings ?? [];
    const count = (t: ResultTab) => findings.filter((f) => matchesFilters(f, base, t)).length;
    return {
      all: count("all"),
      typography: count("typography"),
      layout: count("layout"),
      group: count("group"),
      box: count("box"),
      content: count("content"),
      review: count("review"),
      failed: failedRules(result, filters).length,
      passed: result?.rules.filter((r) => r.outcome === "passed").length ?? 0,
      groups: result?.groups.length ?? 0,
      // Values of the scale that stand out.
      scale: flaggedValues(result?.audit),
    } satisfies Record<ResultTab, number>;
  }, [result, filters]);

  if (!result) return null;

  const onKeyDown = (e: KeyboardEvent, index: number) => {
    let next = index;
    if (e.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    else return;
    e.preventDefault();
    setTab(TABS[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div role="tablist" aria-label="Result type" className="flex shrink-0 flex-nowrap overflow-x-auto border-b border-slate-200 px-2">
      {TABS.map((t, index) => {
        const selected = t.value === tab;
        const n = counts[t.value];
        return (
          <button
            key={t.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`result-tab-${t.value}`}
            aria-selected={selected}
            aria-controls="result-tabpanel"
            tabIndex={selected ? 0 : -1}
            onClick={() => setTab(t.value)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap border-b-2 px-2.5 py-2 text-[13px] ${
              selected ? "border-blue-600 font-bold text-blue-700" : "border-transparent font-medium text-slate-700 hover:bg-slate-50"
            }`}
          >
            {t.label}{" "}
            <span className={`inline-flex min-w-5 justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums ${selected ? "bg-blue-100 text-blue-800" : "bg-slate-100 text-slate-700"}`}>{n}</span>
          </button>
        );
      })}
    </div>
  );
}
