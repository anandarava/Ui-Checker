/**
 * HTML report. Same template as the PalTech Accessibility Testing extension's
 * report (same structure, styles and class names), with the wording and data
 * of this tool:
 *
 *   Summary            for team leads and clients: verdict, score, issues by
 *                      severity, fix these first, where it shows, what was tested
 *   Developer details  per rule and element: expected and found, the peer
 *                      group, the fix, selector, HTML and a screenshot
 *
 * The report is one self-contained file: no scripts, no external resources.
 */
import { CATEGORY_LABEL, getRule } from "@shared/rules";
import { scoreBand as bandOf } from "@shared/scoring";
import type { DesignAudit, Finding, PeerGroup, ScaleKind, ScanResult, Severity } from "@shared/types";
import { toolInfo } from "./json-report";

export interface ReportMeta {
  /** Name shown as "Prepared by". */
  preparedBy?: string;
  /** Client or company the report is for. */
  organisation?: string;
}

const SEVERITY_ORDER: Severity[] = ["High", "Medium", "Low"];
const SEVERITY_COLOR: Record<Severity, string> = { High: "#f46036", Medium: "#f5b700", Low: "#8d99ae" };
const SEVERITY_MEANING: Record<Severity, string> = {
  High: "Most peers agree and this element clearly differs",
  Medium: "A small difference, or no clear majority",
  Low: "A difference that may be on purpose",
};
const PRESET_LABEL: Record<string, string> = { strict: "Strict", normal: "Normal", relaxed: "Relaxed" };

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

const SAFE_HTTP_URL = /^https?:\/\/[^\s"'<>]+$/i;
const SAFE_DATA_IMAGE = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/;

function safeHref(url: unknown): string | null {
  return typeof url === "string" && SAFE_HTTP_URL.test(url) ? url : null;
}

function safeImage(dataUrl: unknown): string | null {
  return typeof dataUrl === "string" && SAFE_DATA_IMAGE.test(dataUrl) ? dataUrl : null;
}

function severityRank(s: Severity): number {
  return SEVERITY_ORDER.indexOf(s);
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function severityBadge(severity: Severity, review = false): string {
  return review ? `<span class="badge badge-review">Needs review</span>` : `<span class="badge badge-${severity.toLowerCase()}">${severity}</span>`;
}

function scoreRing(score: number): string {
  const size = 120;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const d = (Math.max(0, Math.min(100, score)) / 100) * c;
  const color = score >= 90 ? "#1e7a3c" : score >= 50 ? "#b36b00" : "#b3261e";
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Consistency score ${escapeHtml(score)} out of 100">
<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#e3e8f0" stroke-width="${stroke}"/>
<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${d.toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
<text x="50%" y="47%" text-anchor="middle" dominant-baseline="middle" font-size="34" font-weight="700" fill="#16202c">${escapeHtml(score)}</text>
<text x="50%" y="66%" text-anchor="middle" font-size="10" fill="#4f5b6c">out of 100</text>
</svg>`;
}

function severityDonut(counts: Record<Severity, number>, total: number): string {
  const size = 124;
  const stroke = 16;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const present = SEVERITY_ORDER.filter((s) => counts[s] > 0);
  const gap = present.length > 1 ? 2 : 0;
  let offset = 0;
  const segments = present
    .map((s) => {
      const len = (counts[s] / total) * c;
      const dash = Math.max(0, len - gap);
      const seg = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${SEVERITY_COLOR[s]}" stroke-width="${stroke}" stroke-dasharray="${dash.toFixed(2)} ${(c - dash).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"/>`;
      offset += len;
      return seg;
    })
    .join("");
  const label = total === 0 ? "No open issues" : `${total} open issues: ${SEVERITY_ORDER.map((s) => `${counts[s]} ${s.toLowerCase()}`).join(", ")}`;
  return `<svg class="donut" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${escapeHtml(label)}">
<g transform="rotate(-90 ${size / 2} ${size / 2})"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#e9edf3" stroke-width="${stroke}"/>${segments}</g>
<text x="50%" y="47%" text-anchor="middle" font-size="30" font-weight="700" fill="#16202c">${total}</text>
<text x="50%" y="63%" text-anchor="middle" font-size="9.5" letter-spacing="1" fill="#4f5b6c">ISSUES</text>
</svg>`;
}

// ---------------------------------------------------------------------------
// Rule groups
// ---------------------------------------------------------------------------

interface RuleGroup {
  ruleId: string;
  title: string;
  category: string;
  severity: Severity;
  why: string;
  howToFix: string;
  issues: Finding[];
}

function groupByRule(findings: Finding[]): RuleGroup[] {
  const byRule = new Map<string, Finding[]>();
  for (const f of findings) byRule.set(f.ruleId, [...(byRule.get(f.ruleId) ?? []), f]);
  const groups = [...byRule.entries()].map(([ruleId, issues]) => {
    const rule = getRule(ruleId);
    const severity = issues.map((i) => i.severity).sort((a, b) => severityRank(a) - severityRank(b))[0];
    return { ruleId, title: rule?.name ?? ruleId, category: rule ? CATEGORY_LABEL[rule.category] : "", severity, why: rule?.description ?? "", howToFix: rule?.fix ?? "", issues };
  });
  return groups.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || b.issues.length - a.issues.length || a.title.localeCompare(b.title));
}

function slug(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
}

