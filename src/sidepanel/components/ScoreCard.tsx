import type { Severity } from "@shared/types";
import { scoreBand } from "@shared/scoring";
import { DEFAULT_FILTERS, SEVERITIES, isNeedsReviewIssue, useStore, type Filters, type ResultTab } from "@src/sidepanel/store";
import { SeverityDonut } from "./SeverityDonut";

/**
 * Severity tile: white card with a coloured left accent. A tile with open issues
 * is tinted and its count takes the severity colour (dark shade, >= 4.5:1 on the tint).
 */
const TILE: Record<Severity, { accent: string; open: string; count: string }> = {
  High: { accent: "border-l-orange-500", open: "border-orange-300 bg-orange-50", count: "text-orange-700" },
  Medium: { accent: "border-l-amber-500", open: "border-amber-300 bg-amber-50", count: "text-amber-800" },
  Low: { accent: "border-l-slate-400", open: "border-slate-300 bg-slate-100", count: "text-slate-800" },
};

const CARD = "rounded-lg border border-slate-200 bg-white";

/** Severity tile beside the donut; a count above zero filters the list. */
function SeverityTile({ sev, value, pressed, onSelect }: { sev: Severity; value: number; pressed: boolean; onSelect(): void }) {
  const base = `block w-full rounded-lg border border-l-4 px-3 py-1.5 text-left ${TILE[sev].accent}`;
  const body = (
    <>
      <span className="block text-[13px] font-semibold leading-tight text-slate-600">{sev}</span>
      <span className={`block text-xl font-bold leading-tight tabular-nums ${value === 0 ? "text-slate-900" : TILE[sev].count}`}>{value}</span>
    </>
  );
  if (value === 0) return <li className={`${base} border-slate-200 bg-white`}>{body}</li>;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={pressed}
        aria-label={`${sev}: ${value}. Show these issues`}
        className={`${base} hover:brightness-95 ${TILE[sev].open} ${pressed ? "ring-2 ring-blue-600 ring-offset-1" : ""}`}
      >
        {body}
      </button>
    </li>
  );
}

interface StatProps {
  value: number;
  label: string;
  hint: string;
  pressed: boolean;
  onSelect(): void;
  /** Accessible name of the button, e.g. "Needs review: 2. Show these findings". */
  name: string;
}

/** One card in the row under the donut: a number that filters the list (or a plain 0), and its label. */
function Stat({ value, label, hint, pressed, onSelect, name }: StatProps) {
  return (
    <li className={`min-w-0 px-3 py-2 ${CARD}`} title={hint}>
      {value === 0 ? (
        <span className="text-lg font-bold tabular-nums text-slate-900">0</span>
      ) : (
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={pressed}
          aria-label={name}
          className={`rounded text-lg font-bold tabular-nums underline-offset-2 hover:underline ${pressed ? "bg-blue-100 px-0.5 text-blue-900" : "text-slate-900"}`}
        >
          {value}
        </button>
      )}
      <span className="block text-[12px] leading-tight text-slate-600">{label}</span>
    </li>
  );
}

/** Lighthouse score bands; the label keeps the meaning from being colour-only. */
const BAND_CLASS: Record<ReturnType<typeof scoreBand>, string> = {
  Good: "border-green-200 bg-green-100 text-green-900",
  "Needs improvement": "border-amber-300 bg-amber-100 text-amber-900",
  Poor: "border-red-300 bg-red-100 text-red-900",
};

