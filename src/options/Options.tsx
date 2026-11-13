import { useEffect, useState } from "react";
import { CATALOGUE_VERSION, CATEGORY_LABEL, RULES, toleranceFor } from "@shared/rules";
import { STORAGE_SETTINGS } from "@shared/constants";
import { DEFAULT_SETTINGS, type RuleCategory, type RuleDef, type Settings } from "@shared/types";

/**
 * Options page. Phase 0 has the Rules section only: every rule of the
 * catalogue with an on/off switch. Phase 4 adds the other sections of the
 * PalTech Accessibility Testing options page (General, Baselines,
 * Import/Export, Privacy, organisation and "Prepared by").
 */

const CATEGORIES: RuleCategory[] = ["typography", "layout", "group", "box"];

const UNIT_LABEL = { px: "px", ratio: "× larger", deltaE: "colour difference (ΔE)", exact: "" } as const;

function toleranceText(rule: RuleDef, settings: Settings): string {
  const value = toleranceFor(rule, settings.tolerancePreset);
  if (value === undefined || !rule.tolerance) return "Exact match";
  return `${Number(value.toFixed(2))} ${UNIT_LABEL[rule.tolerance.unit]}`;
}

export function Options() {
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    chrome.storage.sync
      .get(STORAGE_SETTINGS)
      .then((stored) => setSettings({ ...DEFAULT_SETTINGS, ...((stored[STORAGE_SETTINGS] as Partial<Settings> | undefined) ?? {}) }))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const toggle = async (ruleId: string, on: boolean): Promise<void> => {
    const off = new Set(settings.disabledRules);
    if (on) off.delete(ruleId);
    else off.add(ruleId);
    const next = { ...settings, disabledRules: [...off].sort() };
    setSettings(next);
    try {
      await chrome.storage.sync.set({ [STORAGE_SETTINGS]: next });
      chrome.runtime.sendMessage({ type: "SETTINGS_CHANGED" }).catch(() => undefined);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-bold text-slate-900">PalTech UI Consistency Checker</h1>
      <p className="mt-1 text-sm text-slate-700">
        Rules · catalogue version {CATALOGUE_VERSION} · tolerances shown for the “{settings.tolerancePreset}” preset
      </p>
      {error && (
        <p role="alert" className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          Could not save the setting: {error}
        </p>
      )}

      {CATEGORIES.map((category) => (
        <section key={category} aria-labelledby={`cat-${category}`} className="mt-5 rounded-xl border border-slate-300 bg-white">
          <h2 id={`cat-${category}`} className="border-b border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-900">
            {CATEGORY_LABEL[category]}
          </h2>
          <ul>
            {RULES.filter((r) => r.category === category).map((rule) => (
              <li key={rule.id} className="flex items-start gap-3 border-b border-slate-200 px-4 py-3 last:border-b-0">
                <input
                  id={`rule-${rule.id}`}
                  type="checkbox"
                  className="mt-1"
                  checked={!settings.disabledRules.includes(rule.id)}
                  onChange={(e) => void toggle(rule.id, e.target.checked)}
                />
                <div className="min-w-0 flex-1">
                  <label htmlFor={`rule-${rule.id}`} className="text-sm font-semibold text-slate-900">
                    {rule.id} · {rule.name}
                  </label>
                  <p className="mt-0.5 text-sm text-slate-700">{rule.description}</p>
                  <p className="mt-1 text-xs text-slate-700">
                    Severity: {rule.severity} · Tolerance: {toleranceText(rule, settings)}
                    {!rule.implemented && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-900">Not built yet</span>
                    )}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