/** `<tag.class>` and the text of the element, from its HTML snippet. */
function describeElement(f: Finding): string {
  const open = /^<\s*([a-z0-9-]+)([^>]*)>/i.exec(f.element.html ?? "");
  if (!open) return f.element.selector;
  const cls = /\bclass\s*=\s*"([^"]*)"/i.exec(open[2] ?? "")?.[1]?.trim().split(/\s+/)[0];
  const head = `<${open[1].toLowerCase()}${cls ? `.${cls}` : ""}>`;
  return f.element.text ? `${head} "${f.element.text}"` : head;
}

/** What several findings of a rule have in common. */
function causeLabel(f: Finding): string {
  const what = f.property.charAt(0).toUpperCase() + f.property.slice(1);
  return f.expected ? `${what} ${f.actual}, expected ${f.expected}` : `${what} ${f.actual}`;
}

const STATUS_TEXT: Record<Finding["status"], string> = { new: "Open", ignored: "Ignored", baselined: "Baselined", intentional: "Intentional" };

function renderInstance(f: Finding, n: number, total: number, groups: Map<string, { group: PeerGroup; number: number }>): string {
  const peer = f.groupId ? groups.get(f.groupId) : undefined;
  const shot = safeImage(f.evidence?.screenshot);
  const values = f.values.length ? f.values.map((v) => `${escapeHtml(v.value)} × ${v.count}`).join(", ") : "";
  const rows = [
    `<tr><th scope="row">Compared</th><td>${escapeHtml(f.property)}</td></tr>`,
    `<tr><th scope="row">Found</th><td><span class="bad">${escapeHtml(f.actual)}</span></td></tr>`,
    `<tr><th scope="row">Expected</th><td>${f.expected ? `<span class="ok">${escapeHtml(f.expected)}</span>` : "No clear majority to go by"}</td></tr>`,
    values ? `<tr><th scope="row">In the group</th><td>${values}</td></tr>` : "",
    peer ? `<tr><th scope="row">Peer group</th><td>G${peer.number} · ${escapeHtml(peer.group.label)}</td></tr>` : "",
    f.status !== "new" ? `<tr><th scope="row">Status</th><td>${STATUS_TEXT[f.status]}${f.reason ? `: ${escapeHtml(f.reason)}` : ""}</td></tr>` : "",
  ].join("");
  return `<li class="inst" data-sev="${f.severity}">
<div class="inst-h"><span class="inst-n">${n}</span><span class="inst-what">${escapeHtml(describeElement(f))}</span><span class="inst-of">Element ${n} of ${total}</span></div>
<p class="finding">${escapeHtml(f.message)}</p>
<table class="kv"><caption class="sr-only">Expected and found</caption><tbody>${rows}</tbody></table>
${shot ? `<figure class="shot"><img src="${shot}" alt="Screenshot of the element with the measurement drawn on it"><figcaption>The element as it was scanned. The pink stretch is what was measured.</figcaption></figure>` : ""}
<div class="code"><p class="code-label">Selector</p><pre>${escapeHtml(f.element.selector)}</pre><p class="code-label">HTML</p><pre class="html">${escapeHtml(f.element.html)}</pre></div>
<details class="tech"><summary>Technical details</summary><table class="kv"><tbody>
<tr><th scope="row">Fingerprint</th><td><code>${escapeHtml(f.fingerprint)}</code></td></tr>
<tr><th scope="row">Position</th><td>${Math.round(f.element.box.x)}, ${Math.round(f.element.box.y)} · ${Math.round(f.element.box.width)} × ${Math.round(f.element.box.height)} px</td></tr>
<tr><th scope="row">Kind</th><td>${escapeHtml(f.kind)}</td></tr>
</tbody></table></details>
</li>`;
}

function renderRuleDetails(group: RuleGroup, groups: Map<string, { group: PeerGroup; number: number }>, prefix = "rule", review = false): string {
  // Elements that share a cause (the same value, the same expected value) are noted once.
  const causes = new Map<string, number>();
  for (const f of group.issues) causes.set(causeLabel(f), (causes.get(causeLabel(f)) ?? 0) + 1);
  const shared = [...causes.entries()].filter(([, n]) => n > 1);
  const note = shared.length ? `<div class="note"><b>Shared cause.</b> Fixing one of these fixes all of them:<ul>${shared.map(([label, n]) => `<li>${escapeHtml(label)} × ${n}</li>`).join("")}</ul></div>` : "";
  return `<article class="rule" id="${prefix}-${slug(group.ruleId)}" style="--c:${review ? "#0369a1" : SEVERITY_COLOR[group.severity]}" data-sevs="${[...new Set(group.issues.map((i) => i.severity))].join(" ")}">
<header class="rule-h"><p class="eyebrow">${escapeHtml(group.ruleId)} · ${escapeHtml(group.category)}</p>
<h3>${escapeHtml(group.title)}</h3>
<p class="rule-meta">${severityBadge(group.severity, review)} <span class="chip">${plural(group.issues.length, "element")}</span></p></header>
<div class="rule-info"><div class="info"><h4>What it means</h4><p>${escapeHtml(group.why)}</p></div><div class="info info-fix"><h4>How to fix</h4><p>${escapeHtml(group.howToFix)}</p></div></div>
${note}
<ol class="instances">${group.issues.map((f, i) => renderInstance(f, i + 1, group.issues.length, groups)).join("\n")}</ol>
</article>`;
}

