/**
 * DevTools panel page: renders the same App as the side panel, bound to the
 * inspected tab, with a "Scan selected element ($0)" scope.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@src/sidepanel/App";

/**
 * Evaluated in the inspected page: a CSS selector for $0 that is unique in
 * the top document (id when unique, else a tag:nth-of-type path). Returns
 * null when nothing is selected or $0 lives in another document / shadow root.
 */
const SELECTED_ELEMENT_SELECTOR = `(function (el) {
  if (!el || el.nodeType !== 1 || el.ownerDocument !== document || el.getRootNode() !== document) return null;
  var esc = function (s) { return window.CSS && CSS.escape ? CSS.escape(s) : s; };
  var parts = [];
  while (el && el.nodeType === 1 && el !== document.documentElement) {
    if (el.id && document.querySelectorAll("#" + esc(el.id)).length === 1) { parts.unshift("#" + esc(el.id)); break; }
    var part = el.tagName.toLowerCase();
    var parent = el.parentElement;
    if (parent) {
      var same = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === el.tagName; });
      if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(el) + 1) + ")";
    }
    parts.unshift(part);
    el = parent;
  }
  return parts.length ? parts.join(" > ") : "html";
})($0)`;

function getInspectedSelector(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      chrome.devtools.inspectedWindow.eval(SELECTED_ELEMENT_SELECTOR, (result: unknown, exceptionInfo?: chrome.devtools.inspectedWindow.EvaluationExceptionInfo) => {
        if (exceptionInfo && (exceptionInfo.isException || exceptionInfo.isError)) resolve(null);
        else resolve(typeof result === "string" && result ? result : null);
      });
    } catch {
      resolve(null);
    }
  });
}

const container = document.getElementById("root");
if (!container) throw new Error("DevTools panel root element #root not found");

createRoot(container).render(
  <StrictMode>
    <App tabIdOverride={chrome.devtools.inspectedWindow.tabId} getInspectedSelector={getInspectedSelector} />
  </StrictMode>,
);
