import { useId } from "react";
import type { FindingStatus, Severity } from "@shared/types";
import { SEVERITIES, useStore } from "@src/sidepanel/store";
import { FilterCheckRow, FilterHeading, FilterMenu } from "./FilterMenu";
import { FilterIcon, InfoCircleIcon, SearchIcon } from "./icons";

/** Statuses offered in the Status filter. */
const STATUS_OPTIONS: Array<{ value: FindingStatus; label: string; hint: string }> = [
  { value: "new", label: "Open", hint: "Counted in the totals and score" },
  { value: "ignored", label: "Ignored", hint: "Marked as false positives" },
  { value: "intentional", label: "Intentional", hint: "A difference made on purpose" },
  { value: "baselined", label: "Baselined", hint: "Known and accepted for now" },
];

/** Short description of the current status selection, e.g. "Open" or "All". */
function statusSelection(statuses: FindingStatus[]): string {
  const shown = STATUS_OPTIONS.filter((o) => statuses.length === 0 || statuses.includes(o.value));
  if (shown.length === STATUS_OPTIONS.length) return "All";
  if (shown.length === 1) return shown[0].label;
  return `${shown.length} selected`;
}

/** Short description of a severity selection (empty means all), e.g. "All", "High" or "2 selected". */
function selection(selected: string[]): string {
  if (selected.length === 0) return "All";
  if (selected.length === 1) return selected[0];
  return `${selected.length} selected`;
}

