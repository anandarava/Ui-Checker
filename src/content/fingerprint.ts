/**
 * Deterministic issue fingerprints. No crypto API so the exact same function
 * can run in the content script, the service worker and CI (Playwright).
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** 32-bit FNV-1a over the UTF-16 code units of `ruleId|selector|snippet`, as 8 lowercase hex chars. */
export function fingerprint(ruleId: string, selector: string, textSnippet: string): string {
  const input = `${ruleId}|${selector}|${textSnippet}`;
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

const SNIPPET_MAX = 40;

function collapse(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Trimmed, whitespace-collapsed text content of the element (or its alt /
 * aria-label / title when it has no text), cut to 40 characters.
 */
export function textSnippet(el: Element): string {
  let text = "";
  try {
    text = collapse(el.textContent);
    if (!text) text = collapse(el.getAttribute("alt"));
    if (!text) text = collapse(el.getAttribute("aria-label"));
    if (!text) text = collapse(el.getAttribute("title"));
    if (!text && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      text = collapse(el.getAttribute("placeholder")) || collapse(el.getAttribute("name"));
    }
  } catch {
    text = "";
  }
  return text.length > SNIPPET_MAX ? text.slice(0, SNIPPET_MAX) : text;
}
