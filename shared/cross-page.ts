/**
 * Cross-page consistency (PLAN.md, Phase 6): the parts the pages of a site
 * share (page title, header, navigation, footer, tab bars) are matched across
 * the scanned pages and compared, the way the members of a peer group are
 * compared on one page: the value most pages have is expected, and the pages
 * that differ are reported.
 *
 * Pure: it works on the scan results alone, so it runs in the service worker,
 * in tests and in CI.
 */
import type { FindingType, ScanResult, Severity, SharedPart } from "./types";

export interface CrossPageValue {
  url: string;
  title: string;
  /** What this page has, as shown. */
  value: string;
  /** Selector of the part on this page. */
  selector: string;
  /** True when this page is one of the pages reported. */
  differs: boolean;
}

export interface CrossPageFinding {
  id: string;
  /** "Page title", "Side navigation"... */
  part: string;
  kind: SharedPart["kind"];
  /** What was compared: "left edge", "font size", "label of item 1". */
  property: string;
  severity: Severity;
  type: FindingType;
  /** What most pages have; null when no value stands out. */
  expected: string | null;
  /** Every page that was compared, with its value. */
  pages: CrossPageValue[];
  message: string;
}

interface Sample {
  result: ScanResult;
  part: SharedPart;
}

interface Check {
  property: string;
  /** The value of a page, or null when the page has nothing to compare. */
  value(part: SharedPart): string | number | null;
  /** Numbers within this distance are the same. */
  tolerance?: number;
  label?(value: string | number): string;
  /** Listed for review whatever the outcome. */
  review?: boolean;
  /** Severity when most pages agree; "Medium" otherwise. */
  severity?: Severity;
}

const px = (v: string | number): string => `${Math.round(Number(v) * 10) / 10}px`;

const TEXT_STYLE: Check[] = [
  { property: "font size", value: (p) => p.style.fontSize, tolerance: 0.5, label: px },
  { property: "font weight", value: (p) => p.style.fontWeight },
  { property: "font family", value: (p) => p.style.fontFamily.toLowerCase(), label: String },
  { property: "text colour", value: (p) => p.style.color, review: true },
];

const CHECKS: Record<SharedPart["kind"], Check[]> = {
  pageTitle: [
    { property: "left edge", value: (p) => p.element.box.x, tolerance: 2, label: px, severity: "High" },
    // The middle, not the top: a title in a larger font is taller, and is reported for its font size.
    { property: "vertical position", value: (p) => p.element.box.y + p.element.box.height / 2, tolerance: 2, label: px, severity: "High" },
    ...TEXT_STYLE.map((c) => (c.property === "font size" ? { ...c, severity: "High" as const } : c)),
  ],
  header: [
    { property: "height", value: (p) => p.element.box.height, tolerance: 2, label: px },
    { property: "background", value: (p) => p.style.backgroundColor },
  ],
  navigation: [
    { property: "left edge", value: (p) => p.element.box.x, tolerance: 2, label: px },
    { property: "top edge", value: (p) => p.element.box.y, tolerance: 2, label: px },
    { property: "width", value: (p) => p.element.box.width, tolerance: 2, label: px },
    { property: "background", value: (p) => p.style.backgroundColor },
    ...TEXT_STYLE.filter((c) => c.property !== "text colour"),
    { property: "number of items", value: (p) => p.items?.length ?? null, review: true },
  ],
  tabs: [
    { property: "height", value: (p) => p.element.box.height, tolerance: 2, label: px },
    ...TEXT_STYLE.filter((c) => c.property !== "text colour"),
  ],
  footer: [
    { property: "height", value: (p) => p.element.box.height, tolerance: 2, label: px },
    { property: "background", value: (p) => p.style.backgroundColor },
  ],
};

interface Bucket {
  label: string;
  samples: Sample[];
  first: string | number;
}

