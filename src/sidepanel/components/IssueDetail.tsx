import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_LABEL, getRule } from "@shared/rules";
import type { Finding, FindingStatus } from "@shared/types";
import { clearLocatedIssue, locateIssue, setStatus } from "@src/sidepanel/hooks/messaging";
import { issueNumbers, matchesFilters, useStore } from "@src/sidepanel/store";
import { BackButton } from "./BackButton";
import { Button } from "./Button";
import { ReasonForm } from "./ReasonForm";
import { SeverityLabel, StatusLabel, STATUS_LABEL } from "./SeverityLabel";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, EyeIcon, InfoCircleIcon, LightbulbIcon } from "./icons";

type Action = Exclude<FindingStatus, "new">;

const ACTION: Record<Action, { button: string; title: string; description: string; submit: string }> = {
  ignored: {
    button: "Ignore…",
    title: "Ignore this finding",
    description: "Ignored findings are false positives: they are left out of the totals and the score on this site. Say why.",
    submit: "Ignore",
  },
  intentional: {
    button: "Intentional…",
    title: "Mark as intentional",
    description: "The difference is made on purpose (a featured card, a different kind of item). It is left out of the totals and the score on this site. Say why.",
    submit: "Mark as intentional",
  },
  baselined: {
    button: "Add to baseline…",
    title: "Add to the baseline",
    description: "A known issue that is accepted for now. It is left out of the totals and the score on this site, and stays listed as baselined. Say why.",
    submit: "Add to baseline",
  },
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-2 border-b border-slate-100 py-1 last:border-b-0">
      <dt className="text-xs font-medium text-slate-700">{label}</dt>
      <dd className="min-w-0 break-words text-[13px] text-slate-900">{children}</dd>
    </div>
  );
}

/**
 * One finding: what was expected and what was found, the element, the peers it
 * was compared with, how to fix it, and the actions (ignore, intentional,
 * baseline). The element, its peers and the measurement are drawn on the page.
 */
