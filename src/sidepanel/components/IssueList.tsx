import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_LABEL, getRule } from "@shared/rules";
import type { Finding, Severity } from "@shared/types";
import { DEFAULT_FILTERS, failedRules, isNeedsReviewIssue, issueNumbers, matchesFilters, severityRank, useStore } from "@src/sidepanel/store";
import { PeerGroups } from "./PeerGroups";
import { DesignScale } from "./DesignScale";
import { SeverityBadge, StatusLabel } from "./SeverityLabel";
import { ChevronDownIcon, ChevronRightIcon, InfoCircleIcon, LightbulbIcon } from "./icons";

interface Group {
  ruleId: string;
  label: string;
  category: string;
  severity: Severity;
  issues: Finding[];
}

/** Short element label for instance rows: `tag#id.class` plus text, from the HTML snippet. */
function elementLabel(issue: Finding): string {
  const html = issue.element.html || issue.element.selector;
  const open = /^<([a-z0-9-]+)([^>]*)>/i.exec(html);
  if (!open) return issue.element.selector;
  const tag = open[1].toLowerCase();
  const id = /\bid="([^"]+)"/.exec(open[2])?.[1];
  const cls = /\bclass="([^"]+)"/.exec(open[2])?.[1]?.trim().split(/\s+/)[0];
  const head = `<${tag}${id ? `#${id}` : ""}${cls ? `.${cls}` : ""}>`;
  return issue.element.text ? `${head} ${issue.element.text}` : head;
}

/** What several findings of a rule have in common, e.g. "Font size 17px, expected 22px". */
function causeOf(issue: Finding): { key: string; label: string } {
  const what = issue.property.charAt(0).toUpperCase() + issue.property.slice(1);
  const label = issue.expected ? `${what} ${issue.actual}, expected ${issue.expected}` : `${what} ${issue.actual}`;
  return { key: `${issue.property}|${issue.actual}|${issue.expected ?? ""}`, label };
}

