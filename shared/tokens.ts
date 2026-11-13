/**
 * Reads a design-token file into the values the design-scale audit compares
 * with (PLAN.md, Phase 5). Understood:
 *
 *  - the Design Tokens Community Group format: `{ "$value": ..., "$type": ... }`,
 *    with a `$type` inherited from the group
 *  - Tokens Studio for Figma and Style Dictionary: `{ "value": ..., "type": ... }`
 *  - plain nested objects: `{ "colors": { "primary": "#0b4a8f" }, "spacing": { "sm": "8px" } }`
 *  - aliases: `"{color.brand.primary}"`
 *  - composite `typography` tokens (their family, size and weight)
 *
 * Only what the audit lists is kept: font families, font sizes, font weights,
 * spacing and colours. Everything else in the file (radii, shadows, line
 * heights...) is skipped.
 */
import type { DesignToken, DesignTokens, ScaleKind } from "./types";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const KINDS: ScaleKind[] = ["fontFamily", "fontSize", "fontWeight", "spacing", "color"];

const WEIGHT_NAMES: Record<string, number> = {
  thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300, regular: 400, normal: 400, book: 400, medium: 500,
  semibold: 600, demibold: 600, bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900,
};

/** The `type` / `$type` of a token, mapped to what the audit lists; null for types it does not list. */
function kindOfType(type: string): ScaleKind | "length" | "typography" | null {
  switch (type.toLowerCase().replace(/[\s_-]/g, "")) {
    case "color":
      return "color";
    case "fontfamily":
    case "fontfamilies":
      return "fontFamily";
    case "fontsize":
    case "fontsizes":
      return "fontSize";
    case "fontweight":
    case "fontweights":
      return "fontWeight";
    case "spacing":
    case "space":
      return "spacing";
    case "typography":
      return "typography";
    case "dimension":
    case "sizing":
    case "number":
    case "other":
      return "length";
    default:
      return null;
  }
}

/** What a token without a usable type describes, from the names on its path. */
function kindOfPath(path: string[]): ScaleKind | null {
  const p = path.join(".").toLowerCase();
  if (/line-?height|letter-?spacing|radius|radii|shadow|opacity|z-?index|breakpoint|duration|border-?width/.test(p)) return null;
  if (/(font|text|type)[-._ ]?sizes?/.test(p)) return "fontSize";
  if (/weight/.test(p)) return "fontWeight";
  if (/famil|typeface/.test(p)) return "fontFamily";
  if (/spac|gap|padding|margin|inset/.test(p)) return "spacing";
  if (/colou?r|palette|background|\bbg\b|fill|brand/.test(p)) return "color";
  return null;
}

const clamp = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));

function rgbString(r: number, g: number, b: number, a = 1): string {
  return a >= 1 ? `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(b)})` : `rgba(${clamp(r)}, ${clamp(g)}, ${clamp(b)}, ${Math.round(a * 1000) / 1000})`;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number): number => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** A colour as the browser computes it ("rgb(11, 74, 143)"); null when the text is not a colour. */
export function parseColour(value: unknown): string | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    // The newer Design Tokens colour object: { colorSpace: "srgb", components: [r, g, b], alpha, hex }.
    const o = value as { hex?: unknown; components?: unknown; alpha?: unknown; colorSpace?: unknown };
    if (typeof o.hex === "string") return parseColour(o.hex);
    if (Array.isArray(o.components) && o.components.length >= 3 && (o.colorSpace === undefined || o.colorSpace === "srgb")) {
      const [r, g, b] = o.components.map(Number);
      return rgbString(r * 255, g * 255, b * 255, typeof o.alpha === "number" ? o.alpha : 1);
    }
    return null;
  }
  if (typeof value !== "string") return null;
  const s = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.replace(/./g, "$&$&");
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number): number => Number.parseInt(h.slice(i, i + 2), 16);
    return rgbString(n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1);
  }
  const fn = /^(rgba?|hsla?)\(([^)]+)\)$/.exec(s);
  if (!fn) return null;
  const parts = fn[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const num = (text: string, scale = 1): number => (text.endsWith("%") ? (Number.parseFloat(text) / 100) * scale : Number.parseFloat(text));
  const alpha = parts[3] === undefined ? 1 : num(parts[3], 1);
  if (fn[1].startsWith("rgb")) {
    const [r, g, b] = parts.slice(0, 3).map((p) => num(p, 255));
    return [r, g, b, alpha].every(Number.isFinite) ? rgbString(r, g, b, alpha) : null;
  }
  const h = Number.parseFloat(parts[0]);
  const sat = num(parts[1], 1);
  const light = num(parts[2], 1);
  if (![h, sat, light, alpha].every(Number.isFinite)) return null;
  const [r, g, b] = hslToRgb(((h % 360) + 360) % 360, sat, light);
  return rgbString(r, g, b, alpha);
}

/** A length in px: a number, "16px", "1rem" (16px) or "16". Null for other units. */
export function parseLength(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    // The newer Design Tokens dimension object: { value: 16, unit: "px" }.
    const o = value as { value?: unknown; unit?: unknown };
    return typeof o.value === "number" && typeof o.unit === "string" ? parseLength(`${o.value}${o.unit}`) : null;
  }
  if (typeof value !== "string") return null;
  const m = /^(-?\d*\.?\d+)(px|rem)?$/.exec(value.trim().toLowerCase());
  if (!m) return null;
  const n = Number.parseFloat(m[1]);
  return m[2] === "rem" ? n * 16 : n;
}