export function IssueDetail({ issueId, onBack }: { issueId: string; onBack(): void }) {
  const result = useStore((s) => s.result);
  const tabId = useStore((s) => s.tabId);
  const filters = useStore((s) => s.filters);
  const tab = useStore((s) => s.resultTab);
  const autoHighlight = useStore((s) => s.autoHighlight);
  const setAutoHighlight = useStore((s) => s.setAutoHighlight);
  const selectIssue = useStore((s) => s.selectIssue);
  const setFilters = useStore((s) => s.setFilters);
  const setResultTab = useStore((s) => s.setResultTab);
  const showToast = useStore((s) => s.showToast);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [form, setForm] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPeers, setShowPeers] = useState(true);

  const issue = result?.findings.find((f) => f.id === issueId);
  const numbers = useMemo(() => issueNumbers(result), [result]);

  // The other findings of the same rule that the list shows, for the "3 of 12" stepper.
  const siblings = useMemo(() => {
    if (!result || !issue) return [];
    const list = result.findings.filter((f) => f.ruleId === issue.ruleId && matchesFilters(f, filters, tab));
    return list.some((f) => f.id === issue.id) ? list : [issue];
  }, [result, issue, filters, tab]);
  const position = issue ? siblings.findIndex((f) => f.id === issue.id) : -1;

  useEffect(() => {
    headingRef.current?.focus();
    setForm(null);
  }, [issueId]);

  // Draw the element, its peers and the measurement on the page while the finding is open.
  useEffect(() => {
    if (tabId === null || !issue || !autoHighlight) return;
    void locateIssue(tabId, issue, showPeers).then((res) => {
      if (!res.ok) showToast({ kind: "error", message: "The page has changed since the scan. Scan again to show the element." });
    });
    return () => {
      void clearLocatedIssue(tabId);
    };
    // Re-run only for another finding or another choice, not for every result update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, issueId, autoHighlight, showPeers]);

  if (!result || !issue) {
    return (
      <div className="p-3">
        <BackButton onClick={onBack} />
        <p className="mt-2 text-sm text-slate-700">This finding is no longer in the results.</p>
      </div>
    );
  }

  const rule = getRule(issue.ruleId);
  const group = issue.groupId ? result.groups.find((g) => g.id === issue.groupId) : undefined;
  const groupNumber = group ? result.groups.indexOf(group) + 1 : 0;
  const step = (delta: number) => {
    const next = siblings[position + delta];
    if (next) selectIssue(next.id);
  };

  const viewElement = async () => {
    if (tabId === null) return;
    const res = await locateIssue(tabId, issue, showPeers);
    if (!res.ok) showToast({ kind: "error", message: "The page has changed since the scan. Scan again to show the element." });
  };

  const submit = async (status: FindingStatus, reason?: string) => {
    setBusy(true);
    const ok = await setStatus([issue], status, reason);
    setBusy(false);
    if (ok) setForm(null);
  };

  const showGroupFindings = () => {
    if (!group) return;
    setFilters({ groupId: group.id, severities: [], search: "", statuses: [] });
    setResultTab("all");
    onBack();
  };

  return (
    <article aria-labelledby="issue-title" className="flex min-h-0 flex-1 flex-col" data-testid="issue-detail">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-3 py-2">
        <BackButton onClick={onBack} />
        <span className="flex-1" />
        {siblings.length > 1 && (
          <div className="flex items-center gap-1 text-xs text-slate-700" role="group" aria-label="Findings of this rule">
            <Button size="sm" onClick={() => step(-1)} disabled={position <= 0} aria-label="Previous finding of this rule">
              <ChevronLeftIcon size={14} />
            </Button>
            <span className="tabular-nums" aria-live="polite">
              {position + 1} of {siblings.length}
            </span>
            <Button size="sm" onClick={() => step(1)} disabled={position >= siblings.length - 1} aria-label="Next finding of this rule">
              <ChevronRightIcon size={14} />
            </Button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <h2 id="issue-title" ref={headingRef} tabIndex={-1} className="text-base font-bold text-slate-900">
          <span className="mr-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-800 px-1 align-middle text-[11px] font-bold tabular-nums text-white">
            <span aria-hidden="true">{numbers.get(issue.id)}</span>
            <span className="sr-only">Issue number {numbers.get(issue.id)}</span>
          </span>
          {rule?.name ?? issue.ruleId}
        </h2>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-700">
          <span className="font-mono">{issue.ruleId}</span>
          {rule && <span>{CATEGORY_LABEL[rule.category]}</span>}
          <SeverityLabel issue={issue} />
          <StatusLabel status={issue.status} />
        </p>

        <section aria-label="Issue" className="mt-3">
          <h3 className="flex items-center gap-1.5 text-[13px] font-bold text-slate-900">
            <InfoCircleIcon size={16} /> Issue
          </h3>
          <p className="mt-1 leading-relaxed text-slate-800">{issue.message}</p>
        </section>

        <section aria-label="Expected and found" className="mt-3">
          <h3 className="text-[13px] font-bold text-slate-900">Expected and found</h3>
          <dl className="mt-1 rounded-md border border-slate-200 bg-white px-2">
            <Row label="Compared">{issue.property}</Row>
            <Row label="Found">
              <strong className="font-semibold text-red-800">{issue.actual}</strong>
            </Row>
            <Row label="Expected">{issue.expected ? <strong className="font-semibold text-green-800">{issue.expected}</strong> : <span className="text-slate-700">No clear majority to go by: see the values below.</span>}</Row>
            {issue.values.length > 0 && (
              <Row label="In the group">
                <ul className="flex flex-wrap gap-1">
                  {issue.values.map((v) => (
                    <li key={v.value} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-800">
                      {v.value} <span className="tabular-nums text-slate-600">× {v.count}</span>
                    </li>
                  ))}
                </ul>
              </Row>
            )}
          </dl>
        </section>

        {rule && (
          <section aria-label="Suggested fix" className="mt-3">
            <h3 className="flex items-center gap-1.5 text-[13px] font-bold text-slate-900">
              <LightbulbIcon size={16} className="text-amber-700" /> Suggested fix
            </h3>
            <p className="mt-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 leading-relaxed text-slate-900">{rule.fix}</p>
          </section>
        )}

        <section aria-label="Element" className="mt-3">
          <h3 className="text-[13px] font-bold text-slate-900">Element</h3>
          <dl className="mt-1 rounded-md border border-slate-200 bg-white px-2">
            <Row label="Selector">
              <code className="font-mono text-xs">{issue.element.selector}</code>
            </Row>
            <Row label="HTML">
              <code className="font-mono text-xs">{issue.element.html}</code>
            </Row>
            <Row label="Position">
              {Math.round(issue.element.box.x)}, {Math.round(issue.element.box.y)} · {Math.round(issue.element.box.width)} × {Math.round(issue.element.box.height)} px
            </Row>
          </dl>
        </section>

        {group && (
          <section aria-label="Peer group" className="mt-3">
            <h3 className="text-[13px] font-bold text-slate-900">
              Compared with <span className="font-normal text-slate-700">(G{groupNumber} · {group.label})</span>
            </h3>
            <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border border-slate-200 bg-white px-2 py-1">
              {group.members.map((m) => (
                <li key={m.selector} className={`truncate py-0.5 font-mono text-xs ${m.selector === issue.element.selector ? "font-bold text-red-800" : "text-slate-800"}`}>
                  {m.selector === issue.element.selector ? "▸ " : ""}
                  {m.text ? `"${m.text}"` : m.selector}
                  {m.state && m.state.length > 0 && <span className="font-sans font-normal text-slate-600"> ({m.state.join(", ")})</span>}
                </li>
              ))}
            </ul>
            <button type="button" onClick={showGroupFindings} className="mt-1 rounded px-1 text-xs font-medium text-blue-800 hover:bg-blue-50 hover:underline">
              Show every finding of this group
            </button>
          </section>
        )}

        {issue.status !== "new" && (
          <section aria-label="Status" className="mt-3 rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-[13px] text-slate-900">
            <strong>{STATUS_LABEL[issue.status]}.</strong> {issue.reason ? `Reason: ${issue.reason}` : "No reason given."}
          </section>
        )}

        {form && <ReasonForm title={ACTION[form].title} description={ACTION[form].description} submitLabel={ACTION[form].submit} busy={busy} onSubmit={(reason) => void submit(form, reason)} onCancel={() => setForm(null)} />}
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-slate-200 bg-white px-3 py-2">
        <Button variant="primary" size="sm" onClick={() => void viewElement()} disabled={tabId === null}>
          <EyeIcon /> View element
        </Button>
        {group && (
          <Button size="sm" aria-pressed={showPeers} onClick={() => setShowPeers((v) => !v)}>
            {showPeers ? "Hide peers" : "Show peers"}
          </Button>
        )}
        {issue.status === "new" ? (
          (Object.keys(ACTION) as Action[]).map((action) => (
            <Button key={action} size="sm" aria-expanded={form === action} onClick={() => setForm((f) => (f === action ? null : action))} disabled={tabId === null}>
              {ACTION[action].button}
            </Button>
          ))
        ) : (
          <Button size="sm" onClick={() => void submit("new")} disabled={busy || tabId === null}>
            <CheckIcon /> Reopen
          </Button>
        )}
        <label className="ml-auto flex items-center gap-1 whitespace-nowrap text-xs text-slate-700">
          <input type="checkbox" checked={autoHighlight} onChange={(e) => setAutoHighlight(e.target.checked)} />
          Show on page
        </label>
      </footer>
    </article>
  );
}
