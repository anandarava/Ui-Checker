import { useCallback, useEffect, useId, useState } from "react";
import { sendToTab } from "@shared/messages";
import type { DesignAudit, ScaleFlagKind, ScaleKind, ScaleValue, ScanResult } from "@shared/types";
import { useStore } from "@src/sidepanel/store";

/**
 * The design scale of the page (PLAN.md, Phase 5): the font families, sizes,
 * weights, spacing values and colours it uses, how often, and the values that
 * stand out. Selecting a value outlines every element that uses it.
 *
 * Built like PeerGroups: same card, same rows, same "outline on the page" switch.
 */

const LIST_LABEL: Record<ScaleKind, string> = {
  fontFamily: "Font families",
  fontSize: "Font sizes",
  fontWeight: "Font weights",
  spacing: "Spacing",
  color: "Colours",
};

const FLAG_LABEL: Record<ScaleFlagKind, string> = {
  once: "Used once",
  offGrid: "Off the grid",
  nearDuplicate: "Near-duplicate",
  notToken: "Not a token",
};

/** Values of the scale that stand out, over all lists. */
export function flaggedValues(audit: DesignAudit | undefined): number {
  return audit?.lists.reduce((n, list) => n + list.values.filter((v) => v.flags.length > 0).length, 0) ?? 0;
}

/** Only colours the browser computed are drawn as a swatch. */
function swatch(value: string): string | null {
  return /^rgba?\([\d\s.,%/]+\)$/.test(value) ? value : null;
}

function uses(v: ScaleValue): string {
  return `${v.count} element${v.count === 1 ? "" : "s"}${v.detail ? ` · ${v.detail}` : ""}`;
}

export function DesignScale({ result }: { result: ScanResult }) {
  const id = useId();
  const tabId = useStore((s) => s.tabId);
  const showToast = useStore((s) => s.showToast);
  // The value outlined on the page, as "kind|value".
  const [shown, setShown] = useState<string | null>(null);
  const audit = result.audit;

  // A new scan removes what the last one drew.
  useEffect(() => setShown(null), [result.scanId]);

  const show = useCallback(
    async (kind: ScaleKind, value: string) => {
      if (tabId === null) return;
      const key = `${kind}|${value}`;
      const off = shown === key;
      const res = await sendToTab(tabId, { type: "CS_SHOW_USES", tabId, kind: off ? null : kind, value }, 0);
      if (res.ok) {
        setShown(off ? null : key);
      } else {
        setShown(null);
        showToast({ kind: "error", message: "The page has changed since the scan. Scan again to show where a value is used." });
      }
    },
    [tabId, shown, showToast],
  );

  if (!audit) {
    return <p className="mt-2 rounded-md border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700">This result has no design scale. Scan the page again.</p>;
  }

  const flagged = flaggedValues(audit);

  return (
    <div data-testid="design-scale">
      <p className="px-1 pt-2 text-xs text-slate-700">
        The fonts, sizes, spacing and colours this page uses. Select a value to outline every element that uses it.{" "}
        {audit.tokenFile ? (
          <>
            Checked against the design tokens of <strong className="text-slate-900">{audit.tokenFile}</strong>.
          </>
        ) : (
          <>Values are judged against the page itself; load your design tokens under Rules to check against them.</>
        )}{" "}
        {flagged === 0 ? "No value stands out." : `${flagged} value${flagged === 1 ? " stands" : "s stand"} out.`} These are not counted as issues or in the score.
      </p>
      {audit.lists.map((list) => (
        <section key={list.kind} aria-labelledby={`${id}-${list.kind}`} className="mt-2 rounded-md border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-3 py-2">
            <h2 id={`${id}-${list.kind}`} className="text-sm font-bold text-slate-900">
              {LIST_LABEL[list.kind]} ({list.values.length})
            </h2>
            {list.note && <p className="text-xs text-slate-700">{list.note}</p>}
          </div>
          {list.values.length === 0 ? (
            <p className="px-3 py-3 text-sm text-slate-700">None found on this page.</p>
          ) : (
            <ul className="px-1.5 py-1.5">
              {list.values.map((v) => {
                const on = shown === `${list.kind}|${v.value}`;
                const colour = list.kind === "color" ? swatch(v.value) : null;
                return (
                  <li key={v.value}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => void show(list.kind, v.value)}
                      className={`flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-slate-100 ${on ? "bg-blue-50" : ""}`}
                    >
                      {colour && <span aria-hidden="true" className="mt-px h-4 w-4 shrink-0 rounded border border-slate-400" style={{ background: colour }} />}
                      <span className="min-w-0 flex-1 text-slate-900">
                        <span className="font-semibold">{v.value}</span>
                        {v.token && <span className="text-slate-700"> · {v.token}</span>}
                        <span className="block text-slate-700">{uses(v)}</span>
                        {v.flags.map((flag) => (
                          <span key={flag.kind} className="block text-slate-700">
                            {flag.message}
                          </span>
                        ))}
                      </span>
                      {v.flags.map((flag) => (
                        <span key={flag.kind} className="shrink-0 rounded-full bg-orange-100 px-1.5 text-[11px] font-semibold text-orange-900">
                          {FLAG_LABEL[flag.kind]}
                        </span>
                      ))}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