export function IssueList({ onOpen }: { onOpen(issueId: string): void }) {
  const result = useStore((s) => s.result);
  const filters = useStore((s) => s.filters);
  const tab = useStore((s) => s.resultTab);
  const selectedIssueId = useStore((s) => s.selectedIssueId);
  const expandedRules = useStore((s) => s.expandedRules);
  const toggleRule = useStore((s) => s.toggleRuleExpanded);
  const setResultTab = useStore((s) => s.setResultTab);
  const expandRule = useStore((s) => s.expandRule);
  const selectIssue = useStore((s) => s.selectIssue);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Cause groups the tester opened, keyed `${rule id}|${cause key}`.
  const [openCauses, setOpenCauses] = useState<string[]>([]);
  const toggleCause = (key: string): void => setOpenCauses((list) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]));

  // Focus management on mount: return focus to the item the tester came from
  // (back from the detail view), otherwise land on the heading.
  useEffect(() => {
    const selected = useStore.getState().selectedIssueId;
    const target = (selected && listRef.current?.querySelector<HTMLElement>(`[data-issue-id="${CSS.escape(selected)}"] button`)) || headingRef.current;
    const id = window.requestAnimationFrame(() => target?.focus());
    return () => window.cancelAnimationFrame(id);
  }, []);

  // Badge number = index in result.findings + 1 (matches the overlay); see issueNumbers().
  const numbers = useMemo(() => issueNumbers(result), [result]);

  const groups = useMemo<Group[]>(() => {
    if (!result || tab === "failed" || tab === "passed" || tab === "groups" || tab === "scale") return [];
    const byRule = new Map<string, Finding[]>();
    for (const issue of result.findings) {
      if (!matchesFilters(issue, filters, tab)) continue;
      byRule.set(issue.ruleId, [...(byRule.get(issue.ruleId) ?? []), issue]);
    }
    const out: Group[] = [...byRule.entries()].map(([ruleId, issues]) => {
      const rule = getRule(ruleId);
      const severity = issues.map((i) => i.severity).sort((a, b) => severityRank(a) - severityRank(b))[0];
      return { ruleId, label: rule?.name ?? ruleId, category: rule ? CATEGORY_LABEL[rule.category] : "", severity, issues };
    });
    // Most severe first, then most instances, then name.
    out.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || b.issues.length - a.issues.length || a.label.localeCompare(b.label));
    return out;
  }, [result, filters, tab]);

  const visibleCount = groups.reduce((n, g) => n + g.issues.length, 0);

  // Scroll the selected item into view (e.g. after a badge on the page was clicked).
  useEffect(() => {
    if (!selectedIssueId || !listRef.current) return;
    listRef.current.querySelector<HTMLElement>(`[data-issue-id="${CSS.escape(selectedIssueId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedIssueId, expandedRules]);

  if (!result) return null;

  if (tab === "groups") {
    return (
      <section id="result-tabpanel" role="tabpanel" aria-labelledby="result-tab-groups" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
        <PeerGroups result={result} />
      </section>
    );
  }

  if (tab === "scale") {
    return (
      <section id="result-tabpanel" role="tabpanel" aria-labelledby="result-tab-scale" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
        <DesignScale result={result} />
      </section>
    );
  }

  if (tab === "passed") {
    const passed = result.rules.filter((r) => r.outcome === "passed");
    const other = result.rules.filter((r) => r.outcome !== "passed" && r.outcome !== "failed");
    const NOTE: Record<string, string> = { notApplicable: "nothing to check on this page", notImplemented: "not built yet", disabled: "switched off" };
    return (
      <section id="result-tabpanel" role="tabpanel" aria-labelledby="result-tab-passed" className="flex min-h-0 flex-1 flex-col">
        <h2 ref={headingRef} tabIndex={-1} className="px-3 py-1.5 text-sm font-semibold text-slate-900">
          Passed rules <span className="font-normal text-slate-600">({passed.length})</span>
        </h2>
        <ul className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
          {passed.length === 0 && <li className="py-2 text-sm text-slate-700">No rule passed on this page.</li>}
          {passed.map((r) => (
            <li key={r.id} className="flex items-baseline gap-2 border-b border-slate-100 py-1 text-sm text-slate-900">
              <span aria-hidden="true" className="text-green-700">
                ✓
              </span>
              <span className="min-w-0 flex-1">{getRule(r.id)?.name ?? r.id}</span>
              <span className="text-[11px] text-slate-600">
                {r.groupsChecked} group{r.groupsChecked === 1 ? "" : "s"} checked
              </span>
              <code className="font-mono text-[11px] text-slate-600">{r.id}</code>
            </li>
          ))}
          {other.map((r) => (
            <li key={r.id} className="flex items-baseline gap-2 border-b border-slate-100 py-1 text-sm text-slate-700">
              <span aria-hidden="true" className="text-slate-500">
                –
              </span>
              <span className="min-w-0 flex-1">{getRule(r.id)?.name ?? r.id}</span>
              <span className="text-[11px] text-slate-600">{NOTE[r.outcome] ?? r.outcome}</span>
              <code className="font-mono text-[11px] text-slate-600">{r.id}</code>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  if (tab === "failed") {
    const rules = failedRules(result, filters);
    const elements = rules.reduce((n, r) => n + r.count, 0);
    // Show the rule's elements in the issue list, expanded and scrolled to.
    const openRule = (rule: (typeof rules)[number]) => {
      expandRule(rule.ruleId);
      setResultTab("all");
      selectIssue(rule.firstIssueId);
    };
    return (
      <section id="result-tabpanel" role="tabpanel" aria-labelledby="result-tab-failed" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <h2 ref={headingRef} tabIndex={-1} className="px-3 py-1.5 text-sm font-semibold text-slate-900">
          Failed rules{" "}
          <span className="font-normal text-slate-600">
            ({rules.length} rules, {elements} elements)
          </span>
        </h2>
        {rules.length === 0 ? (
          <p className="px-3 py-2 text-sm text-green-800">No rule failed on this page.</p>
        ) : (
          <table className="mx-3 mb-2 text-sm">
            <caption className="sr-only">Rules that failed, most severe first</caption>
            <thead>
              <tr className="border-b border-slate-300 text-left text-xs text-slate-700">
                <th scope="col" className="py-1 pr-2 font-medium">
                  Rule
                </th>
                <th scope="col" className="py-1 pr-2 font-medium">
                  Category
                </th>
                <th scope="col" className="py-1 pr-2 font-medium">
                  Severity
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Elements
                </th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.ruleId} className="border-b border-slate-100 align-top">
                  <th scope="row" className="py-1 pr-2 text-left font-normal">
                    <button type="button" onClick={() => openRule(r)} className="text-left text-blue-800 underline hover:text-blue-950">
                      {r.title}
                    </button>
                    <span className="block font-mono text-[11px] text-slate-600">{r.ruleId}</span>
                  </th>
                  <td className="py-1 pr-2 text-xs text-slate-800">{r.category ? CATEGORY_LABEL[r.category] : ""}</td>
                  <td className="py-1 pr-2 text-xs text-slate-800">
                    <span className="inline-flex items-center gap-1">
                      <span className={`sev-dot sev-${r.severity}`} aria-hidden="true" />
                      {r.severity}
                    </span>
                  </td>
                  <td className="py-1 text-right tabular-nums text-slate-900">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    );
  }

  const tabTotal = result.findings.filter((f) => matchesFilters(f, { ...DEFAULT_FILTERS, statuses: filters.statuses }, tab)).length;
  const hiddenCount = tabTotal - visibleCount;

  const instanceRow = (issue: Finding) => {
    const n = numbers.get(issue.id) ?? 0;
    const selected = issue.id === selectedIssueId;
    // Ignored / baselined / intentional findings are shown softer: they are not counted.
    const excluded = issue.status !== "new";
    return (
      <li key={issue.id} data-issue-id={issue.id} className={`flex items-center gap-1 rounded border-l-4 ${selected ? "border-blue-700 bg-blue-50" : "border-transparent"}`}>
        <button type="button" onClick={() => onOpen(issue.id)} aria-current={selected ? "true" : undefined} className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left hover:bg-slate-100">
          <span
            className={`inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-bold tabular-nums ${
              excluded ? "border border-slate-300 bg-slate-100 text-slate-700" : "bg-slate-800 text-white"
            }`}
          >
            <span aria-hidden="true">{n}</span>
            <span className="sr-only">Issue number {n}</span>
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block truncate font-mono text-xs ${excluded ? "text-slate-600" : "text-slate-900"}`}>{elementLabel(issue)}</span>
            <span className="block truncate text-[11px] text-slate-700">{causeOf(issue).label}</span>
          </span>
          <StatusLabel status={issue.status} />
        </button>
      </li>
    );
  };

  return (
    <section id="result-tabpanel" role="tabpanel" aria-labelledby={`result-tab-${tab}`} className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5">
        <h2 id="issues-heading" ref={headingRef} tabIndex={-1} className="text-[13px] font-semibold text-slate-900">
          {groups.length} rule{groups.length === 1 ? "" : "s"}, {visibleCount} issue{visibleCount === 1 ? "" : "s"}
          {hiddenCount > 0 && <span className="font-normal text-slate-600"> ({hiddenCount} filtered out)</span>}
        </h2>
      </div>
      <div ref={listRef} className="relative min-h-0 flex-1 overflow-y-auto px-2 pb-2" data-testid="issue-list">
        {tab === "review" && (
          <p className="px-1 pb-2 text-xs text-slate-700">
            These differences are often on purpose (a colour that carries a meaning, a featured card, an icon on some items). Check each one: they are not counted as issues or in the score.
          </p>
        )}
        {tab !== "review" && result.findings.every(isNeedsReviewIssue) && (
          <p className="px-1 py-4 text-sm text-green-800">
            No inconsistency found between the elements that should look the same. Automated checks do not cover everything: differences made on purpose and screens delivered as images are not judged.
          </p>
        )}
        {(tab === "review" || !result.findings.every(isNeedsReviewIssue)) && groups.length === 0 && <p className="px-1 py-4 text-sm text-slate-700">No issues match the current tab and filters.</p>}
        {groups.map((group) => {
          const isOpen = expandedRules.includes(group.ruleId);
          const panelId = `group-${group.ruleId}`;
          const rule = getRule(group.ruleId);
          // Elements that share a cause (the same value, the same expected value) are listed under one expandable row.
          const causes = new Map<string, { label: string; items: Finding[] }>();
          for (const issue of group.issues) {
            const cause = causeOf(issue);
            const entry = causes.get(cause.key) ?? { label: cause.label, items: [] };
            entry.items.push(issue);
            causes.set(cause.key, entry);
          }
          const grouped = causes.size < group.issues.length && causes.size > 1;
          return (
            <div key={group.ruleId} className="mb-2 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
              <h3 className="text-[13px]">
                <button type="button" aria-expanded={isOpen} aria-controls={panelId} onClick={() => toggleRule(group.ruleId)} className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-slate-900 hover:bg-slate-50">
                  <span className={`sev-dot ${tab === "review" ? "sev-review" : `sev-${group.severity}`}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">
                      {group.label} <span className="font-normal tabular-nums text-slate-700">({group.issues.length})</span>
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] font-normal text-slate-600">
                      <span className="font-mono">{group.ruleId}</span>
                      <span aria-hidden="true">·</span>
                      <span>{group.category}</span>
                      <span aria-hidden="true">·</span>
                      <SeverityBadge severity={group.severity} />
                    </span>
                  </span>
                  <span className="shrink-0 text-slate-600">{isOpen ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}</span>
                </button>
              </h3>
              {isOpen && (
                <div id={panelId} className="space-y-2 border-t border-blue-100 bg-blue-50 px-3 py-2.5 text-slate-900">
                  {rule && (
                    <>
                      <p className="flex items-start gap-1.5 leading-relaxed text-slate-800">
                        <InfoCircleIcon size={16} className="mt-0.5 shrink-0" />
                        {rule.description}
                      </p>
                      <p className="flex items-start gap-1.5 rounded-md border border-blue-200 bg-white px-2 py-1.5 leading-relaxed text-slate-900">
                        <LightbulbIcon size={16} className="mt-0.5 shrink-0 text-amber-700" />
                        {rule.fix}
                      </p>
                    </>
                  )}
                  <ul aria-label="Elements" className="rounded-md bg-white py-0.5">
                    {!grouped
                      ? group.issues.map(instanceRow)
                      : [...causes.entries()].map(([key, { label, items }]) => {
                          if (items.length === 1) return instanceRow(items[0]);
                          const causeKey = `${group.ruleId}|${key}`;
                          const causeOpen = openCauses.includes(causeKey) || items.some((i) => i.id === selectedIssueId);
                          const causeId = `cause-${causeKey.replace(/[^a-z0-9]+/gi, "-")}`;
                          return (
                            <li key={causeKey}>
                              <button type="button" aria-expanded={causeOpen} aria-controls={causeId} onClick={() => toggleCause(causeKey)} className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-xs text-slate-900 hover:bg-slate-100">
                                <span className="shrink-0 text-slate-600">{causeOpen ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}</span>
                                <span className="min-w-0 flex-1 truncate">{label}</span>
                                <span className="shrink-0 rounded bg-slate-100 px-1.5 text-[11px] font-semibold tabular-nums text-slate-800">
                                  × {items.length}
                                  <span className="sr-only"> elements</span>
                                </span>
                              </button>
                              {causeOpen && (
                                <ul id={causeId} className="ml-4 border-l border-slate-200 pl-1">
                                  {items.map(instanceRow)}
                                </ul>
                              )}
                            </li>
                          );
                        })}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
