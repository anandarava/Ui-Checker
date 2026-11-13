import { useId, useMemo } from "react";
import { CATEGORY_LABEL, getRule } from "@shared/rules";
import type { Finding, RuleOutcome, ScanResult } from "@shared/types";
import { PeerGroups } from "./PeerGroups";

/**
 * Plain view of a scan result, used while the engine is being built (Phases
 * 0–3): everything the scan returned, with no filtering or scoring. Phase 4
 * replaces it with the score card, result tabs, issue list and issue detail.
 */

const OUTCOME_LABEL: Record<RuleOutcome, string> = {
  failed: "Failed",
  passed: "Passed",
  notApplicable: "Nothing to check",
  notImplemented: "Not built yet",
  disabled: "Switched off",
};

const OUTCOME_ORDER: RuleOutcome[] = ["failed", "passed", "notApplicable", "notImplemented", "disabled"];

/* Text colours are >= 4.5:1 on their tint. */
const OUTCOME_CHIP: Record<RuleOutcome, string> = {
  failed: "bg-red-100 text-red-900",
  passed: "bg-green-100 text-green-900",
  notApplicable: "bg-slate-100 text-slate-800",
  notImplemented: "bg-amber-100 text-amber-900",
  disabled: "bg-slate-100 text-slate-700",
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-300 bg-white px-3 py-2">
      <dt className="text-xs text-slate-700">{label}</dt>
      <dd className="text-lg font-bold text-slate-900">{value}</dd>
    </div>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  const rule = getRule(finding.ruleId);
  return (
    <li className="border-b border-slate-200 px-3 py-2 last:border-b-0">
      <p className="text-sm font-semibold text-slate-900">
        <span className={`sev-dot sev-${finding.severity === "High" ? "Serious" : finding.severity === "Medium" ? "Moderate" : "Minor"} mr-1.5`} aria-hidden="true" />
        {finding.ruleId} · {rule?.name ?? "Unknown rule"}
        <span className="ml-1.5 font-normal text-slate-700">
          ({finding.severity}
          {finding.type === "Review" ? ", needs review" : ""})
        </span>
      </p>
      <p className="mt-0.5 text-sm text-slate-800">{finding.message}</p>
      <p className="mt-0.5 text-xs text-slate-700">
        {finding.property}: {finding.actual}
        {finding.expected !== null ? `, expected ${finding.expected}` : ""}
      </p>
      <code className="mt-1 block break-all text-xs text-slate-700">{finding.element.selector}</code>
    </li>
  );
}

export function RawResults({ result }: { result: ScanResult }) {
  const id = useId();
  const byOutcome = useMemo(() => {
    const map = new Map<RuleOutcome, string[]>();
    for (const r of result.rules) map.set(r.outcome, [...(map.get(r.outcome) ?? []), r.id]);
    return map;
  }, [result.rules]);

  const definite = result.findings.filter((f) => f.type === "Definite").length;
  const review = result.findings.length - definite;
  const built = result.rules.filter((r) => r.outcome !== "notImplemented" && r.outcome !== "disabled").length;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-3" data-testid="raw-results">
      <section aria-labelledby={`${id}-sum`} className="rounded-xl border border-slate-300 bg-white p-3">
        <h2 id={`${id}-sum`} className="text-sm font-bold text-slate-900">
          Scan result
        </h2>
        <p className="mt-0.5 break-all text-xs text-slate-700">{result.url}</p>
        <dl className="mt-3 grid grid-cols-2 gap-2">
          <Stat label="Elements measured" value={result.elementsScanned} />
          <Stat label="Peer groups" value={result.groups.length} />
          <Stat label="Issues" value={definite} />
          <Stat label="Needs review" value={review} />
        </dl>
        <p className="mt-2 text-xs text-slate-700">
          Scanned in {result.durationMs} ms (page read in {result.timings.snapshotMs} ms, groups found in {result.timings.groupingMs} ms, rules run in {result.timings.rulesMs} ms) · {result.viewport.width} × {result.viewport.height} px · tolerance: {result.options.tolerancePreset}
        </p>
        {built === 0 && (
          <p role="status" className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-slate-800">
            No checks are built yet, so this scan cannot find issues. It shows that the scan runs end to end.
          </p>
        )}
      </section>

      <PeerGroups result={result} />

      <section aria-labelledby={`${id}-find`} className="mt-3 rounded-xl border border-slate-300 bg-white">
        <h2 id={`${id}-find`} className="border-b border-slate-200 px-3 py-2 text-sm font-bold text-slate-900">
          Findings ({result.findings.length})
        </h2>
        {result.findings.length === 0 ? (
          <p className="px-3 py-3 text-sm text-slate-700">No findings.</p>
        ) : (
          <ul>
            {result.findings.map((f) => (
              <FindingRow key={f.id} finding={f} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby={`${id}-rules`} className="mt-3 rounded-xl border border-slate-300 bg-white p-3">
        <h2 id={`${id}-rules`} className="text-sm font-bold text-slate-900">
          Rules ({result.rules.length})
        </h2>
        {OUTCOME_ORDER.filter((o) => byOutcome.has(o)).map((outcome) => (
          <div key={outcome} className="mt-2">
            <h3 className="text-xs font-semibold text-slate-800">
              {OUTCOME_LABEL[outcome]} ({byOutcome.get(outcome)?.length})
            </h3>
            <ul className="mt-1 flex flex-wrap gap-1">
              {byOutcome.get(outcome)?.map((ruleId) => {
                const rule = getRule(ruleId);
                return (
                  <li
                    key={ruleId}
                    title={rule ? `${rule.name} (${CATEGORY_LABEL[rule.category]})` : undefined}
                    className={`rounded px-1.5 py-0.5 text-xs font-medium ${OUTCOME_CHIP[outcome]}`}
                  >
                    {ruleId}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>

      {result.notScanned.length > 0 && (
        <section aria-labelledby={`${id}-skip`} className="mt-3 rounded-xl border border-slate-300 bg-white p-3">
          <h2 id={`${id}-skip`} className="text-sm font-bold text-slate-900">
            Not scanned
          </h2>
          <ul className="mt-1 list-disc pl-5 text-xs text-slate-700">
            {result.notScanned.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>
      )}

      {result.warnings.length > 0 && (
        <section aria-labelledby={`${id}-warn`} className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <h2 id={`${id}-warn`} className="text-sm font-bold text-slate-900">
            Measured before the page was ready
          </h2>
          <ul className="mt-1 list-disc pl-5 text-xs text-slate-800">
            {result.warnings.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>
      )}

      <details className="mt-3 rounded-xl border border-slate-300 bg-white p-3">
        <summary className="text-sm font-bold text-slate-900">Raw data (JSON)</summary>
        <pre className="mt-2 max-h-96 overflow-auto rounded bg-slate-100 p-2 text-xs text-slate-800" data-testid="raw-json">
          {JSON.stringify(result, null, 2)}
        </pre>
      </details>
    </div>
  );
}
