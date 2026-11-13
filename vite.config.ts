import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { crx } from "@crxjs/vite-plugin";
import { fileURLToPath } from "node:url";
import manifest from "./manifest.json";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** Source files CRXJS builds as standalone IIFE bundles (`*.iife.ts?script`). */
const IIFE_SOURCE_RE = /\.iife\.(ts|tsx|js|jsx|mjs|cjs)$/;

/**
 * CRXJS builds every `*.iife.ts?script` import into a self-contained IIFE (the
 * file the service worker passes to `chrome.scripting.executeScript({ files })`),
 * but it also leaves the intermediate ESM entry chunk for the same module in the
 * bundle. Nothing references that chunk, so drop it from the output. Chunks that
 * some other chunk still imports are left alone.
 * (Same plugin as in the PalTech Accessibility Testing extension.)
 */
function dropUnreferencedIifeModuleChunks(): Plugin {
  return {
    name: "ui-check:drop-iife-module-chunks",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type !== "chunk" || !output.isEntry) continue;
        if (!output.facadeModuleId || !IIFE_SOURCE_RE.test(output.facadeModuleId)) continue;
        const referenced = Object.values(bundle).some(
          (other) =>
            other.type === "chunk" &&
            other !== output &&
            (other.imports.includes(fileName) || other.dynamicImports.includes(fileName)),
        );
        if (!referenced) delete bundle[fileName];
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), crx({ manifest }), dropUnreferencedIifeModuleChunks()],
  resolve: {
    alias: {
      "@shared": r("./shared"),
      "@src": r("./src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        sidepanel: r("./src/sidepanel/index.html"),
        options: r("./src/options/index.html"),
      },
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    hmr: { port: 5174 },
  },
});
