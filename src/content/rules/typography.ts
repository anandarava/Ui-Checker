/**
 * Typography rules: TYP-01 font family, TYP-02 font size, TYP-03 font weight,
 * TYP-05 text colour and link-versus-plain-text.
 *
 * They compare the members of a peer group that carry text of their own.
 * Members in a different state (selected tab, current navigation item) and the
 * member that looks like the active one are left out: they differ on purpose.
 *
 * Two kinds of difference are listed for review instead of as defects:
 *  - a member that differs in several ways at once (size, weight and colour)
 *    is more likely a different kind of element than a mistake;
 *  - a member that differs in colour only: colour often carries a meaning
 *    (a status, the current item).
 */
import type { RawFinding, RuleContext } from "./index";
import { bucketLabels, bucketNumbers, judge, px, valueCounts, type Bucket, type Entry, type Verdict } from "./compare";
import { deltaE } from "./color";

type Pending = Omit<RawFinding, "severity" | "type"> & { severity: RawFinding["severity"] };

interface Check<V> {
  ruleId: string;
  /** What is compared, as shown in the finding. */
  property: string;
  buckets(entries: Array<Entry<V>>): Array<Bucket<V>>;
}

/** Turns the verdict on one property of one group into findings. */
function findingsOf<V>(ctx: RuleContext, check: Check<V>, group: number, verdict: Verdict<V>, total: number): Pending[] {
  const { ruleId, property } = check;
  const name = property.charAt(0).toUpperCase() + property.slice(1);
  if (verdict.kind === "same") return [];
  const values = valueCounts(verdict.buckets);
  const severity = ctx.severity(ruleId, verdict);
  const labelOf = (entry: Entry<V>): string => verdict.buckets.find((b) => b.entries.includes(entry))?.label ?? "";

  if (verdict.kind === "outlier") {
    const expected = verdict.expected.label;
    return verdict.outliers.map((outlier) => {
      const actual = labelOf(outlier);
      const message = `${name} is ${actual}; ${verdict.expected.entries.length} of the ${total} elements in this group use ${expected}.`;
      return { ruleId, element: outlier.el, group, kind: "outlier", severity, property, expected, actual, values, message };
    });
  }

  const list = values.map((v) => (v.count > 1 ? `${v.value} (${v.count})` : v.value)).join(", ");
  const inOrder = verdict.buckets.flatMap((b) => b.entries).sort((a, b) => a.el - b.el);
  if (verdict.kind === "pair") {
    // No telling which of the two is wrong: the finding sits on the second and names both values.
    const second = inOrder[1];
    return [{ ruleId, element: second.el, group, kind: "pair", severity, property, expected: null, actual: labelOf(second), values, message: `${name} differs between these two elements: ${list}.` }];
  }
  const first = inOrder[0];
  return [{ ruleId, element: first.el, group, kind: "noMajority", severity, property, expected: null, actual: labelOf(first), values, message: `${name} has no consistent value in this group: ${list}.` }];
}

/** Buckets colours that are closer than `tolerance` (Delta E) to the first colour of a bucket. */
function bucketColours(entries: Array<Entry<string>>, tolerance: number): Array<Bucket<string>> {
  const buckets: Array<Bucket<string>> = [];
  for (const entry of entries) {
    const bucket = buckets.find((b) => deltaE(b.entries[0].value, entry.value) < tolerance);
    if (bucket) bucket.entries.push(entry);
    else buckets.push({ label: entry.value, entries: [entry] });
  }
  return buckets;
}

export function runTypographyRules(ctx: RuleContext): void {
  const { elements, groups, facts } = ctx;
  const isLink = (i: number): boolean => elements[i].tag === "a" || elements[i].role === "link";

  for (const g of ctx.order) {
    const group = groups[g];
    // The boxes of a level group hold different content; their titles are a group of their own.
    if (group.kind === "level") continue;
    const texts = group.members.filter((i) => elements[i].text !== "");
    if (texts.length < 2 || texts.length * 2 < group.members.length) continue;
    const compared = texts.filter((i) => !facts.inState(i) && i !== group.guessedActive);
    if (compared.length < 2) continue;

    const pending: Pending[] = [];
    const run = <V>(check: Check<V>, value: (i: number) => V): void => {
      if (!ctx.runs(check.ruleId)) return;
      ctx.looked(check.ruleId);
      // A member a larger group already reported is not compared again.
      const entries = compared.filter((i) => !ctx.reported(check.ruleId, i)).map((el) => ({ el, value: value(el) }));
      if (entries.length < 2) return;
      pending.push(...findingsOf(ctx, check, g, judge(check.buckets(entries)), entries.length));
    };

    run<string>({ ruleId: "TYP-01", property: "font family", buckets: (e) => bucketLabels(e, (v) => v) }, (i) => elements[i].style.fontFamily.toLowerCase());
    run<number>({ ruleId: "TYP-02", property: "font size", buckets: (e) => bucketNumbers(e, ctx.tolerance("TYP-02"), px) }, (i) => elements[i].style.fontSize);
    run<number>({ ruleId: "TYP-03", property: "font weight", buckets: (e) => bucketLabels(e, String) }, (i) => elements[i].style.fontWeight);
    run<string>({ ruleId: "TYP-05", property: "text colour", buckets: (e) => bucketColours(e, ctx.tolerance("TYP-05")) }, (i) => elements[i].style.color);
    // A link where its peers have plain text (or the other way round), whatever its colour.
    run<string>({ ruleId: "TYP-05", property: "kind of element", buckets: (e) => bucketLabels(e, (v) => v) }, (i) => (isLink(i) ? "link" : "plain text"));

    const byElement = new Map<number, Pending[]>();
    for (const finding of pending) byElement.set(finding.element, [...(byElement.get(finding.element) ?? []), finding]);
    for (const [, found] of byElement) {
      const rules = new Set(found.map((f) => f.ruleId));
      if (rules.size < 2) {
        const colour = found.find((f) => f.property === "text colour");
        const kind = found.find((f) => f.property === "kind of element");
        if (colour && kind) {
          // A link where its peers have plain text: the colour comes with it.
          ctx.report({ ...colour, message: `This is a ${kind.actual} where its peers are ${kind.expected ?? "something else"}, so its text colour differs too (${colour.actual}).` });
        } else if (colour && colour.kind === "outlier") {
          // Colour alone often carries meaning (a status, the current item): listed for review, not as a defect.
          ctx.report({ ...colour, type: "Review", severity: "Low", message: `${colour.message} A colour on its own may carry a meaning, such as a status or the current item.` });
        } else {
          for (const f of found) ctx.report(f);
        }
        continue;
      }
      // Different in several ways at once: one finding for review, on the first rule.
      const [first] = found;
      const actual = found.map((f) => `${f.property} ${f.actual}`).join(", ");
      const expected = found.every((f) => f.expected) ? found.map((f) => `${f.property} ${f.expected}`).join(", ") : null;
      ctx.report({
        ...first,
        type: "Review",
        severity: "Low",
        property: "typography",
        actual,
        expected,
        message: `This element differs from its peers in several ways at once (${actual}). It may be a different kind of element on purpose.`,
      });
    }
  }
}