function parseWeight(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return null;
  const s = value.trim().toLowerCase();
  if (/^\d{3,4}$/.test(s)) return Number(s);
  return WEIGHT_NAMES[s.replace(/[\s_-]/g, "")] ?? null;
}

function parseFamily(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : typeof value === "string" ? value.split(",")[0] : null;
  if (typeof first !== "string") return null;
  const name = first.trim().replace(/^["']|["']$/g, "");
  return name === "" ? null : name;
}

function isObject(value: Json | undefined): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface Leaf {
  path: string[];
  value: Json;
  type: string;
}

/**
 * Reads a token file. `name` is the file name, shown in the UI.
 * Throws a readable error when the text is not JSON or holds no token the audit can use.
 */
export function parseTokens(text: string, name: string): DesignTokens {
  let root: Json;
  try {
    root = JSON.parse(text) as Json;
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  if (!isObject(root)) throw new Error("This file does not hold design tokens: it must be a JSON object.");

  // 1. Every token of the file, with the type it states or inherits.
  const leaves: Leaf[] = [];
  const walk = (node: Json, path: string[], inherited: string): void => {
    if (!isObject(node)) {
      if (typeof node === "string" || typeof node === "number") leaves.push({ path, value: node, type: inherited });
      return;
    }
    const typeHere = typeof node.$type === "string" ? node.$type : inherited;
    const valueKey = "$value" in node ? "$value" : "value" in node && !isObject(node.value) ? "value" : "value" in node && typeof node.type === "string" ? "value" : null;
    if (valueKey) {
      const type = typeof node.$type === "string" ? node.$type : typeof node.type === "string" ? node.type : inherited;
      leaves.push({ path, value: node[valueKey], type });
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith("$")) continue;
      walk(child, [...path, key], typeHere);
    }
  };
  walk(root, [], "");

  // 2. Aliases: "{color.brand.primary}", also when the file wraps its tokens in sets ("global.color...").
  const byPath = new Map(leaves.map((leaf) => [leaf.path.join("."), leaf]));
  const lookup = (ref: string): Leaf | undefined => byPath.get(ref) ?? leaves.find((leaf) => leaf.path.join(".").endsWith(`.${ref}`));
  const resolve = (value: Json, depth = 0): Json => {
    if (typeof value !== "string" || depth > 8) return value;
    const alias = /^\{([^{}]+)\}$/.exec(value.trim());
    if (!alias) return value;
    const target = lookup(alias[1].trim());
    return target ? resolve(target.value, depth + 1) : value;
  };

  // 3. Keep what the audit lists.
  const out: Record<ScaleKind, DesignToken[]> = { fontFamily: [], fontSize: [], fontWeight: [], spacing: [], color: [] };
  const seen = new Set<string>();
  const add = (kind: ScaleKind, tokenName: string, value: string | number | null): void => {
    if (value === null || (typeof value === "number" && (!Number.isFinite(value) || value < 0))) return;
    const key = `${kind}|${typeof value === "string" ? value.toLowerCase() : value}`;
    if (seen.has(key)) return;
    seen.add(key);
    out[kind].push({ name: tokenName, value });
  };
  const read = (kind: ScaleKind, tokenName: string, value: Json): void => {
    if (kind === "color") add(kind, tokenName, parseColour(value));
    else if (kind === "fontFamily") add(kind, tokenName, parseFamily(value));
    else if (kind === "fontWeight") add(kind, tokenName, parseWeight(value));
    else add(kind, tokenName, parseLength(value));
  };

  for (const leaf of leaves) {
    const tokenName = leaf.path.join(".");
    const value = resolve(leaf.value);
    const stated = leaf.type ? kindOfType(leaf.type) : "length";
    if (stated === null) continue;
    if (stated === "typography") {
      if (!isObject(value)) continue;
      read("fontFamily", `${tokenName}.fontFamily`, resolve(value.fontFamily ?? null));
      read("fontSize", `${tokenName}.fontSize`, resolve(value.fontSize ?? null));
      read("fontWeight", `${tokenName}.fontWeight`, resolve(value.fontWeight ?? null));
      continue;
    }
    if (stated !== "length") {
      read(stated, tokenName, value);
      continue;
    }
    // No type, or only "a length": the names on the path say what it is; a colour is recognised by its value.
    const guessed = kindOfPath(leaf.path) ?? (!leaf.type && parseColour(value) && typeof value === "string" && /^(#|rgb|hsl)/i.test(value.trim()) ? "color" : null);
    if (guessed) read(guessed, tokenName, value);
  }

  if (KINDS.every((kind) => out[kind].length === 0)) {
    throw new Error("No font, spacing or colour tokens were found in this file.");
  }
  return { name, ...out };
}

/** "12 colours, 6 spacing values, 5 font sizes": what a token file holds, for the UI. */
export function describeTokens(tokens: DesignTokens): string {
  const parts: Array<[number, string, string]> = [
    [tokens.color.length, "colour", "colours"],
    [tokens.spacing.length, "spacing value", "spacing values"],
    [tokens.fontSize.length, "font size", "font sizes"],
    [tokens.fontWeight.length, "font weight", "font weights"],
    [tokens.fontFamily.length, "font family", "font families"],
  ];
  return parts
    .filter(([n]) => n > 0)
    .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
    .join(", ");
}
