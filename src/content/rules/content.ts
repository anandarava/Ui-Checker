/**
 * Rules about the text itself (PLAN.md, Phase 5):
 *
 *   TYP-07  links that are styled as links but not all the same way
 *   TXT-01  text that runs out of its box, or is cut off with no ellipsis
 *   TXT-02  text shortened by the browser with nothing that holds the full text
 *   TXT-03  peers that shorten their text in different ways
 *   FMT-01  values of one column or list field written in different formats
 *
 * TXT-01, TXT-02 and the loose links of TYP-07 are page-wide: they are not
 * about one peer group. Everything is read from the snapshot.
 */
import type { ElementSnapshot } from "../snapshot";
import type { RuleContext } from "./index";
import { bucketLabels, judge, px, valueCounts, type Bucket, type Entry } from "./compare";
import { deltaE } from "./color";
import { bucketColours, findingsOf } from "./typography";

// ---------------------------------------------------------------------------
// How a text is shortened
// ---------------------------------------------------------------------------

const TYPED_ELLIPSIS = /(\.{3,}|…)\s*$/u;
const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * The ellipsis typed at the end of a text, described by how it is written:
 * the mark itself, whether a space comes before it, and whether it follows a
 * word or a separator left dangling (" - ..."). Null when the text does not
 * end in an ellipsis.
 */
export function typedEllipsis(tail: string): string | null {
  const match = TYPED_ELLIPSIS.exec(tail);
  if (!match) return null;
  const before = tail.slice(0, match.index);
  if (before.trim() === "") return null;
  const mark = match[1].startsWith(".") ? "..." : "…";
  const space = /\s$/.test(before);
  const last = before.trimEnd().slice(-1);
  return `typed "${space ? " " : ""}${mark}"${WORD_CHAR.test(last) ? "" : " after a separator"}`;
}

const BY_BROWSER = "shortened by the browser";

// ---------------------------------------------------------------------------
// Value formats
// ---------------------------------------------------------------------------

const MONTH = "(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)";
const WEEKDAY = /^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\.?,?\s+/i;
const MONTH_FIRST = new RegExp(`^${MONTH}(\\.?)\\s+\\d{1,2}(st|nd|rd|th)?(?:(,?)\\s+(\\d{4}|\\d{2}))?$`, "i");
const DAY_FIRST = new RegExp(`^\\d{1,2}(st|nd|rd|th)?\\s+${MONTH}(\\.?)(?:(,?)\\s+(\\d{4}|\\d{2}))?$`, "i");
const MONTH_YEAR = new RegExp(`^${MONTH}(\\.?)\\s+(\\d{4})$`, "i");

export type ValueType = "date" | "time" | "number" | "words";

export interface ValueFormat {
  type: ValueType;
  /** The pattern, as shown: "DD/MM/YYYY", "Mon D, YYYY", "# %", "UPPER CASE". */
  format: string;
  /** Numbers only: the unit or currency written with the number, lower case; "" when there is none. */
  unit?: string;
  /** Numbers only: the value, for the thousands check. */
  amount?: number;
  /** Numbers only: how thousands are written, when the number is large enough to tell. */
  thousands?: string;
}

function monthName(name: string): string {
  return name.length <= 4 && name.toLowerCase() !== "june" && name.toLowerCase() !== "july" ? "Mon" : "Month";
}

function dateFormat(text: string): string | null {
  const s = text.replace(WEEKDAY, "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return "YYYY-MM-DD";
  let m = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2})$/.exec(s);
  if (m) return `DD${m[2]}MM${m[2]}${m[4].length === 4 ? "YYYY" : "YY"}`;
  m = /^(\d{4})([/.])(\d{1,2})\2(\d{1,2})$/.exec(s);
  if (m) return `YYYY${m[2]}MM${m[2]}DD`;
  m = MONTH_FIRST.exec(s);
  if (m) return `${monthName(m[1])}${m[2]} D${m[3] ? "th" : ""}${m[5] ? `${m[4]} ${m[5].length === 4 ? "YYYY" : "YY"}` : ""}`;
  m = DAY_FIRST.exec(s);
  if (m) return `D${m[1] ? "th" : ""} ${monthName(m[2])}${m[3]}${m[5] ? `${m[4]} ${m[5].length === 4 ? "YYYY" : "YY"}` : ""}`;
  m = MONTH_YEAR.exec(s);
  if (m) return `${monthName(m[1])}${m[2]} YYYY`;
  return null;
}

