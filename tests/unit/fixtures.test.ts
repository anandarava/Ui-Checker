import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RULES } from "@shared/rules";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURES = path.join(ROOT, "fixtures");

interface Expected {
  id: string;
  rule: string | null;
  target: string;
  note: string;
  review?: boolean;
  both?: boolean;
}

function expectedOf(file: string): Expected[] {
  const html = readFileSync(path.join(FIXTURES, file), "utf8");
  const match = html.match(/<script type="application\/json" id="expected">([\s\S]*?)<\/script>/);
  if (!match) throw new Error(`${file} has no expected manifest`);
  return JSON.parse(match[1]) as Expected[];
}

const NAMES = readdirSync(path.join(FIXTURES, "src"))
  .filter((f) => f.endsWith(".template.html"))
  .map((f) => f.replace(/\.template\.html$/, ""))
  .sort();

describe("fixtures", () => {
  it("are built from their templates and up to date", () => {
    // Throws (non-zero exit) when a generated page differs from its template.
    execFileSync(process.execPath, [path.join(ROOT, "scripts", "build-fixtures.mjs"), "--check"], { cwd: ROOT, stdio: "pipe" });
  });

  it("cover the three reference screens and the card grid built three ways", () => {
    expect(NAMES).toEqual(["compliance", "dashboard", "grid-hashed", "grid-plain", "grid-utility", "table"]);
  });

  it.each(NAMES)("%s: the defects page lists its seeded defects with real rule ids and targets", (name) => {
    const html = readFileSync(path.join(FIXTURES, `${name}-defects.html`), "utf8");
    const expected = expectedOf(`${name}-defects.html`);
    const ruleIds = new Set(RULES.map((r) => r.id));
    expect(expected.length).toBeGreaterThan(0);
    for (const e of expected) {
      if (e.rule !== null) expect(ruleIds.has(e.rule), `${e.id} -> ${e.rule}`).toBe(true);
      expect(html.includes(`data-fx="${e.target}"`), `${e.id} -> ${e.target}`).toBe(true);
      expect(e.note.length, e.id).toBeGreaterThan(10);
    }
  });

  it.each(NAMES)("%s: the clean page expects no definite finding", (name) => {
    const expected = expectedOf(`${name}-clean.html`);
    expect(expected.every((e) => e.both === true && e.review === true)).toBe(true);
  });

  it("gives the three card grids the same defects, so the scan must treat them alike", () => {
    const strip = (list: Expected[]) => list.map(({ id, rule, target }) => ({ id, rule, target }));
    const plain = strip(expectedOf("grid-plain-defects.html"));
    expect(strip(expectedOf("grid-utility-defects.html"))).toEqual(plain);
    expect(strip(expectedOf("grid-hashed-defects.html"))).toEqual(plain);
  });

  it("uses no class name in the hashed grid that hints at what an element is", () => {
    const html = readFileSync(path.join(FIXTURES, "grid-hashed-defects.html"), "utf8");
    const classes = [...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean);
    expect(classes.length).toBeGreaterThan(10);
    for (const c of classes) expect(c).toMatch(/^css-[a-z0-9]+$/);
  });
});
