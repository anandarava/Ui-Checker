/**
 * Vitest setup: fill the small gaps between jsdom and a real browser that the
 * content-script modules may rely on. Loaded through `test.setupFiles`.
 */

// jsdom does not implement CSS.escape (used when building selectors from ids).
if (typeof globalThis.CSS === "undefined") {
  (globalThis as unknown as { CSS: { escape(value: string): string } }).CSS = { escape: cssEscape };
} else if (typeof globalThis.CSS.escape !== "function") {
  (globalThis.CSS as unknown as { escape(value: string): string }).escape = cssEscape;
}

/** Minimal CSS.escape per https://drafts.csswg.org/cssom/#serialize-an-identifier */
function cssEscape(value: string): string {
  const s = String(value);
  const length = s.length;
  let result = "";
  const firstCode = s.charCodeAt(0);
  for (let i = 0; i < length; i++) {
    const code = s.charCodeAt(i);
    if (code === 0x0000) {
      result += "�";
      continue;
    }
    if ((code >= 0x0001 && code <= 0x001f) || code === 0x007f || (i === 0 && code >= 0x0030 && code <= 0x0039) || (i === 1 && code >= 0x0030 && code <= 0x0039 && firstCode === 0x002d)) {
      result += "\\" + code.toString(16) + " ";
      continue;
    }
    if (i === 0 && length === 1 && code === 0x002d) {
      result += "\\" + s.charAt(i);
      continue;
    }
    if (code >= 0x0080 || code === 0x002d || code === 0x005f || (code >= 0x0030 && code <= 0x0039) || (code >= 0x0041 && code <= 0x005a) || (code >= 0x0061 && code <= 0x007a)) {
      result += s.charAt(i);
      continue;
    }
    result += "\\" + s.charAt(i);
  }
  return result;
}

// requestIdleCallback is missing in jsdom; yieldToMain implementations may use it.
if (typeof (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback !== "function") {
  (globalThis as unknown as { requestIdleCallback: (cb: (deadline: { didTimeout: boolean; timeRemaining(): number }) => void) => number }).requestIdleCallback = (cb) =>
    setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 0) as unknown as number;
  (globalThis as unknown as { cancelIdleCallback: (id: number) => void }).cancelIdleCallback = (id) => clearTimeout(id);
}
