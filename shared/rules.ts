/**
 * Typed access to the rule catalogue. The same file (ui-rules.json) drives the
 * extension, the options page, the reports and the CI checks.
 */
import catalogue from "./ui-rules.json";
import { PRESET_FACTOR, type RuleCategory, type RuleDef, type Settings, type TolerancePreset } from "./types";

export const RULES: readonly RuleDef[] = catalogue.rules as RuleDef[];

export const CATALOGUE_VERSION: string = catalogue.version;

const BY_ID = new Map(RULES.map((r) => [r.id, r]));

export function getRule(id: string): RuleDef | undefined {
  return BY_ID.get(id);
}

export const CATEGORY_LABEL: Record<RuleCategory, string> = {
  typography: "Typography",
  layout: "Layout & spacing",
  group: "Group structure",
  box: "Box style",
};

/** The tolerance a rule uses under a preset; undefined for exact-match rules. */
export function toleranceFor(rule: RuleDef, preset: TolerancePreset): number | undefined {
  if (!rule.tolerance || rule.tolerance.unit === "exact") return undefined;
  const factor = PRESET_FACTOR[preset];
  // A ratio tolerance is "how many times larger": scale the part above 1, so Strict never drops below 1.
  if (rule.tolerance.unit === "ratio") return 1 + (rule.tolerance.value - 1) * factor;
  return rule.tolerance.value * factor;
}

/** Rules a scan runs: enabled in the catalogue, not switched off by the user, and (when given) asked for. */
export function rulesToRun(settings: Pick<Settings, "disabledRules">, only: string[] = []): RuleDef[] {
  const off = new Set(settings.disabledRules);
  const wanted = only.length > 0 ? new Set(only) : null;
  return RULES.filter((r) => r.enabled && !off.has(r.id) && (!wanted || wanted.has(r.id)));
}
