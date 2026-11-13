/**
 * The comparison logic every rule shares (PLAN.md, Phase 3):
 *
 *   clear majority   most members agree          -> the others are outliers
 *   pair             two members that differ     -> one finding on the pair, no "expected"
 *   no majority      no value stands out         -> one finding on the group
 */

export interface Entry<V> {
  /** Snapshot index of the element. */
  el: number;
  value: V;
}

export interface Bucket<V> {
  /** How the value is shown, e.g. "16px". */
  label: string;
  entries: Array<Entry<V>>;
}

export type Verdict<V> =
  | { kind: "same" }
  | { kind: "outlier"; expected: Bucket<V>; outliers: Array<Entry<V>>; /** Most members agree and few differ. */ strong: boolean; buckets: Array<Bucket<V>> }
  | { kind: "pair"; buckets: Array<Bucket<V>> }
  | { kind: "noMajority"; buckets: Array<Bucket<V>> };

/** Buckets numbers that are within `tolerance` of the first value of a bucket. */
export function bucketNumbers(entries: Array<Entry<number>>, tolerance: number, label: (value: number) => string): Array<Bucket<number>> {
  const buckets: Array<Bucket<number>> = [];
  for (const entry of entries.slice().sort((a, b) => a.value - b.value)) {
    const last = buckets[buckets.length - 1];
    if (last && entry.value - last.entries[0].value <= tolerance) last.entries.push(entry);
    else buckets.push({ label: label(entry.value), entries: [entry] });
  }
  // The label of a bucket is its most common exact value.
  for (const bucket of buckets) {
    const counts = new Map<number, number>();
    for (const e of bucket.entries) counts.set(e.value, (counts.get(e.value) ?? 0) + 1);
    const [value] = Array.from(counts).sort((a, b) => b[1] - a[1])[0];
    bucket.label = label(value);
  }
  return buckets;
}

/** Buckets values that have the same label. */
export function bucketLabels<V>(entries: Array<Entry<V>>, label: (value: V) => string): Array<Bucket<V>> {
  const buckets = new Map<string, Bucket<V>>();
  for (const entry of entries) {
    const key = label(entry.value);
    const bucket = buckets.get(key);
    if (bucket) bucket.entries.push(entry);
    else buckets.set(key, { label: key, entries: [entry] });
  }
  return Array.from(buckets.values());
}

export function judge<V>(buckets: Array<Bucket<V>>): Verdict<V> {
  if (buckets.length <= 1) return { kind: "same" };
  const sorted = buckets.slice().sort((a, b) => b.entries.length - a.entries.length);
  const total = sorted.reduce((n, b) => n + b.entries.length, 0);
  if (total === 2) return { kind: "pair", buckets: sorted };
  const [top, second] = sorted;
  // A value stands out when more members share it than any other value.
  if (top.entries.length >= 2 && top.entries.length > second.entries.length) {
    const outliers = sorted.slice(1).flatMap((b) => b.entries);
    const strong = top.entries.length > total / 2 && outliers.length <= Math.max(1, Math.floor(total / 4));
    return { kind: "outlier", expected: top, outliers, strong, buckets: sorted };
  }
  return { kind: "noMajority", buckets: sorted };
}

export function valueCounts<V>(buckets: Array<Bucket<V>>): Array<{ value: string; count: number }> {
  return buckets.map((b) => ({ value: b.label, count: b.entries.length }));
}

export function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** "20px", "20.5px": at most one decimal. */
export function px(value: number): string {
  return `${Math.round(value * 10) / 10}px`;
}