function timeFormat(text: string): string | null {
  const m = /^(\d{1,2})([:.])(\d{2})(?:\2(\d{2}))?(\s?)([ap]\.?m\.?)?$/i.exec(text);
  if (!m) return null;
  const hours = Number(m[1]);
  if (hours > 23 || Number(m[3]) > 59) return null;
  // A time with a dot and no am/pm reads as a number ("10.30").
  if (m[2] === "." && !m[6]) return null;
  const meridiem = m[6] ? `${m[5]}${m[6] === m[6].toUpperCase() ? "AM" : "am"}` : "";
  return `H${m[2]}MM${m[4] ? `${m[2]}SS` : ""}${meridiem}`;
}

function numberFormat(text: string): ValueFormat | null {
  const m = /^([^\d\s.,+-]{0,3})(\s?)([+-]?)(\d[\d.,'  ]*?)(\s?)(%|[^\d\s.,]{0,4})$/u.exec(text);
  if (!m) return null;
  const [, prefix, prefixSpace, , body, suffixSpace, suffix] = m;
  if (!/^\d+([.,'  ]\d+)*$/u.test(body)) return null;
  const parts = body.split(/[.,'  ]/u);
  const seps = body.replace(/\d/g, "").split("");
  let decimals = 0;
  let thousands: string | undefined;
  if (seps.length > 0) {
    const lastSep = seps[seps.length - 1];
    const lastPart = parts[parts.length - 1];
    const grouped = parts.slice(1).every((p) => p.length === 3);
    // "1,234" and "1 234" are thousands; "1.234" on its own reads as a decimal number.
    const lastIsGroup = grouped && (seps.length > 1 ? seps.every((s) => s === lastSep) : lastSep !== ".");
    if (lastIsGroup) thousands = lastSep;
    else {
      decimals = lastPart.length;
      if (seps.length > 1) thousands = seps[0];
    }
  }
  const whole = thousands === undefined ? parts[0] : parts.slice(0, decimals > 0 ? -1 : undefined).join("");
  if (thousands === undefined && whole.length >= 4) thousands = "none";
  const amount = Number(whole);
  // The number of decimals follows the data ("4" and "3.7" in one column), so it is not part of the pattern.
  const format = `${prefix}${prefixSpace}#${suffixSpace}${suffix}`;
  return { type: "number", format, amount, unit: (prefix || suffix).toLowerCase(), ...(thousands !== undefined ? { thousands: thousands === " " ? " " : thousands } : {}) };
}

const WORDS = /^\p{L}[\p{L}\s'&/-]*$/u;

/** How a short text made of words is capitalised; null when there is nothing to tell (an acronym, a single letter). */
function capitalisation(text: string, transform: string): string | null {
  if (transform === "uppercase") return "UPPER CASE";
  if (transform === "lowercase") return "lower case";
  if (transform === "capitalize") return "Capitalised";
  if (!WORDS.test(text) || text.split(/\s+/).length > 4) return null;
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (letters.length < 2) return null;
  if (letters === letters.toUpperCase()) {
    // A short all-capitals word is an abbreviation, whatever the others look like.
    return letters === letters.toLowerCase() || letters.length <= 4 ? null : "UPPER CASE";
  }
  const first = text.charAt(0);
  // "jQuery", "iOS": a name with its own capitals, not a label someone forgot to capitalise.
  if (first === first.toLowerCase() && first !== first.toUpperCase()) return letters === letters.toLowerCase() ? "lower case" : null;
  return "Capitalised";
}

/** The pattern a value is written in; null for free text. */
export function valueFormat(text: string, transform = "none"): ValueFormat | null {
  const s = text.trim();
  if (s === "") return null;
  const date = dateFormat(s);
  if (date) return { type: "date", format: date };
  const time = timeFormat(s);
  if (time) return { type: "time", format: time };
  const number = /\d/.test(s) ? numberFormat(s) : null;
  if (number) return number;
  const caps = capitalisation(s, transform);
  return caps ? { type: "words", format: caps } : null;
}

const TYPE_NAME: Record<ValueType, string> = { date: "date format", time: "time format", number: "number format", words: "capitalisation" };

// ---------------------------------------------------------------------------

export function runContentRules(ctx: RuleContext): void {
  const { elements, groups, facts } = ctx;
  const shown = (i: number): boolean => elements[i].clip !== "full";
  const right = (el: ElementSnapshot): number => el.box.x + el.box.width;
  const bottom = (el: ElementSnapshot): number => el.box.y + el.box.height;
  const clips = (value: string): boolean => value === "hidden" || value === "clip";
  const quote = (el: ElementSnapshot): string => `"${el.text.length > 30 ? `${el.text.slice(0, 29)}…` : el.text}"`;

  /** The element whose ellipsis shortens this text: itself, or the block it is a line of. */
  const truncatedBy = (i: number): number => {
    if (elements[i].truncated) return i;
    const parent = elements[i].parent;
    return parent >= 0 && elements[parent].truncated && elements[i].clippedBy === parent ? parent : -1;
  };

  const within = (i: number, test: (a: number) => boolean, levels: number): boolean => {
    for (let a = i, n = 0; a >= 0 && n <= levels; a = elements[a].parent, n++) if (test(a)) return true;
    return false;
  };

  // ---------------------------------------------------------------------------
  // TXT-02: shortened by the browser, and nothing holds the full text
  // ---------------------------------------------------------------------------

  const fullTextRule = (): void => {
    if (!ctx.runs("TXT-02")) return;
    for (const el of elements) {
      if (!el.truncated || !shown(el.index) || facts.isControl(el.index)) continue;
      const text = el.text || el.children.map((c) => elements[c].text).find(Boolean) || "";
      if (text === "") continue;
      ctx.looked("TXT-02");
      const titled = within(el.index, (a) => elements[a].titled, 2) || el.children.some((c) => elements[c].titled);
      if (titled) continue;
      // What a link or button opens usually shows the text in full.
      const opens = within(el.index, (a) => facts.isInteractive(a), 3) || el.children.some((c) => facts.isInteractive(c));
      ctx.report({
        ruleId: "TXT-02",
        element: el.index,
        group: -1,
        kind: "outlier",
        property: "full text",
        expected: "a title or tooltip with the full text",
        actual: "shortened, no title",
        values: [],
        ...(opens ? { type: "Review" as const, severity: "Low" as const } : {}),
        message: opens
          ? `"${text.slice(0, 30)}" is shortened with an ellipsis and has no title that holds the full text. It may be readable in full on the page this opens.`
          : `"${text.slice(0, 30)}" is shortened with an ellipsis and nothing on it (a title or a label) holds the full text. If a tooltip appears on hover, mark this as intentional.`,
      });
    }
  };

  // ---------------------------------------------------------------------------
  // TXT-01: text that runs out of its box or is cut off
  // ---------------------------------------------------------------------------

  const cutOffRule = (): void => {
    if (!ctx.runs("TXT-01")) return;
    const tolerance = ctx.tolerance("TXT-01");
    const plain = (i: number): boolean => elements[i].layout.position !== "absolute" && elements[i].layout.position !== "fixed" && elements[i].style.transform === "none";

    for (const el of elements) {
      if (!el.textBox || el.text === "" || !shown(el.index) || facts.isControl(el.index)) continue;
      ctx.looked("TXT-01");
      const s = el.style;
      const text = el.textBox;
      const textRight = text.x + text.width;
      const rtl = s.direction === "rtl";

      // Cut off by its own box, or by the block it is a line of, with no ellipsis.
      const parent = el.parent;
      const clipper = clips(s.overflowX) ? el.index : parent >= 0 && clips(elements[parent].style.overflowX) && el.clippedBy === parent && el.layout.display.startsWith("inline") ? parent : -1;
      if (clipper >= 0) {
        const c = elements[clipper];
        // Text that is hidden until it is needed (a skip link) is taken out of the flow and clipped on purpose.
        if (c.truncated || c.style.textOverflow === "ellipsis" || c.box.width < 20 || !plain(clipper) || !plain(el.index)) continue;
        const inner = { left: c.box.x + c.style.borderWidth.left, right: right(c) - c.style.borderWidth.right };
        const lost = rtl ? inner.left - text.x : textRight - inner.right;
        const startsInside = rtl ? textRight <= inner.right + tolerance : text.x >= inner.left - tolerance;
        if (lost > tolerance && startsInside) {
          ctx.report({
            ruleId: "TXT-01",
            element: el.index,
            group: -1,
            kind: "outlier",
            property: "text cut off",
            expected: "the whole text, or an ellipsis",
            actual: `${px(lost)} cut off`,
            values: [],
            message: `${quote(el)} is cut off: ${px(lost)} of it is hidden by its box, with no ellipsis to show that there is more.`,
            marks: [{ box: { x: rtl ? text.x : inner.right, y: text.y, width: lost, height: text.height }, label: px(lost) }],
          });
        }
        continue;
      }

      // Cut off at the bottom: listed for review, since a box that opens on demand looks the same.
      if (clips(s.overflowY) && text.y + text.height - (bottom(el) - s.borderWidth.bottom) > Math.max(tolerance, s.fontSize / 2)) {
        const lost = text.y + text.height - (bottom(el) - s.borderWidth.bottom);
        ctx.report({
          ruleId: "TXT-01",
          element: el.index,
          group: -1,
          kind: "outlier",
          type: "Review",
          severity: "Low",
          property: "text cut off",
          expected: "the whole text",
          actual: `${px(lost)} cut off at the bottom`,
          values: [],
          message: `${quote(el)} is cut off at the bottom: ${px(lost)} of it is hidden by its box. A box that opens on demand looks the same.`,
        });
        continue;
      }

      // Runs out of the box it is drawn in.
      if (s.overflowX !== "visible" || s.transform !== "none") continue;
      let box = -1;
      for (let a = el.index, n = 0; a >= 0 && n < 4; a = elements[a].parent, n++) {
        if (!plain(a) || elements[a].style.overflowX !== "visible") break;
        if (facts.hasBox(a)) {
          box = a;
          break;
        }
      }
      if (box < 0) continue;
      const b = elements[box];
      const out = rtl ? b.box.x - text.x : textRight - right(b);
      if (out > tolerance) {
        ctx.report({
          ruleId: "TXT-01",
          element: el.index,
          group: -1,
          kind: "outlier",
          property: "text overflow",
          expected: "text inside its box",
          actual: `${px(out)} outside`,
          values: [],
          message: `${quote(el)} runs ${px(out)} out of the box it sits in.`,
          marks: [{ box: { x: rtl ? text.x : right(b), y: text.y, width: out, height: text.height }, label: px(out) }],
        });
      }
    }
  };

  // ---------------------------------------------------------------------------
  // TXT-03 and FMT-01: per peer group
  // ---------------------------------------------------------------------------

  const groupRules = (): void => {
    for (const g of ctx.order) {
      const group = groups[g];
      if (group.kind === "level") continue;
      const texts = group.members.filter((i) => elements[i].text !== "" && shown(i));
      if (texts.length < 2) continue;

      if (ctx.runs("TXT-03")) {
        const entries: Array<Entry<string>> = [];
        for (const i of texts) {
          if (ctx.reported("TXT-03", i)) continue;
          const typed = typedEllipsis(elements[i].textTail);
          if (typed) entries.push({ el: i, value: typed });
          else if (truncatedBy(i) >= 0) entries.push({ el: i, value: BY_BROWSER });
        }
        if (entries.length >= 2) {
          ctx.looked("TXT-03");
          const typed = entries.filter((e) => e.value !== BY_BROWSER);
          const byBrowser = entries.length - typed.length;
          if (byBrowser > 0 && typed.length > 0) {
            // The typed ones lose the rest of the text; the browser keeps it in the page.
            const values = valueCounts(bucketLabels(entries, (v) => v));
            for (const e of typed) {
              ctx.report({
                ruleId: "TXT-03",
                element: e.el,
                group: g,
                kind: "outlier",
                property: "ellipsis",
                expected: BY_BROWSER,
                actual: e.value,
                values,
                message: `${quote(elements[e.el])} ends in an ellipsis typed into the text; ${byBrowser} other ${byBrowser === 1 ? "element" : "elements"} of this group ${byBrowser === 1 ? "is" : "are"} shortened by the browser, which keeps the full text in the page.`,
              });
            }
          }
          if (typed.length >= 2) {
            const buckets = bucketLabels(typed.filter((e) => !ctx.reported("TXT-03", e.el)), (v) => v);
            const check = { ruleId: "TXT-03", property: "ellipsis", buckets: (): Array<Bucket<string>> => buckets };
            for (const f of findingsOf(ctx, check, g, judge(buckets), typed.length)) ctx.report(f);
          }
        }
      }

      if (ctx.runs("FMT-01")) {
        const formats = texts.flatMap((i) => {
          const el = elements[i];
          // A text the snapshot cut, or one that is shortened, cannot be read as a value.
          if (el.text.length >= 80 || typedEllipsis(el.textTail)) return [];
          const format = valueFormat(el.text, el.style.textTransform);
          return format ? [{ el: i, format }] : [];
        });
        for (const type of ["date", "time", "number", "words"] as const) {
          const ofType = formats.filter((f) => f.format.type === type && !ctx.reported("FMT-01", f.el));
          // A column of dates with a few empty or special cells is still a column of dates.
          if (ofType.length < (type === "words" ? 5 : 2) || ofType.length < texts.length * 0.8) continue;
          ctx.looked("FMT-01");
          const check = { ruleId: "FMT-01", property: TYPE_NAME[type], buckets: (e: Array<Entry<string>>): Array<Bucket<string>> => bucketLabels(e, (v) => v) };
          const review = (f: ReturnType<typeof findingsOf>[number]): void => ctx.report({ ...f, type: "Review", severity: "Low", message: `${f.message} It may follow the data.` });

          if (type === "words") {
            // The labels of links and buttons are names of pages, commands and terms; only values are compared.
            if (ofType.some((f) => within(f.el, (a) => facts.isInteractive(a), 2))) continue;
            // Names and terms keep their own capitals, so only one case is clear enough to list:
            // a single label that starts in lower case where all the others start with a capital.
            const verdict = judge(check.buckets(ofType.map((f) => ({ el: f.el, value: f.format.format }))));
            if (verdict.kind !== "outlier" || verdict.outliers.length !== 1 || verdict.expected.label !== "Capitalised") continue;
            for (const f of findingsOf(ctx, check, g, verdict, ofType.length)) if (f.actual === "lower case") review(f);
            continue;
          }

          if (type === "number") {
            // One unit written in two ways ("5%" and "5 %", "$5" and "5 $"). Which unit a value has follows the data.
            const units = new Map<string, typeof ofType>();
            for (const f of ofType) if (f.format.unit) units.set(f.format.unit, [...(units.get(f.format.unit) ?? []), f]);
            for (const [, sameUnit] of units) {
              if (sameUnit.length < 2) continue;
              const verdict = judge(check.buckets(sameUnit.map((f) => ({ el: f.el, value: f.format.format }))));
              for (const f of findingsOf(ctx, check, g, verdict, sameUnit.length)) review(f);
            }
          } else {
            const verdict = judge(check.buckets(ofType.map((f) => ({ el: f.el, value: f.format.format }))));
            // A column of dates or times has one format; with no majority there is no telling which.
            for (const f of findingsOf(ctx, check, g, verdict, ofType.length)) {
              if (verdict.kind === "noMajority") review(f);
              else ctx.report(f);
            }
          }
          if (type !== "number") continue;
          // 1,000 against 1000: only numbers large enough show it.
          const large = ofType.filter((f) => f.format.thousands !== undefined && !ctx.reported("FMT-01", f.el));
          if (large.length < 2) continue;
          const label = (v: string): string => (v === "none" ? "no thousands separator" : `"${v}" between thousands`);
          const thousands = { ruleId: "FMT-01", property: "thousands separator", buckets: (e: Array<Entry<string>>): Array<Bucket<string>> => bucketLabels(e, label) };
          const found = judge(thousands.buckets(large.map((f) => ({ el: f.el, value: f.format.thousands ?? "none" }))));
          for (const f of findingsOf(ctx, thousands, g, found, large.length)) ctx.report({ ...f, type: "Review", severity: "Low" });
        }
      }
    }
  };

  // ---------------------------------------------------------------------------
  // TYP-07: link style
  // ---------------------------------------------------------------------------

  const linkRule = (): void => {
    if (!ctx.runs("TYP-07")) return;
    const tolerance = ctx.tolerance("TYP-07");
    const underlined = (i: number): boolean => elements[i].style.textDecorationLine.includes("underline");
    const isTextLink = (i: number): boolean => {
      const el = elements[i];
      return el.link && el.text !== "" && shown(i) && !facts.hasBox(i) && !facts.inState(i);
    };
    /** Looks like a link: underlined, or a colour of its own. A link that looks like the text around it is not compared. */
    const styled = (i: number): boolean => {
      const parent = elements[i].parent;
      return underlined(i) || (parent >= 0 && deltaE(elements[i].style.color, elements[parent].style.color) >= tolerance);
    };

    const compare = (pool: number[], group: number, where: string, colour: boolean): void => {
      if (pool.length < 2) return;
      ctx.looked("TYP-07");
      const lines = bucketLabels(pool.map((el) => ({ el, value: underlined(el) ? "underlined" : "not underlined" })), (v) => v);
      const verdict = judge(lines);
      const check = { ruleId: "TYP-07", property: "link underline", buckets: (): Array<Bucket<string>> => lines };
      for (const f of findingsOf(ctx, check, group, verdict, pool.length)) {
        const message = f.kind === "outlier" ? `This link is ${f.actual}; ${f.values[0].count} of the ${pool.length} ${where} are ${f.expected}.` : f.message.replace("elements", "links");
        // Links that are peers should look the same. Links that only share a page may differ on purpose, and
        // outside a clear majority there is no telling which style is meant: both are listed for review.
        const sure = group >= 0 && (verdict.kind === "pair" || (verdict.kind === "outlier" && verdict.strong));
        ctx.report(sure ? { ...f, message } : { ...f, message, type: "Review", severity: "Low" });
      }
      // The colour of links that are peers is compared by TYP-05.
      if (!colour) return;
      const rest = pool.filter((el) => !ctx.reported("TYP-07", el));
      const colours = bucketColours(rest.map((el) => ({ el, value: elements[el].style.color })), tolerance);
      const found = judge(colours);
      // A colour many links share is a kind of link (one that leads elsewhere, one that is missing); one or two are a slip.
      if (found.kind !== "outlier" || !found.strong || found.outliers.length > 2) return;
      const colourCheck = { ruleId: "TYP-07", property: "link colour", buckets: (): Array<Bucket<string>> => colours };
      for (const f of findingsOf(ctx, colourCheck, group, found, rest.length)) {
        ctx.report({ ...f, type: "Review", severity: "Low", message: `Link colour is ${f.actual}; ${f.values[0].count} of the ${rest.length} ${where} use ${f.expected}. A colour on its own may carry a meaning.` });
      }
    };

    // Links that are peers: the links of a menu, the name links of a column.
    const grouped = new Set<number>();
    for (const g of ctx.order) {
      const group = groups[g];
      if (group.kind === "level") continue;
      // The member that looks like the current item differs on purpose.
      const links = group.members.filter((i) => isTextLink(i) && i !== group.guessedActive);
      if (links.length < 2 || links.length * 2 < group.members.length) continue;
      for (const i of links) grouped.add(i);
      compare(links.filter((i) => !ctx.reported("TYP-07", i)), g, "links in this group", false);
    }

    // The other links of the page, by where they sit: in a sentence or on their own, and on which background.
    const inNavigation = (i: number): boolean => within(i, (a) => elements[a].tag === "nav" || elements[a].role === "navigation", 64);
    const pools = new Map<string, number[]>();
    for (const el of elements) {
      const i = el.index;
      if (!isTextLink(i) || grouped.has(i) || !styled(i) || inNavigation(i)) continue;
      const inSentence = el.parent >= 0 && elements[el.parent].text !== "";
      const key = `${inSentence ? "in a sentence" : "on their own"}|${facts.backdropOf(i)}`;
      pools.set(key, [...(pools.get(key) ?? []), i]);
    }
    for (const [key, pool] of pools) compare(pool, -1, `links ${key.split("|")[0]} on this background`, true);
  };

  fullTextRule();
  cutOffRule();
  groupRules();
  linkRule();
}
