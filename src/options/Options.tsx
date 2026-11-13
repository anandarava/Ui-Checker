import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CATALOGUE_VERSION, CATEGORY_LABEL, RULES, toleranceFor } from "@shared/rules";
import { STORAGE_SETTINGS, STORAGE_STATUS_PREFIX } from "@shared/constants";
import { DEFAULT_SETTINGS, type RuleCategory, type RuleDef, type Settings, type StoredStatus, type TolerancePreset } from "@shared/types";

/**
 * Options page, with the sections of the PalTech Accessibility Testing
 * options page: General (tolerance, group size, organisation and "Prepared
 * by"), Rules (on/off and tolerance per rule), Baselines (what was ignored,
 * baselined or marked intentional, per site), Import / Export and Privacy.
 */

const CATEGORIES: RuleCategory[] = ["typography", "layout", "group", "box"];
const UNIT_LABEL = { px: "px", ratio: "× larger", deltaE: "ΔE", exact: "" } as const;
const PRESETS: Array<{ value: TolerancePreset; label: string; hint: string }> = [
  { value: "strict", label: "Strict", hint: "Half the default tolerances (1 px for most layout rules)" },
  { value: "normal", label: "Normal", hint: "The default tolerances (2 px for most layout rules)" },
  { value: "relaxed", label: "Relaxed", hint: "Twice the default tolerances (4 px for most layout rules)" },
];
const STATUS_LABEL: Record<StoredStatus["status"], string> = { ignored: "Ignored", baselined: "Baselined", intentional: "Intentional" };

const CARD = "mt-5 rounded-xl border border-slate-300 bg-white";
const CARD_TITLE = "border-b border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-900";
const INPUT = "rounded border border-slate-500 bg-white px-2 py-1 text-sm text-slate-900";
const BUTTON = "rounded-md border border-slate-500 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50";

type Statuses = Record<string, Record<string, StoredStatus>>;

function presetTolerance(rule: RuleDef, settings: Settings): string {
  const value = toleranceFor(rule, settings.tolerancePreset);
  return value === undefined ? "" : String(Number(value.toFixed(2)));
}

