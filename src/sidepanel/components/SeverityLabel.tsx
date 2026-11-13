import type { JSX } from "react";
import type { Finding, FindingStatus, Severity } from "@shared/types";
import { isNeedsReviewIssue } from "@src/sidepanel/store";

/**
 * Severity indicator: coloured dot + text, so meaning is never colour-only.
 * Findings for review are labelled as such, mirroring the score card and the overlay colours.
 */
export function SeverityLabel({ issue, className = "" }: { issue: Finding; className?: string }) {
  const review = isNeedsReviewIssue(issue);
  const dotClass = review ? "sev-review" : `sev-${issue.severity}`;
  const text = review ? `Needs review (${issue.severity})` : issue.severity;
  return (
    <span className={`inline-flex items-center gap-1 text-xs text-slate-700 ${className}`}>
      <span className={`sev-dot ${dotClass}`} aria-hidden="true" />
      {text}
    </span>
  );
}

/** Small tinted severity badge (text on a light tint, >= 4.5:1); the word keeps it from being colour-only. */
const SEVERITY_BADGE: Record<Severity, string> = {
  High: "border-orange-200 bg-orange-50 text-orange-900",
  Medium: "border-yellow-300 bg-yellow-50 text-yellow-900",
  Low: "border-slate-200 bg-slate-100 text-slate-800",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`inline-flex items-center rounded-full border px-1.5 py-px text-[11px] font-medium leading-4 ${SEVERITY_BADGE[severity]}`}>{severity}</span>;
}

const STATUS_STYLE: Record<Exclude<FindingStatus, "new">, { label: string; className: string; icon: JSX.Element }> = {
  ignored: {
    label: "Ignored",
    className: "border-slate-300 bg-slate-100 text-slate-700",
    // Eye with a slash: hidden from the totals.
    icon: (
      <>
        <path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4Z" />
        <circle cx="8" cy="8" r="1.8" />
        <path d="M3 13 13 3" />
      </>
    ),
  },
  baselined: {
    label: "Baselined",
    className: "border-sky-300 bg-sky-50 text-sky-900",
    // Check in a circle: known and accepted.
    icon: (
      <>
        <circle cx="8" cy="8" r="5.5" />
        <path d="m5.6 8.1 1.6 1.6 3.2-3.3" />
      </>
    ),
  },
  intentional: {
    label: "Intentional",
    className: "border-green-300 bg-green-50 text-green-900",
    icon: <path d="m3.5 8.3 3 3 6-6.3" />,
  },
};

export const STATUS_LABEL: Record<FindingStatus, string> = { new: "Open", ignored: "Ignored", baselined: "Baselined", intentional: "Intentional" };

/** Pill for findings that are excluded from the totals (ignored / baselined / intentional). Nothing for open findings. */
export function StatusLabel({ status }: { status: FindingStatus }) {
  if (status === "new") return null;
  const s = STATUS_STYLE[status];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-px text-[11px] font-medium leading-4 ${s.className}`}>
      <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {s.icon}
      </svg>
      {s.label}
    </span>
  );
}
