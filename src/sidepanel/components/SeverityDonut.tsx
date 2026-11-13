import { useState } from "react";
import type { Severity } from "@shared/types";
import { SEVERITIES } from "@src/sidepanel/store";

const SEVERITY_VAR: Record<Severity, string> = {
  High: "var(--sev-serious)",
  Medium: "var(--sev-moderate)",
  Low: "var(--sev-minor)",
};

const SIZE = 104;
const STROKE = 13;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Surface gap between segments, in px along the ring. */
const GAP = 2;

interface Props {
  counts: Record<Severity, number>;
  total: number;
  /** Clicking the centre (total) clears the filters. */
  onSelectTotal(): void;
  /** Clicking a segment filters to that severity. */
  onSelectSeverity(sev: Severity): void;
}

/**
 * Donut of open issues by severity with the total in the centre. Hovering a
 * segment swaps the centre to that severity's count and clicking it filters.
 * The segments are a pointer-only convenience (the SVG is role="img", so they
 * are not focusable or exposed); the keyboard / screen-reader path to the same
 * filters is the severity tiles next to the chart. Identity is never
 * colour-only: those tiles carry the labels, and the SVG has a text summary.
 */
export function SeverityDonut({ counts, total, onSelectTotal, onSelectSeverity }: Props) {
  const [hover, setHover] = useState<Severity | null>(null);
  const present = SEVERITIES.filter((s) => counts[s] > 0);
  const gap = present.length > 1 ? GAP : 0;

  // Segments start at 12 o'clock and run clockwise, most severe first.
  let offset = 0;
  const segments = present.map((sev) => {
    const length = (counts[sev] / total) * CIRCUMFERENCE;
    const seg = { sev, dash: Math.max(0, length - gap), start: offset };
    offset += length;
    return seg;
  });

  const summary = total === 0 ? "No open issues" : `${total} open issues: ${SEVERITIES.map((s) => `${counts[s]} ${s.toLowerCase()}`).join(", ")}`;
  const shown = hover ? counts[hover] : total;

  return (
    <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={summary}>
        <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="#e2e8f0" strokeWidth={STROKE} />
          {segments.map((s) => (
            <circle
              key={s.sev}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={SEVERITY_VAR[s.sev]}
              strokeWidth={hover === s.sev ? STROKE + 4 : STROKE}
              strokeDasharray={`${s.dash} ${CIRCUMFERENCE - s.dash}`}
              strokeDashoffset={-s.start}
              className="cursor-pointer transition-[stroke-width]"
              onMouseEnter={() => setHover(s.sev)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelectSeverity(s.sev)}
            >
              <title>{`${s.sev}: ${counts[s.sev]} of ${total} (${Math.round((counts[s.sev] / total) * 100)}%)`}</title>
            </circle>
          ))}
        </g>
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        {total > 0 && !hover ? (
          <button
            type="button"
            onClick={onSelectTotal}
            aria-label={`Total issues: ${total}. Show all issues`}
            className="pointer-events-auto rounded px-1 text-[26px] font-bold leading-none tabular-nums text-slate-900 hover:bg-slate-100 hover:underline"
          >
            {shown}
          </button>
        ) : (
          <span className="text-[26px] font-bold leading-none tabular-nums text-slate-900" aria-hidden={hover ? "true" : undefined}>
            {shown}
          </span>
        )}
        <span className="mt-1 text-[11px] text-slate-600" aria-hidden="true">
          {hover ?? "Issues"}
        </span>
      </div>
    </div>
  );
}
