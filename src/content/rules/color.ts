/**
 * Colour difference for TYP-05. Computed colours are compared as CIE Lab
 * distance (Delta E 1976): below about 3 two colours look the same.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parses "rgb(11, 74, 143)" or "rgba(11, 74, 143, 0.5)"; null for other formats. */
export function parseRgb(color: string): Rgb | null {
  const m = /^rgba?\(([^)]+)\)$/.exec(color);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number.parseFloat);
  if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return null;
  return { r: parts[0], g: parts[1], b: parts[2] };
}

function toLab({ r, g, b }: Rgb): [number, number, number] {
  const linear = (c: number): number => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  // sRGB -> XYZ (D65), scaled by the white point.
  const x = (lr * 0.4124 + lg * 0.3576 + lb * 0.1805) / 0.95047;
  const y = lr * 0.2126 + lg * 0.7152 + lb * 0.0722;
  const z = (lr * 0.0193 + lg * 0.1192 + lb * 0.9505) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Delta E between two computed colours; Infinity when they differ and cannot be parsed. */
export function deltaE(a: string, b: string): number {
  if (a === b) return 0;
  const x = parseRgb(a);
  const y = parseRgb(b);
  if (!x || !y) return Infinity;
  const [l1, a1, b1] = toLab(x);
  const [l2, a2, b2] = toLab(y);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}