function download(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function Options() {
  const id = useId();
  const [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS });
  const [statuses, setStatuses] = useState<Statuses>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadStatuses = useCallback(async () => {
    const all = await chrome.storage.local.get(null);
    const out: Statuses = {};
    for (const [key, value] of Object.entries(all)) {
      if (key.startsWith(STORAGE_STATUS_PREFIX) && value && typeof value === "object") out[key.slice(STORAGE_STATUS_PREFIX.length)] = value as Record<string, StoredStatus>;
    }
    setStatuses(out);
  }, []);

  useEffect(() => {
    chrome.storage.sync
      .get(STORAGE_SETTINGS)
      .then((stored) => setSettings({ ...DEFAULT_SETTINGS, ...((stored[STORAGE_SETTINGS] as Partial<Settings> | undefined) ?? {}) }))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    void loadStatuses();
  }, [loadStatuses]);

  const save = async (next: Settings): Promise<void> => {
    setSettings(next);
    try {
      await chrome.storage.sync.set({ [STORAGE_SETTINGS]: next });
      chrome.runtime.sendMessage({ type: "SETTINGS_CHANGED" }).catch(() => undefined);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const toggle = (ruleId: string, on: boolean): Promise<void> => {
    const off = new Set(settings.disabledRules);
    if (on) off.delete(ruleId);
    else off.add(ruleId);
    return save({ ...settings, disabledRules: [...off].sort() });
  };

  const setTolerance = (ruleId: string, raw: string): Promise<void> => {
    const ruleTolerances = { ...settings.ruleTolerances };
    const value = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(value) || value < 0) delete ruleTolerances[ruleId];
    else ruleTolerances[ruleId] = value;
    return save({ ...settings, ruleTolerances });
  };

  const removeStatus = async (origin: string, fingerprint?: string): Promise<void> => {
    const key = `${STORAGE_STATUS_PREFIX}${origin}`;
    if (fingerprint === undefined) {
      await chrome.storage.local.remove(key);
    } else {
      const entries = { ...(statuses[origin] ?? {}) };
      delete entries[fingerprint];
      if (Object.keys(entries).length === 0) await chrome.storage.local.remove(key);
      else await chrome.storage.local.set({ [key]: entries });
    }
    await loadStatuses();
    setNotice("Removed. The findings are open again the next time the page is scanned.");
  };

  const exportAll = (): void => {
    download("ui-consistency-checker-settings.json", JSON.stringify({ tool: "PalTech UI Consistency Checker", exportedAt: new Date().toISOString(), settings, statuses }, null, 2) + "\n");
  };

  const importAll = async (file: File): Promise<void> => {
    try {
      const data = JSON.parse(await file.text()) as { settings?: Partial<Settings>; statuses?: Statuses };
      if (!data || typeof data !== "object" || (!data.settings && !data.statuses)) throw new Error("This file has no settings or baselines of this extension.");
      if (data.settings) await save({ ...DEFAULT_SETTINGS, ...data.settings });
      if (data.statuses) {
        for (const [origin, entries] of Object.entries(data.statuses)) {
          if (entries && typeof entries === "object") await chrome.storage.local.set({ [`${STORAGE_STATUS_PREFIX}${origin}`]: entries });
        }
        await loadStatuses();
      }
      setNotice("Settings and baselines imported.");
      setError(null);
    } catch (e) {
      setError(`Could not import the file: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const origins = Object.keys(statuses).sort();

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-bold text-slate-900">PalTech UI Consistency Checker</h1>
      <p className="mt-1 text-sm text-slate-700">Settings · rule catalogue version {CATALOGUE_VERSION}</p>
      {error && (
        <p role="alert" className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900">
          {notice}
        </p>
      )}

      <section aria-labelledby={`${id}-general`} className={CARD}>
        <h2 id={`${id}-general`} className={CARD_TITLE}>
          General
        </h2>
        <div className="space-y-4 px-4 py-3">
          <fieldset>
            <legend className="text-sm font-semibold text-slate-900">Tolerance</legend>
            <p className="text-xs text-slate-700">How far a value may be from its peers before it is reported. A tolerance set for one rule below overrides the preset.</p>
            <div className="mt-1.5 space-y-1">
              {PRESETS.map((p) => (
                <label key={p.value} className="flex items-start gap-2 text-sm text-slate-900">
                  <input type="radio" name={`${id}-preset`} className="mt-1" checked={settings.tolerancePreset === p.value} onChange={() => void save({ ...settings, tolerancePreset: p.value })} />
                  <span>
                    {p.label} <span className="text-xs text-slate-700">· {p.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor={`${id}-min`} className="block text-sm font-semibold text-slate-900">
              Minimum group size
            </label>
            <p className="text-xs text-slate-700">Elements are compared only in groups of at least this many. 2 also compares pairs; 3 needs a majority.</p>
            <input
              id={`${id}-min`}
              type="number"
              min={2}
              max={10}
              value={settings.minGroupSize}
              onChange={(e) => void save({ ...settings, minGroupSize: Math.max(2, Math.min(10, Number(e.target.value) || 2)) })}
              className={`mt-1 w-20 ${INPUT}`}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-org`} className="block text-sm font-semibold text-slate-900">
                Organisation
              </label>
              <p className="text-xs text-slate-700">Client or company, shown on HTML reports.</p>
              <input id={`${id}-org`} type="text" value={settings.reportOrganisation} onChange={(e) => void save({ ...settings, reportOrganisation: e.target.value })} className={`mt-1 w-full ${INPUT}`} />
            </div>
            <div>
              <label htmlFor={`${id}-by`} className="block text-sm font-semibold text-slate-900">
                Prepared by
              </label>
              <p className="text-xs text-slate-700">Your name or team, shown on HTML reports.</p>
              <input id={`${id}-by`} type="text" value={settings.reportPreparedBy} onChange={(e) => void save({ ...settings, reportPreparedBy: e.target.value })} className={`mt-1 w-full ${INPUT}`} />
            </div>
          </div>
        </div>
      </section>

      <h2 className="mt-6 text-base font-bold text-slate-900">Rules</h2>
      <p className="text-sm text-slate-700">Switch rules on or off and set a tolerance of your own. An empty tolerance uses the “{settings.tolerancePreset}” preset.</p>
      {CATEGORIES.map((category) => (
        <section key={category} aria-labelledby={`cat-${category}`} className={CARD}>
          <h3 id={`cat-${category}`} className={CARD_TITLE}>
            {CATEGORY_LABEL[category]}
          </h3>
          <ul>
            {RULES.filter((r) => r.category === category).map((rule) => {
              const tunable = rule.tolerance && rule.tolerance.unit !== "exact";
              const custom = settings.ruleTolerances[rule.id];
              return (
                <li key={rule.id} className="flex items-start gap-3 border-b border-slate-200 px-4 py-3 last:border-b-0">
                  <input id={`rule-${rule.id}`} type="checkbox" className="mt-1" checked={!settings.disabledRules.includes(rule.id)} onChange={(e) => void toggle(rule.id, e.target.checked)} />
                  <div className="min-w-0 flex-1">
                    <label htmlFor={`rule-${rule.id}`} className="text-sm font-semibold text-slate-900">
                      {rule.id} · {rule.name}
                    </label>
                    <p className="mt-0.5 text-sm text-slate-700">{rule.description}</p>
                    <p className="mt-1 text-xs text-slate-700">
                      Severity: {rule.severity}
                      {!tunable && " · Exact match"}
                      {!rule.implemented && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-900">Not built yet</span>}
                    </p>
                  </div>
                  {tunable && rule.tolerance && (
                    <div className="shrink-0 text-right">
                      <label htmlFor={`tol-${rule.id}`} className="block text-xs font-medium text-slate-800">
                        Tolerance ({UNIT_LABEL[rule.tolerance.unit]})
                      </label>
                      <input
                        id={`tol-${rule.id}`}
                        type="number"
                        min={0}
                        step="any"
                        value={custom ?? ""}
                        placeholder={presetTolerance(rule, settings)}
                        onChange={(e) => void setTolerance(rule.id, e.target.value)}
                        aria-label={`Tolerance of ${rule.id} in ${UNIT_LABEL[rule.tolerance.unit]}; empty uses the preset (${presetTolerance(rule, settings)})`}
                        className={`mt-0.5 w-20 text-right ${INPUT}`}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <section aria-labelledby={`${id}-baselines`} className={CARD}>
        <h2 id={`${id}-baselines`} className={CARD_TITLE}>
          Baselines
        </h2>
        <div className="px-4 py-3">
          <p className="text-sm text-slate-700">Findings you ignored, added to the baseline or marked as intentional, per site. They stay out of the totals and the score until you remove them here or reopen them in the panel.</p>
          {origins.length === 0 && <p className="mt-2 text-sm text-slate-700">Nothing is excluded on any site.</p>}
          {origins.map((origin) => {
            const entries = Object.values(statuses[origin] ?? {});
            return (
              <div key={origin} className="mt-3 rounded-lg border border-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5">
                  <h3 className="break-all text-sm font-semibold text-slate-900">
                    {origin} <span className="font-normal text-slate-700">({entries.length})</span>
                  </h3>
                  <button type="button" className={BUTTON} onClick={() => void removeStatus(origin)}>
                    Remove all for this site
                  </button>
                </div>
                <ul>
                  {entries.map((entry) => (
                    <li key={entry.fingerprint} className="flex items-start gap-3 border-b border-slate-100 px-3 py-2 last:border-b-0">
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="text-slate-900">
                          <span className="font-mono text-xs">{entry.ruleId}</span> · {STATUS_LABEL[entry.status]} · <span className="text-xs text-slate-700">{new Date(entry.createdAt).toLocaleDateString()}</span>
                        </p>
                        <code className="block break-all font-mono text-xs text-slate-700">{entry.selector}</code>
                        {entry.reason && <p className="text-xs text-slate-700">Reason: {entry.reason}</p>}
                      </div>
                      <button type="button" className={BUTTON} onClick={() => void removeStatus(origin, entry.fingerprint)} aria-label={`Remove ${entry.ruleId} on ${entry.selector}`}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      <section aria-labelledby={`${id}-io`} className={CARD}>
        <h2 id={`${id}-io`} className={CARD_TITLE}>
          Import / Export
        </h2>
        <div className="px-4 py-3">
          <p className="text-sm text-slate-700">Share the settings and baselines with your team as one JSON file, or load a file a colleague exported.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={BUTTON} onClick={exportAll}>
              Export settings and baselines
            </button>
            <button type="button" className={BUTTON} onClick={() => fileRef.current?.click()}>
              Import from a file…
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              aria-label="Settings file to import"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importAll(file);
                e.target.value = "";
              }}
            />
            <button type="button" className={BUTTON} onClick={() => void save({ ...DEFAULT_SETTINGS })}>
              Reset settings to defaults
            </button>
          </div>
        </div>
      </section>

      <section aria-labelledby={`${id}-privacy`} className={CARD}>
        <h2 id={`${id}-privacy`} className={CARD_TITLE}>
          Privacy
        </h2>
        <div className="space-y-1.5 px-4 py-3 text-sm text-slate-700">
          <p>
            <strong className="text-slate-900">Nothing leaves your machine.</strong> Pages are scanned in your browser. The extension sends no page content, screenshots, results or usage data to any server.
          </p>
          <p>Results are kept for the browser session only. Settings are kept in your browser profile (and synced by Chrome if you use sync). Baselines are kept in this browser.</p>
          <p>Reports are built on your machine and saved where you choose. Screenshots in a report show the page as it was on your screen: check them before sharing a report outside your team.</p>
        </div>
      </section>
    </div>
  );
}
