import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const container = document.getElementById("root");
if (!container) throw new Error("Side panel root element #root not found");

// `index.html?tabId=N` binds the panel to a fixed tab, so the panel page can be
// opened as a normal tab next to the page under test (end-to-end tests, demos).
const pinned = Number(new URLSearchParams(location.search).get("tabId"));
const tabIdOverride = Number.isInteger(pinned) && pinned > 0 ? pinned : undefined;

createRoot(container).render(
  <StrictMode>
    <App tabIdOverride={tabIdOverride} />
  </StrictMode>,
);