function renderFailedRulesTable(groups: RuleGroup[]): string {
  if (groups.length === 0) return "";
  const rows = groups
    .map(
      (g) =>
        `<tr data-sevs="${[...new Set(g.issues.map((i) => i.severity))].join(" ")}"><th scope="row"><a href="#rule-${slug(g.ruleId)}">${escapeHtml(g.title)}</a><br><span class="muted small">${escapeHtml(g.ruleId)}</span></th><td>${escapeHtml(g.category)}</td><td>${severityBadge(g.severity)}</td><td class="num">${g.issues.length}</td></tr>`,
    )
    .join("");
  return `<section class="card" aria-labelledby="h-failed"><h3 id="h-failed" class="label">Failed rules</h3><div class="scroll"><table class="grid"><caption class="sr-only">Rules that failed, most severe first</caption>
<thead><tr><th scope="col">Rule</th><th scope="col">Category</th><th scope="col">Severity</th><th scope="col" class="num">Elements</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function verdict(groups: RuleGroup[], active: Finding[]): { tone: string; title: string; text: string } {
  if (active.length === 0) {
    return { tone: "good", title: "Consistent: no issues found", text: "The elements that should look the same do look the same, as far as the automated checks can tell." };
  }
  const high = active.filter((f) => f.severity === "High").length;
  const byCategory = new Map<string, number>();
  for (const g of groups) byCategory.set(g.category, (byCategory.get(g.category) ?? 0) + g.issues.length);
  const worst = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0]?.[0].toLowerCase() ?? "layout";
  if (high > 0) {
    return { tone: "poor", title: `Inconsistent: ${plural(high, "high-severity issue")}`, text: `${plural(active.length, "issue")} in ${plural(groups.length, "rule")}, most of them in ${worst}. Start with the ones listed under "Fix these first".` };
  }
  return { tone: "mid", title: `Mostly consistent: ${plural(active.length, "smaller issue")}`, text: `No high-severity issue. ${plural(active.length, "issue")} in ${plural(groups.length, "rule")}, most of them in ${worst}.` };
}

function renderTopProblems(groups: RuleGroup[]): string {
  if (groups.length === 0) return "";
  const items = groups
    .slice(0, 5)
    .map(
      (g, i) => `<li class="top-item" style="--c:${SEVERITY_COLOR[g.severity]}"><span class="rank">${i + 1}</span><div>
<p class="top-title"><a href="#rule-${slug(g.ruleId)}">${escapeHtml(g.title)}</a></p>
<p class="top-impact">${escapeHtml(g.howToFix)}</p>
<p class="top-meta">${severityBadge(g.severity)} <span class="chip">${plural(g.issues.length, "element")}</span> <span class="chip">${escapeHtml(g.category)}</span></p></div></li>`,
    )
    .join("");
  return `<section class="card" id="h-top" aria-labelledby="h-top-t"><h3 id="h-top-t" class="label">Fix these first</h3><ol class="top">${items}</ol></section>`;
}

/** "Where it shows": the components (peer groups) the open issues are in. */
function renderAffected(active: Finding[], groups: Map<string, { group: PeerGroup; number: number }>): string {
  const counts = new Map<string, number>();
  let loose = 0;
  for (const f of active) {
    if (f.groupId && groups.has(f.groupId)) counts.set(f.groupId, (counts.get(f.groupId) ?? 0) + 1);
    else loose++;
  }
  if (counts.size === 0 && loose === 0) return "";
  const max = Math.max(loose, ...counts.values());
  const rows = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => {
      const { group, number } = groups.get(id)!;
      return `<li><div class="aff-top"><b>G${number} · ${escapeHtml(group.label)}</b><span>${plural(n, "issue")}</span></div><span class="bar"><i style="width:${Math.round((n / max) * 100)}%"></i></span></li>`;
    });
  if (loose > 0) rows.push(`<li><div class="aff-top"><b>Single elements off a shared line</b><span>${plural(loose, "issue")}</span></div><span class="bar"><i style="width:${Math.round((loose / max) * 100)}%"></i></span></li>`);
  return `<section class="card fill-card" aria-labelledby="h-where"><h3 id="h-where" class="label">Where it shows</h3><div class="fill"><div class="fill-scroll" tabindex="0" role="group" aria-label="Components with issues"><ul class="affected">${rows.join("")}</ul></div></div></section>`;
}

const CSS = `
:root{color-scheme:light;--ink:#16202c;--muted:#4f5b6c;--line:#e0e5ec;--bg:#f3f5f8;--card:#fff;--link:#0b4fb3;--focus:#1d4ed8;--accent:#1f3a8a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
a{color:var(--link)}
a:focus-visible,summary:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.86em}
p{margin:.35rem 0}
.skip{position:absolute;left:-999px;top:0;background:#fff;color:var(--ink);padding:.5rem 1rem;border:2px solid var(--focus)}
.skip:focus{left:1rem;top:1rem;z-index:10}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.muted{color:var(--muted)}.small{font-size:.86rem}.nowrap{white-space:nowrap}
.wrap{max-width:68rem;margin:0 auto;padding-left:1.25rem;padding-right:1.25rem}
.cover{background:var(--accent);color:#fff}
.cover .wrap{padding-top:1.6rem;padding-bottom:1.4rem;display:flex;flex-wrap:wrap;gap:1rem 2rem;justify-content:space-between;align-items:flex-end}
.brand{display:flex;gap:.9rem;align-items:center;min-width:0}
.cover h1{margin:0;font-size:1.6rem;line-height:1.2}
.cover .page{margin:.2rem 0 0;color:#dbe4ff;overflow-wrap:anywhere}
.cover .page a{color:#fff}
.cover dl{margin:0;display:grid;grid-template-columns:auto auto;gap:.1rem .9rem;font-size:.88rem}
.cover dt{color:#c7d3f5}.cover dd{margin:0;font-weight:600}
.toc{background:var(--card);border-bottom:1px solid var(--line)}
.toc ul{list-style:none;margin:0 auto;padding-top:.55rem;padding-bottom:.55rem;display:flex;flex-wrap:wrap;gap:.3rem 1.2rem;font-size:.9rem}
main{padding-top:1.4rem;padding-bottom:3rem;display:grid;gap:1rem}
.part{display:flex;align-items:baseline;gap:.75rem;margin:1rem 0 0;padding-bottom:.4rem;border-bottom:2px solid var(--ink)}
.part h2{margin:0;font-size:1.3rem}
.part span{color:var(--muted);font-size:.9rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:1.1rem 1.25rem;min-width:0}
.label{margin:0 0 .75rem;font-size:.76rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:700}
.verdict{border-left:6px solid;display:grid;gap:.2rem}
.verdict h3{margin:0;font-size:1.2rem}
.verdict.poor{border-left-color:#b3261e;background:#fff7f6}.verdict.mid{border-left-color:#b36b00;background:#fffaf0}.verdict.good{border-left-color:#1e7a3c;background:#f4fbf6}
.hero{display:grid;grid-template-columns:1fr 1.4fr 1fr;gap:1rem}
.two{display:grid;grid-template-columns:1.3fr 1fr;gap:1rem;align-items:start}
.two.stretch{align-items:stretch}
.fill-card{display:flex;flex-direction:column}
.fill{position:relative;flex:1;min-height:14rem}
.fill-scroll{position:absolute;inset:0;overflow-y:auto}
.fill-scroll:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
@media (max-width:54rem){.hero,.two{grid-template-columns:1fr}.fill{min-height:0}.fill-scroll{position:static;max-height:22rem}}
.score{display:flex;gap:1rem;align-items:center}
svg.ring,svg.donut{flex:none}
.bandpill{display:inline-block;white-space:nowrap;padding:.1rem .7rem;border-radius:999px;font-weight:600;font-size:.86rem;border:1px solid}
.bandpill.good{background:#e6f4ea;color:#14532d;border-color:#1e7a3c}
.bandpill.mid{background:#fff4d6;color:#6b4500;border-color:#b36b00}
.bandpill.poor{background:#fde8e8;color:#7a1414;border-color:#b3261e}
.sev{display:flex;gap:1.1rem;align-items:center;flex-wrap:wrap}
.sev ul{list-style:none;margin:0;padding:0;display:grid;gap:.45rem;flex:1;min-width:12rem}
.rvline{margin:.9rem 0 0;padding-top:.7rem;border-top:1px dashed var(--line);display:flex;align-items:center;gap:.5rem;font-size:.88rem;color:var(--muted)}
.rvcount{border:1px dashed #8a6d00;color:#6b5400;background:#fff8e0;border-radius:999px;padding:.05rem .6rem;font-weight:700;font-size:.82rem;flex:none}
.sev li{display:grid;grid-template-columns:auto 1fr auto;column-gap:.5rem;align-items:center}
.sev li small{grid-column:2/4;color:var(--muted);font-size:.78rem;line-height:1.2}
.sev li b{font-variant-numeric:tabular-nums}
.dot{width:.7rem;height:.7rem;border-radius:50%;display:inline-block;flex:none}
.kpis{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}
.kpi{border:1px solid var(--line);border-radius:10px;padding:.55rem .7rem}
.kpi b{display:block;font-size:1.4rem;font-variant-numeric:tabular-nums}.kpi span{font-size:.8rem;color:var(--muted)}
ol.top{list-style:none;margin:0;padding:0;display:grid;gap:.7rem}
.top-item{display:grid;grid-template-columns:auto 1fr;gap:.8rem;padding:.75rem .9rem;border:1px solid var(--line);border-left:5px solid var(--c);border-radius:10px}
.rank{width:1.9rem;height:1.9rem;border-radius:50%;background:var(--ink);color:#fff;display:grid;place-items:center;font-weight:700;font-size:.9rem}
.top-title{margin:0;font-weight:700;font-size:1.02rem}.top-title a{color:var(--ink)}
.top-impact{margin:.15rem 0 .35rem;color:#2e3a4b}
.top-meta{margin:0;font-size:.86rem;color:var(--muted);display:flex;flex-wrap:wrap;gap:.3rem;align-items:center}
.chip{display:inline-block;border-radius:6px;padding:.02rem .5rem;font-size:.76rem;font-weight:600;border:1px solid var(--line);background:#f5f7fa;color:#2c394c}
.facts-list{margin:0;display:grid;grid-template-columns:auto 1fr;gap:.3rem 1rem;font-size:.92rem}
.facts-list dt{color:var(--muted)}.facts-list dd{margin:0;overflow-wrap:anywhere}
.limits{background:#f7f8fb}
.limits ul{margin:.4rem 0 0;padding-left:1.1rem}
.scroll{overflow-x:auto}
.scale h4{margin:1.1rem 0 .2rem;font-size:.95rem}.scale tr.flagged th,.scale tr.flagged td{background:#fff8ec}
.swatch{display:inline-block;width:.9rem;height:.9rem;margin-right:.4rem;vertical-align:-.1rem;border:1px solid #8d99ae;border-radius:3px}
table{border-collapse:collapse;width:100%}
table.grid th,table.grid td{padding:.55rem .6rem;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
table.grid thead th{font-size:.74rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:700}
ul.affected{list-style:none;margin:0;padding:0 .4rem 0 0}
ul.affected li{padding:.6rem 0;border-bottom:1px solid var(--line)}
ul.affected li:first-child{padding-top:0}
.aff-top{display:flex;flex-wrap:wrap;justify-content:space-between;gap:.1rem .8rem}
.aff-top span{color:var(--muted);font-size:.9rem;font-variant-numeric:tabular-nums}
ul.affected .bar{margin-top:.4rem}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.bar{display:block;height:.55rem;border-radius:4px;background:#e9edf3;margin-top:.5rem}.bar i{display:block;height:100%;border-radius:4px;background:var(--accent)}
.intro{margin:0;color:var(--muted)}
article.rule{background:var(--card);border:1px solid var(--line);border-top:5px solid var(--c,#6c757d);border-radius:12px;padding:1.1rem 1.25rem}
.eyebrow{margin:0;font-size:.84rem;color:var(--muted)}
.rule-h h3{margin:.2rem 0 0;font-size:1.2rem}
.rule-meta{margin:.5rem 0 0;display:flex;flex-wrap:wrap;gap:.35rem;align-items:center;font-size:.88rem}
.rule-info{display:grid;grid-template-columns:1fr 1fr;gap:.8rem;margin:.9rem 0}
@media (max-width:44rem){.rule-info{grid-template-columns:1fr}}
.info{border:1px solid var(--line);border-radius:10px;padding:.7rem .85rem;background:#fafbfd}
.info h4{margin:0 0 .25rem;font-size:.78rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.info-fix{background:#eff8f1;border-color:#cde6d4}.info-fix h4{color:#14532d}
.note{border:1px dashed #9aa8bd;border-radius:10px;padding:.6rem .85rem;margin:0 0 .9rem;font-size:.9rem}
.note ul{margin:.3rem 0 0;padding-left:1.1rem}
ol.instances{list-style:none;margin:0;padding:0;display:grid;gap:.8rem}
.inst{border:1px solid var(--line);border-radius:10px;padding:.85rem .95rem;background:#fff}
.inst-h{display:flex;gap:.6rem;align-items:center;margin-bottom:.35rem}
.inst-n{width:1.6rem;height:1.6rem;border-radius:50%;background:#eef2f8;display:grid;place-items:center;font-weight:700;font-size:.8rem;flex:none}
.inst-what{font-weight:600;min-width:0;overflow-wrap:anywhere}
.inst-of{margin-left:auto;font-size:.76rem;color:var(--muted);white-space:nowrap;text-transform:uppercase;letter-spacing:.05em}
.finding{margin:.3rem 0 .5rem}
.ok{color:#14532d;font-weight:600}.bad{color:#9b1c1c;font-weight:600}
table.kv{margin:.3rem 0 .5rem}
table.kv th,table.kv td{padding:.3rem .5rem;border-bottom:1px solid #eef1f5;text-align:left;vertical-align:top;font-size:.88rem}
table.kv th{width:10rem;color:var(--muted);font-weight:600}
table.kv code{overflow-wrap:anywhere}
.code{margin-top:.5rem}
.code-label{margin:.4rem 0 .2rem;font-size:.74rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:700}
.code pre{margin:0;background:#f5f7fa;border:1px solid var(--line);padding:.45rem .65rem;border-radius:7px;white-space:pre-wrap;word-break:break-word}
.code pre.html{background:#0f1722;border-color:#0f1722;color:#dfe7f2}
figure.shot{margin:.6rem 0}figure.shot img{max-width:100%;height:auto;border:1px solid var(--line);border-radius:8px;display:block}
figcaption{color:var(--muted);font-size:.82rem;margin-top:.25rem}
details.tech{margin-top:.55rem;font-size:.88rem}
details.tech summary{cursor:pointer;color:var(--muted);font-weight:600}
.badge{display:inline-block;border-radius:999px;padding:.05rem .6rem;font-size:.78rem;font-weight:600;border:1px solid transparent;white-space:nowrap}
.badge-high{background:#ffe8d6;color:#7a2e00;border-color:#c2410c}
.badge-medium{background:#fff4c2;color:#5c4a00;border-color:#a16207}
.badge-low{background:#e4e7ec;color:#2f3744;border-color:#6b7280}
.badge-review{background:#e0f2fe;color:#0c4a6e;border-color:#0369a1}
.lists details{margin:.3rem 0}.lists summary{padding:.3rem 0;font-weight:600;cursor:pointer}
.lists ul{columns:2;column-gap:1.5rem;margin:.3rem 0 .6rem;padding-left:1.1rem;font-size:.86rem}
@media (max-width:40rem){.lists ul{columns:1}table.kv th{width:6.5rem}.inst-of{display:none}}
table.facts th,table.facts td{padding:.35rem .5rem;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;font-size:.9rem}
table.facts th{width:11rem;color:var(--muted);font-weight:600}
footer{color:var(--muted);font-size:.84rem;padding-bottom:2rem}
@media print{.fill{min-height:0}.fill-scroll{position:static;overflow:visible;max-height:none}body{background:#fff}.toc{display:none}.cover{background:#fff;color:var(--ink);border-bottom:3px solid var(--ink)}.cover .page,.cover dt{color:var(--muted)}.cover .page a{color:inherit}
.card,.top-item,.inst{break-inside:avoid}.part{break-before:page}.part.first{break-before:auto}details.tech{display:none}a{color:inherit}}
`;

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const SCALE_LABEL: Record<ScaleKind, string> = { fontFamily: "Font families", fontSize: "Font sizes", fontWeight: "Font weights", spacing: "Spacing", color: "Colours" };
const SAFE_COLOUR = /^rgba?\([\d\s.,%/]+\)$/;

/** The design scale of the page: every value with how often it is used, and the ones that stand out. */
function renderDesignScale(audit: DesignAudit | undefined): string {
  if (!audit) return "";
  const flagged = audit.lists.reduce((n, list) => n + list.values.filter((v) => v.flags.length > 0).length, 0);
  const tables = audit.lists
    .map((list) => {
      if (list.values.length === 0) return "";
      const rows = list.values
        .map((v) => {
          const swatch = list.kind === "color" && SAFE_COLOUR.test(v.value) ? `<span class="swatch" style="background:${escapeHtml(v.value)}" aria-hidden="true"></span>` : "";
          const where = v.samples.map((s) => `<code>${escapeHtml(s.selector)}</code>`).join("<br>") + (v.count > v.samples.length ? `<br><span class="muted small">and ${v.count - v.samples.length} more</span>` : "");
          const notes = v.flags.map((flag) => escapeHtml(flag.message)).join("<br>");
          return `<tr${v.flags.length ? ' class="flagged"' : ""}><th scope="row">${swatch}${escapeHtml(v.value)}${v.token ? `<br><span class="muted small">${escapeHtml(v.token)}</span>` : ""}</th><td>${escapeHtml(v.count)}${v.detail ? `<br><span class="muted small">${escapeHtml(v.detail)}</span>` : ""}</td><td>${where}</td><td>${notes}</td></tr>`;
        })
        .join("");
      return `<h4>${escapeHtml(SCALE_LABEL[list.kind])} (${list.values.length})</h4>${list.note ? `<p class="muted small">${escapeHtml(list.note)}</p>` : ""}
<div class="scroll"><table class="grid"><caption class="sr-only">${escapeHtml(SCALE_LABEL[list.kind])}</caption><thead><tr><th scope="col">Value</th><th scope="col">Used by</th><th scope="col">Where</th><th scope="col">Note</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    })
    .join("\n");
  const basis = audit.tokenFile
    ? `The values are checked against the design tokens of <strong>${escapeHtml(audit.tokenFile)}</strong>.`
    : "No design tokens were loaded, so a value is judged against the page itself: used once, off the spacing grid the page follows, or almost the same as a more used colour.";
  return `<section class="card scale" id="h-scale" aria-labelledby="h-scale-t"><h3 id="h-scale-t" class="label">Design scale</h3>
<p>The fonts, sizes, spacing and colours this page uses. ${basis} ${flagged === 0 ? "No value stands out." : `${plural(flagged, "value")} ${flagged === 1 ? "stands" : "stand"} out.`} These are observations about the whole page: they are not counted as issues or in the score.</p>
${tables}</section>`;
}

export function buildHtmlReport(result: ScanResult, meta: ReportMeta = {}): string {
  const tool = toolInfo();
  const findings = result.findings ?? [];
  const review = findings.filter((f) => f.type === "Review" && f.status === "new");
  const counted = findings.filter((f) => f.type !== "Review");
  const active = counted.filter((f) => f.status === "new");
  const excluded = findings.filter((f) => f.status !== "new");
  const peerGroups = new Map(result.groups.map((group, i) => [group.id, { group, number: i + 1 }]));

  const counts: Record<Severity, number> = { High: 0, Medium: 0, Low: 0 };
  for (const f of active) counts[f.severity]++;
  const groups = groupByRule(active);
  const reviewGroups = groupByRule(review);
  const excludedGroups = groupByRule(excluded);

  const pageTitle = result.title || result.url || "Untitled page";
  const url = safeHref(result.url);
  const urlHtml = url ? `<a href="${escapeHtml(url)}" rel="noopener noreferrer">${escapeHtml(url)}</a>` : escapeHtml(result.url);
  const score = Number.isFinite(result.score) ? result.score : 0;
  const band = bandOf(score);
  const bandCls = band === "Good" ? "good" : band === "Needs improvement" ? "mid" : "poor";
  const preset = PRESET_LABEL[result.options.tolerancePreset] ?? result.options.tolerancePreset;
  const scopeHtml = result.options.scope === "selector" ? `Part of the page (<code>${escapeHtml(result.options.selector ?? "")}</code>)` : "Full page";
  const v = verdict(groups, active);
  const preparedBy = meta.preparedBy?.trim();
  const organisation = meta.organisation?.trim();
  const outcome = (o: string) => result.rules.filter((r) => r.outcome === o);
  const passed = outcome("passed");
  const notApplicable = outcome("notApplicable");
  const notBuilt = outcome("notImplemented");
  const off = outcome("disabled");
  const groupsWithIssues = new Set(active.map((f) => f.groupId).filter(Boolean)).size;

  const sevList = SEVERITY_ORDER.map(
    (s) => `<li><span class="dot" style="background:${SEVERITY_COLOR[s]}" aria-hidden="true"></span><span>${s}</span><b>${counts[s]}</b><small>${escapeHtml(SEVERITY_MEANING[s])}</small></li>`,
  ).join("");

  const detailsHtml = groups.length
    ? groups.map((g) => renderRuleDetails(g, peerGroups)).join("\n")
    : `<section class="card"><h3 class="label">Issue details</h3><p>No open issues were found by the automated checks.</p></section>`;

  const ruleList = (list: typeof passed) => list.map((r) => `<li><code>${escapeHtml(r.id)}</code> ${escapeHtml(getRule(r.id)?.name ?? "")}</li>`).join("");
  const listsHtml = `<section class="card lists" aria-labelledby="h-lists">
<h3 id="h-lists" class="label">Rules checked</h3>
${passed.length ? `<details><summary>${plural(passed.length, "rule")} passed</summary><ul>${ruleList(passed)}</ul></details>` : ""}
${notApplicable.length ? `<details><summary>${plural(notApplicable.length, "rule")} not applicable (nothing on the page to compare)</summary><ul>${ruleList(notApplicable)}</ul></details>` : ""}
${off.length ? `<details><summary>${plural(off.length, "rule")} switched off</summary><ul>${ruleList(off)}</ul></details>` : ""}
${notBuilt.length ? `<details open><summary>${plural(notBuilt.length, "rule")} not built yet</summary><ul>${ruleList(notBuilt)}</ul><p class="muted small">These rules have no check yet. They did not pass: they were not run.</p></details>` : ""}
${result.notScanned.length ? `<details open><summary>Not scanned</summary><ul>${result.notScanned.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul></details>` : ""}
</section>`;

  const reviewHtml = review.length
    ? `<section class="card" id="h-review" aria-labelledby="h-review-t"><h3 id="h-review-t" class="label">Needs review</h3>
<p>These differences are often on purpose: a colour that carries a meaning, a featured card, an icon on some items only. Check each one. They are not counted as issues or in the score.</p></section>
${reviewGroups.map((g) => renderRuleDetails(g, peerGroups, "review", true)).join("\n")}`
    : "";

  const excludedHtml = excluded.length
    ? `<section class="card" id="h-excluded" aria-labelledby="h-excluded-t"><h3 id="h-excluded-t" class="label">Excluded issues</h3>
<p>The tester ignored these, added them to the baseline or marked them as intentional. They are not counted as issues or in the score.</p>
<div class="scroll"><table class="grid"><caption class="sr-only">Excluded issues</caption><thead><tr><th scope="col">Rule</th><th scope="col">Element</th><th scope="col">Status</th><th scope="col">Reason</th></tr></thead><tbody>${excludedGroups
        .flatMap((g) => g.issues.map((f) => `<tr><th scope="row">${escapeHtml(g.title)}<br><span class="muted small">${escapeHtml(g.ruleId)}</span></th><td><code>${escapeHtml(f.element.selector)}</code></td><td>${STATUS_TEXT[f.status]}</td><td>${escapeHtml(f.reason ?? "")}</td></tr>`))
        .join("")}</tbody></table></div></section>`
    : "";

  const coverFacts = [
    ["Date", formatDate(result.scannedAt)],
    ["Tolerance", preset],
    ...(organisation ? [["Organisation", organisation]] : []),
    ...(preparedBy ? [["Prepared by", preparedBy]] : []),
  ]
    .map(([k, val]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(val)}</dd>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>UI consistency report: ${escapeHtml(pageTitle)}</title>
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">Skip to report</a>
<header class="cover"><div class="wrap">
<div class="brand"><div><h1>UI consistency report</h1><p class="page">${escapeHtml(pageTitle)} · ${urlHtml}</p></div></div>
<dl aria-label="Report facts">${coverFacts}</dl>
</div></header>
<nav class="toc" aria-label="Report sections"><ul class="wrap">
<li><a href="#part-summary">Summary</a></li>${groups.length ? `<li><a href="#h-top">Fix these first</a></li>` : ""}<li><a href="#h-tested">What was tested</a></li><li><a href="#part-dev">Developer details</a></li>${review.length ? `<li><a href="#h-review">Needs review</a></li>` : ""}${excluded.length ? `<li><a href="#h-excluded">Excluded issues</a></li>` : ""}${result.audit ? `<li><a href="#h-scale">Design scale</a></li>` : ""}<li><a href="#h-lists">Rules checked</a></li><li><a href="#h-scan">Scan details</a></li>
</ul></nav>

<main id="main" class="wrap">
<div class="part first" id="part-summary"><h2>Summary</h2></div>

<section class="card verdict ${v.tone}" aria-labelledby="h-verdict">
<h3 id="h-verdict">${escapeHtml(v.title)}</h3>
<p>${escapeHtml(v.text)}</p>
</section>

<section class="hero" aria-label="Key figures">
<div class="card"><h3 class="label">Consistency score</h3>
<div class="score">${scoreRing(score)}<div><span class="bandpill ${bandCls}">${band}</span>
<p class="muted small">Share of the ${result.groups.length} groups of elements that should look the same which do, with more severe issues counting more. Use it to track progress, not as a pass mark.</p></div></div></div>
<div class="card"><h3 class="label">Issues by severity</h3>
<div class="sev">${severityDonut(counts, active.length)}<ul aria-label="Open issues by severity">${sevList}</ul></div>${
    review.length ? `<p class="rvline"><span class="rvcount">+${review.length}</span><span>need${review.length === 1 ? "s" : ""} review, not counted above. <a href="#h-review">See ${review.length === 1 ? "it" : "them"}</a></span></p>` : ""
  }</div>
<div class="card"><h3 class="label">Rules</h3>
<div class="kpis"><div class="kpi"><b>${groups.length}</b><span>failed</span></div><div class="kpi"><b>${passed.length}</b><span>passed</span></div><div class="kpi"><b>${notApplicable.length}</b><span>not applicable</span></div><div class="kpi"><b>${excluded.length}</b><span>issues excluded</span></div></div></div>
</section>

<div class="two stretch">
${renderTopProblems(groups) || `<section class="card"><h3 class="label">Fix these first</h3><p>Nothing to fix: the automated checks found no open issues.</p></section>`}
${renderAffected(active, peerGroups)}
</div>

<div class="two">
<section class="card" id="h-tested" aria-labelledby="h-tested-t">
<h3 id="h-tested-t" class="label">What was tested</h3>
<dl class="facts-list">
<dt>Page</dt><dd>${escapeHtml(pageTitle)}<br>${urlHtml}</dd>
<dt>Scope</dt><dd>${scopeHtml}</dd>
<dt>Compared</dt><dd>${plural(result.groups.length, "group")} of elements that should look the same, among ${plural(result.elementsScanned, "visible element")}; ${plural(groupsWithIssues, "group")} with issues</dd>
<dt>Method</dt><dd>Automated checks: each element is compared with its peers on the same page (${plural(result.rules.filter((r) => r.outcome !== "disabled" && r.outcome !== "notImplemented").length, "rule")})</dd>
<dt>Tolerance</dt><dd>${escapeHtml(preset)}</dd>
<dt>Date</dt><dd>${escapeHtml(formatDate(result.scannedAt))}</dd>
<dt>Viewport</dt><dd>${escapeHtml(result.viewport?.width)} × ${escapeHtml(result.viewport?.height)} px</dd>
</dl>
</section>
<section class="card limits" aria-labelledby="h-limits">
<h3 id="h-limits" class="label">About this report</h3>
<p>The checks compare elements with their peers on this page. They do not know the design: a page that is consistently wrong still passes.</p>
<p>Still to be judged by a person:</p>
<ul class="small"><li>Differences made on purpose: a featured card, an active item, a status colour (see "Needs review")</li><li>Whether the page matches its design (the "Design scale" section lists its values${result.audit?.tokenFile ? " against the design tokens" : "; load the design tokens to check against them"})</li><li>Screens or parts delivered as images, canvas drawings and frames from another site</li><li>Other pages, other screen widths and other states of this page</li><li>The font actually drawn when the first font of the list is missing</li></ul>
</section>
</div>

<div class="part" id="part-dev"><h2>Developer details</h2><span>Everything needed to find and fix each issue</span></div>
<p class="intro">Each rule below says what it means and how to fix it, then lists every affected element with what was expected and what was found, its peer group, its code location and HTML.</p>

${renderFailedRulesTable(groups)}

${detailsHtml}

${reviewHtml}
${excludedHtml}

${renderDesignScale(result.audit)}

${listsHtml}

<section class="card" id="h-scan" aria-labelledby="h-scan-t">
<h3 id="h-scan-t" class="label">Scan details</h3>
<table class="facts"><caption class="sr-only">Scan details</caption><tbody>
<tr><th scope="row">Page</th><td>${escapeHtml(pageTitle)}</td></tr>
<tr><th scope="row">URL</th><td>${urlHtml}</td></tr>
<tr><th scope="row">Scanned at</th><td>${escapeHtml(formatDate(result.scannedAt))}</td></tr>
<tr><th scope="row">Viewport</th><td>${escapeHtml(result.viewport?.width)} × ${escapeHtml(result.viewport?.height)} px, device pixel ratio ${escapeHtml(result.viewport?.devicePixelRatio)}</td></tr>
<tr><th scope="row">Tolerance</th><td>${escapeHtml(preset)}</td></tr>
<tr><th scope="row">Scope</th><td>${scopeHtml}</td></tr>
<tr><th scope="row">Elements measured</th><td>${escapeHtml(result.elementsScanned)}</td></tr>
<tr><th scope="row">Peer groups</th><td>${escapeHtml(result.groups.length)}</td></tr>
<tr><th scope="row">Scan duration</th><td>${escapeHtml(result.durationMs)} ms</td></tr>
<tr><th scope="row">Engine</th><td>${escapeHtml(result.engineVersion)}</td></tr>
<tr><th scope="row">Scan id</th><td><code>${escapeHtml(result.scanId)}</code></td></tr>
${result.warnings.length ? `<tr><th scope="row">Warnings</th><td>${result.warnings.map(escapeHtml).join("<br>")}</td></tr>` : ""}
</tbody></table>
</section>

<footer><p>Generated by ${escapeHtml(tool.name)} v${escapeHtml(tool.version)} on ${escapeHtml(formatDate(new Date().toISOString()))}${preparedBy ? `, prepared by ${escapeHtml(preparedBy)}` : ""}. The score is a trend indicator, not a sign-off.</p></footer>
</main>
</body>
</html>
`;
}
