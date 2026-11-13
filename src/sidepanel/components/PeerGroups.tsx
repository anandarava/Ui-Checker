import { useCallback, useEffect, useId, useState } from "react";
import { sendToTab } from "@shared/messages";
import type { PeerGroup, PeerGroupKind, ScanResult } from "@shared/types";
import { useStore } from "@src/sidepanel/store";
import { Button } from "./Button";
import { EyeIcon } from "./icons";

/**
 * The peer groups a scan found, with a switch that colours them on the page
 * (PLAN.md, Phase 2 step 7): testers can see what the tool treats as "the
 * same" before any rule compares them.
 */

const KIND_LABEL: Record<PeerGroupKind, string> = {
  sibling: "Side by side",
  cousin: "Across lists",
  role: "Same part",
  level: "Same level",
};

/** What is drawn on the page: nothing, every group, or one group. */
type Shown = "none" | "all" | string;

function memberNote(group: PeerGroup): string {
  const states = group.members.filter((m) => m.state && m.state.length > 0).length;
  return states > 0 ? ` · ${states} in a different state` : "";
}

export function PeerGroups({ result }: { result: ScanResult }) {
  const id = useId();
  const tabId = useStore((s) => s.tabId);
  const showToast = useStore((s) => s.showToast);
  const [shown, setShown] = useState<Shown>("none");

  // A new scan removes what the last one drew.
  useEffect(() => setShown("none"), [result.scanId]);

  const show = useCallback(
    async (next: Shown) => {
      if (tabId === null) return;
      const groupIds = next === "none" ? [] : next === "all" ? null : [next];
      const res = await sendToTab(tabId, { type: "CS_SHOW_GROUPS", tabId, groupIds }, 0);
      if (res.ok) {
        setShown(next);
      } else {
        setShown("none");
        showToast({ kind: "error", message: "The page has changed since the scan. Scan again to show the groups." });
      }
    },
    [tabId, showToast],
  );

  return (
    <section aria-labelledby={`${id}-groups`} className="mt-3 rounded-xl border border-slate-300 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
        <h2 id={`${id}-groups`} className="text-sm font-bold text-slate-900">
          Peer groups ({result.groups.length})
        </h2>
        {result.groups.length > 0 && (
          <Button size="sm" aria-pressed={shown === "all"} onClick={() => void show(shown === "all" ? "none" : "all")}>
            <EyeIcon /> {shown === "all" ? "Hide on page" : "Show all on page"}
          </Button>
        )}
      </div>
      {result.groups.length === 0 ? (
        <p className="px-3 py-3 text-sm text-slate-700">No elements that repeat were found on this page.</p>
      ) : (
        <>
          <p className="px-3 pt-2 text-xs text-slate-700">Elements the scan treats as the same kind of thing. Select a group to outline its members on the page.</p>
          <ul className="max-h-80 overflow-y-auto px-1.5 py-1.5" data-testid="peer-groups">
            {result.groups.map((group, index) => {
              const on = shown === group.id;
              return (
                <li key={group.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => void show(on ? "none" : group.id)}
                    className={`flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-slate-100 ${on ? "bg-blue-50" : ""}`}
                  >
                    <span className="mt-px shrink-0 rounded bg-slate-200 px-1 font-semibold text-slate-800">G{index + 1}</span>
                    <span className="min-w-0 flex-1 text-slate-900">
                      {group.label}
                      <span className="block text-slate-700">
                        {KIND_LABEL[group.kind]}
                        {memberNote(group)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
