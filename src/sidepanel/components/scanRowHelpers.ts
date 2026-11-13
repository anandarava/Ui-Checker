export type ScoreBand = "good" | "fair" | "poor";

export function scoreBand(score: number): ScoreBand {
  return score >= 90 ? "good" : score >= 50 ? "fair" : "poor";
}

/** Splits "<typed> – <date time>" (as made by savedScanName) into its parts; `when` is null if there is no suffix. */
export function splitScanName(name: string): { title: string; when: string | null } {
  const at = name.lastIndexOf(" – ");
  if (at <= 0 || at + 3 >= name.length) return { title: name, when: null };
  return { title: name.slice(0, at), when: name.slice(at + 3) };
}

/** The URL without its scheme, for compact display. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "");
}

function stripHash(url: string): string {
  const i = url.indexOf("#");
  return i === -1 ? url : url.slice(0, i);
}

export function sameUrlIgnoringHash(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b) && stripHash(a as string) === stripHash(b as string);
}