function bucketsOf(samples: Array<Sample & { value: string | number }>, check: Check): Bucket[] {
  const label = check.label ?? String;
  const buckets: Bucket[] = [];
  const sorted = typeof samples[0]?.value === "number" ? samples.slice().sort((a, b) => Number(a.value) - Number(b.value)) : samples;
  for (const s of sorted) {
    const found = buckets.find((b) => (typeof s.value === "number" && typeof b.first === "number" ? Math.abs(s.value - b.first) <= (check.tolerance ?? 0) : b.first === s.value));
    if (found) found.samples.push(s);
    else buckets.push({ label: label(s.value), samples: [s], first: s.value });
  }
  return buckets.sort((a, b) => b.samples.length - a.samples.length);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The pages of a site scan, compared part by part. `results` are the scanned pages in scan order. */
export function crossPageFindings(results: ScanResult[]): CrossPageFinding[] {
  const out: CrossPageFinding[] = [];
  const byKey = new Map<string, Sample[]>();
  for (const result of results) {
    for (const part of result.parts ?? []) {
      const list = byKey.get(part.key);
      if (list) list.push({ result, part });
      else byKey.set(part.key, [{ result, part }]);
    }
  }
  const scanned = results.filter((r) => r.parts !== undefined);

  const report = (samples: Sample[], check: Check, name: string, kind: SharedPart["kind"], valueOf: (s: Sample) => string | number | null): void => {
    const valued = samples.flatMap((s) => {
      const value = valueOf(s);
      return value === null ? [] : [{ ...s, value }];
    });
    if (valued.length < 2) return;
    const buckets = bucketsOf(valued, check);
    if (buckets.length < 2) return;
    const [top, second] = buckets;
    const total = valued.length;
    const majority = total > 2 && top.samples.length >= 2 && top.samples.length > second.samples.length;
    const odd = new Set(majority ? buckets.slice(1).flatMap((b) => b.samples) : valued);
    const labelOf = (s: Sample): string => buckets.find((b) => b.samples.includes(s))?.label ?? "";
    const strong = majority && top.samples.length >= total * 0.75;
    const what = `${name} ${check.property}`;
    let message: string;
    if (majority) {
      const others = buckets.slice(1);
      message = `${what} is ${others.map((b) => `${b.label} on ${plural(b.samples.length, "page", "pages")}`).join(" and ")}; ${top.samples.length} of the ${total} pages have ${top.label}.`;
    } else if (total === 2) {
      message = `${what} differs between the two pages: ${buckets.map((b) => b.label).join(" and ")}.`;
    } else {
      message = `${what} has no consistent value across the pages: ${buckets.map((b) => `${b.label} (${b.samples.length})`).join(", ")}.`;
    }
    out.push({
      id: `${samples[0].part.key}|${check.property}`,
      part: name,
      kind,
      property: check.property,
      severity: check.review ? "Low" : strong ? (check.severity ?? "Medium") : "Medium",
      type: check.review ? "Review" : "Definite",
      expected: majority ? top.label : null,
      pages: valued.map((s) => ({ url: s.result.url, title: s.result.title, value: labelOf(s), selector: s.part.element.selector, differs: odd.has(s) })),
      message: check.review ? `${message} This may be on purpose.` : message,
    });
  };

  for (const [, samples] of byKey) {
    const { kind, name } = samples[0].part;

    // A part most pages have and a few do not.
    const missing = scanned.filter((r) => !samples.some((s) => s.result === r));
    if (scanned.length >= 4 && missing.length > 0 && samples.length >= scanned.length * 0.75) {
      out.push({
        id: `${samples[0].part.key}|presence`,
        part: name,
        kind,
        property: "presence",
        severity: "Low",
        type: "Review",
        expected: "present",
        pages: [
          ...samples.map((s) => ({ url: s.result.url, title: s.result.title, value: "present", selector: s.part.element.selector, differs: false })),
          ...missing.map((r) => ({ url: r.url, title: r.title, value: "not found", selector: "", differs: true })),
        ],
        message: `${name} was not found on ${plural(missing.length, "page", "pages")}; ${samples.length} of the ${scanned.length} pages have one. This may be on purpose.`,
      });
    }
    if (samples.length < 2) continue;

    for (const check of CHECKS[kind]) report(samples, check, name, kind, (s) => check.value(s.part));

    // The same item on every page: does it show a label, does it show an icon?
    const counts = new Set(samples.map((s) => s.part.items?.length ?? 0));
    const length = [...counts][0] ?? 0;
    if (counts.size !== 1 || length === 0) continue;
    for (let i = 0; i < length; i++) {
      const named = samples.map((s) => s.part.items?.[i]?.text ?? "").find(Boolean);
      const item = `item ${i + 1}${named ? ` ("${named.slice(0, 24)}")` : ""}`;
      report(samples, { property: `label of ${item}`, value: () => null }, name, kind, (s) => (s.part.items?.[i]?.text ? "shown" : "not shown"));
      report(samples, { property: `icon of ${item}`, value: () => null }, name, kind, (s) => (s.part.items?.[i]?.icon ? "shown" : "not shown"));
    }
  }

  // Definite findings first, then by part, in the order the parts were found.
  return out.sort((a, b) => Number(a.type === "Review") - Number(b.type === "Review"));
}