export function ScoreCard() {
  const result = useStore((s) => s.result);
  const filters = useStore((s) => s.filters);
  const tab = useStore((s) => s.resultTab);
  const setFilters = useStore((s) => s.setFilters);
  const setResultTab = useStore((s) => s.setResultTab);
  if (!result) return null;

  // Totals: every open, definite finding counts once. Findings for review have their own
  // tab and never count here; ignored, baselined and intentional ones are listed as excluded.
  const counted = result.findings.filter((f) => !isNeedsReviewIssue(f));
  const active = counted.filter((f) => f.status === "new");
  const bySeverity = (s: Severity) => active.filter((f) => f.severity === s).length;
  const { summary } = result;
  const groupsWithIssues = new Set(active.map((f) => f.groupId).filter(Boolean)).size;

  const show = (patch: Partial<Filters>, nextTab: ResultTab = "all") => {
    setFilters({ ...DEFAULT_FILTERS, ...patch });
    setResultTab(nextTab);
  };
  const plain = filters.search === "" && filters.groupId === null;
  const onlySeverity = (s: Severity) => tab === "all" && plain && filters.severities.length === 1 && filters.severities[0] === s && filters.statuses.length === 1 && filters.statuses[0] === "new";
  const excludedPressed = tab === "all" && plain && filters.statuses.length === 3 && !filters.statuses.includes("new");
  const band = scoreBand(result.score);
  const failed = result.rules.filter((r) => r.outcome === "failed").length;
  const passed = result.rules.filter((r) => r.outcome === "passed").length;

  return (
    <section aria-labelledby="summary-heading" className="border-b border-slate-300 px-3 py-2">
      <h2 id="summary-heading" className="sr-only">
        Issue summary
      </h2>
      <div className="rounded-xl bg-slate-50 p-3">
        <div className="flex flex-wrap items-stretch gap-3">
          <div className={`flex shrink-0 items-center justify-center p-3 ${CARD}`}>
            <SeverityDonut
              counts={{ High: bySeverity("High"), Medium: bySeverity("Medium"), Low: bySeverity("Low") }}
              total={active.length}
              onSelectTotal={() => show({})}
              onSelectSeverity={(sev) => show({ severities: [sev] })}
            />
          </div>
          <ul aria-label="Open issues by severity" className="grid min-w-[9rem] flex-1 grid-cols-1 gap-2">
            {SEVERITIES.map((sev) => (
              <SeverityTile key={sev} sev={sev} value={bySeverity(sev)} pressed={onlySeverity(sev)} onSelect={() => show({ severities: [sev] })} />
            ))}
          </ul>
        </div>

        <ul aria-label="More counts" className="mt-3 grid grid-cols-3 gap-3">
          <Stat
            value={groupsWithIssues}
            label={`of ${result.groups.length} peer groups have issues`}
            hint="Groups of elements that should look the same, and how many of them have an open issue"
            pressed={tab === "groups"}
            onSelect={() => show({}, "groups")}
            name={`${groupsWithIssues} of ${result.groups.length} peer groups have issues. Show the peer groups`}
          />
          <Stat
            value={summary.review}
            label="Needs review"
            hint="Differences that are often on purpose (a colour, a featured card); not counted as issues or in the score"
            pressed={tab === "review"}
            onSelect={() => show({}, "review")}
            name={`Needs review: ${summary.review}. Show these findings`}
          />
          <Stat
            value={summary.excluded}
            label="Excluded"
            hint="Findings you ignored, added to the baseline or marked as intentional; not counted in the total"
            pressed={excludedPressed}
            onSelect={() => show({ statuses: ["ignored", "baselined", "intentional"] })}
            name={`Excluded (ignored, baselined or intentional): ${summary.excluded}. Show these findings`}
          />
        </ul>
      </div>

      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-700">
        <span
          className={`inline-flex items-baseline gap-1 rounded-full border px-2.5 py-0.5 font-medium ${BAND_CLASS[band]}`}
          title="Share of the peer groups of this page that are consistent, with more severe issues counting more. Weights: High 7, Medium 3, Low 1. Findings for review and excluded findings do not count."
        >
          Consistency score <strong className="tabular-nums">{result.score}</strong> / 100 · {band}
        </span>
        {failed > 0 ? (
          <span className="rounded-full border border-red-700 bg-white px-2.5 py-0.5 font-semibold text-red-800">
            {failed} rule{failed === 1 ? "" : "s"} failed
          </span>
        ) : (
          <span className="rounded-full border border-green-700 bg-white px-2.5 py-0.5 font-medium text-green-800">No rule failed</span>
        )}
        <span className="font-medium text-green-800">
          <span aria-hidden="true">✓ </span>
          {passed} rules passed
        </span>
      </p>
      {result.notScanned.length > 0 && <p className="mt-1 text-[11px] text-amber-900">Not scanned: {result.notScanned.join(" ")}</p>}
      {result.warnings.length > 0 && <p className="mt-1 text-[11px] text-amber-900">{result.warnings.join(" ")}</p>}
    </section>
  );
}