/** Button face shared by the filters: icon, "Name: <value>" with the value in bold, and the matching count. */
function FilterFace({ name, value, count }: { name: string; value: string; count: number }) {
  return (
    <>
      <FilterIcon size={14} className="text-slate-700" />
      <span className="truncate">
        {name}: <strong className="font-bold text-slate-900">{value}</strong>
      </span>
      <span className="rounded-full bg-blue-100 px-1.5 text-[11px] font-semibold tabular-nums text-blue-900">{count}</span>
    </>
  );
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

const LINK_BUTTON = "rounded px-1.5 py-0.5 text-xs font-medium text-blue-800 hover:bg-blue-50 hover:underline";

export function Filters() {
  const id = useId();
  const filters = useStore((s) => s.filters);
  const setFilters = useStore((s) => s.setFilters);
  const result = useStore((s) => s.result);
  const tab = useStore((s) => s.resultTab);
  if (!result || tab === "failed" || tab === "passed" || tab === "groups") return null;

  const statusCount = (s: FindingStatus) => result.findings.filter((f) => f.status === s).length;
  const shownByStatus = STATUS_OPTIONS.filter((o) => filters.statuses.length === 0 || filters.statuses.includes(o.value)).reduce((n, o) => n + statusCount(o.value), 0);
  const statusSel = statusSelection(filters.statuses);
  const sevSel = selection(filters.severities);
  const sevCount = (s: Severity) => result.findings.filter((f) => f.severity === s).length;
  const shownBySeverity = result.findings.filter((f) => filters.severities.length === 0 || filters.severities.includes(f.severity)).length;
  const issuesWord = (n: number) => `${n} ${n === 1 ? "issue" : "issues"}`;
  const lastStatus = filters.statuses.length === 1;
  const group = filters.groupId === null ? undefined : result.groups.find((g) => g.id === filters.groupId);
  const groupNumber = group ? result.groups.indexOf(group) + 1 : 0;

  return (
    <section aria-label="Filters" className="shrink-0 px-3 py-2">
      <div className="flex items-center gap-2">
        <label htmlFor={`${id}-search`} className="sr-only">
          Search issues
        </label>
        <div className="relative min-w-0 flex-1">
          <SearchIcon size={14} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-slate-600" />
          <input
            id={`${id}-search`}
            type="search"
            value={filters.search}
            onChange={(e) => setFilters({ search: e.target.value })}
            placeholder="Search rule, message, selector..."
            className="w-full rounded-md border border-slate-500 bg-white py-1 pr-2 pl-7 text-[13px] text-slate-900 placeholder:text-slate-600"
          />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-stretch gap-2">
        <FilterMenu
          ariaLabel={`Severity: ${sevSel}, ${issuesWord(shownBySeverity)}, open severity filter`}
          className="min-w-24 flex-1"
          panelClassName="w-60"
          panel={
            <fieldset>
              <FilterHeading>Show severities</FilterHeading>
              {SEVERITIES.map((sev) => (
                <FilterCheckRow
                  key={sev}
                  checked={filters.severities.length === 0 || filters.severities.includes(sev)}
                  count={sevCount(sev)}
                  onChange={() => {
                    const base = filters.severities.length === 0 ? [...SEVERITIES] : filters.severities;
                    const next = toggle(base, sev);
                    setFilters({ severities: next.length === SEVERITIES.length ? [] : next });
                  }}
                >
                  <span className={`sev-dot sev-${sev}`} aria-hidden="true" />
                  {sev}
                </FilterCheckRow>
              ))}
            </fieldset>
          }
        >
          <FilterFace name="Severity" value={sevSel} count={shownBySeverity} />
        </FilterMenu>

        <FilterMenu
          ariaLabel={`Status: ${statusSel}, ${issuesWord(shownByStatus)}, open status filter`}
          align="right"
          className="min-w-24 flex-1"
          panelClassName="w-72"
          panel={
            <fieldset>
              <FilterHeading>Show issues that are</FilterHeading>
              {STATUS_OPTIONS.map((o) => {
                const all = STATUS_OPTIONS.map((x) => x.value);
                const checked = filters.statuses.length === 0 || filters.statuses.includes(o.value);
                const locked = checked && lastStatus;
                return (
                  <FilterCheckRow
                    key={o.value}
                    checked={checked}
                    dimmed={locked}
                    hint={o.hint}
                    count={statusCount(o.value)}
                    describedBy={locked ? `${id}-last-status` : undefined}
                    onChange={() => {
                      const base = filters.statuses.length === 0 ? all : filters.statuses;
                      const next = toggle(base, o.value);
                      // At least one status stays ticked: an empty choice would just show an empty list.
                      if (next.length === 0) return;
                      setFilters({ statuses: next.length === all.length ? [] : next });
                    }}
                  >
                    {o.label}
                  </FilterCheckRow>
                );
              })}
              <p id={`${id}-last-status`} className="mt-1 flex items-start gap-1.5 border-t border-slate-200 px-1 pt-2 text-[11px] text-slate-600">
                <InfoCircleIcon size={14} className="mt-px" />
                At least one status stays selected. Tick another to untick this one.
              </p>
              <div className="mt-2 flex flex-wrap gap-1 border-t border-slate-200 pt-2">
                <button type="button" className={LINK_BUTTON} onClick={() => setFilters({ statuses: ["new"] })}>
                  Open only
                </button>
                <button type="button" className={LINK_BUTTON} onClick={() => setFilters({ statuses: ["ignored", "intentional", "baselined"] })}>
                  Excluded only
                </button>
                <button type="button" className={LINK_BUTTON} onClick={() => setFilters({ statuses: [] })}>
                  All
                </button>
              </div>
            </fieldset>
          }
        >
          <FilterFace name="Status" value={statusSel} count={shownByStatus} />
        </FilterMenu>

        {group && (
          <button
            type="button"
            onClick={() => setFilters({ groupId: null })}
            aria-label={`Peer group filter: G${groupNumber}, ${group.label}. Remove filter`}
            className="inline-flex min-w-0 items-center gap-1 rounded-full border border-blue-700 bg-blue-50 px-2 py-0.5 text-xs text-blue-900 hover:bg-blue-100"
          >
            <span className="truncate">
              Peer group: G{groupNumber} · {group.label}
            </span>
            <span aria-hidden="true">✕</span>
          </button>
        )}
      </div>
    </section>
  );
}
