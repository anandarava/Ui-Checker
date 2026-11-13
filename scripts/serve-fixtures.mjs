#!/usr/bin/env node
// Tiny static file server for the fixture pages.
//   node scripts/serve-fixtures.mjs            -> http://127.0.0.1:4174/
//   node scripts/serve-fixtures.mjs --port 0   -> random free port (printed)
//   PORT=5000 node scripts/serve-fixtures.mjs
// No dependencies beyond node:http; safe to keep running while you load the
// unpacked extension and scan http://127.0.0.1:4174/<fixture>.html.
import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8",
  ".mp4": "video/mp4",
  ".woff2": "font/woff2",
};

function parsePort(argv) {
  const i = argv.indexOf("--port");
  if (i !== -1 && argv[i + 1] !== undefined) return Number(argv[i + 1]);
  if (process.env.PORT) return Number(process.env.PORT);
  return 4174;
}

async function listing() {
  const entries = await fs.readdir(ROOT, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile() && /\.html?$/i.test(e.name)).map((e) => e.name).sort();
  const items = files.map((f) => `<li><a href="/${encodeURIComponent(f)}">${f}</a></li>`).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>PalTech Accessibility Testing fixtures</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#1a1a1a}a{color:#0b4f9c}</style></head>
<body><main><h1>Fixture pages</h1><p>Each page contains planted accessibility violations and a hidden <code>#expected</code> manifest.</p><ul>${items}</ul></main></body></html>`;
}

export function createFixtureServer(root = ROOT) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === "/" || pathname === "") {
        const html = await listing();
        res.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-store" });
        res.end(html);
        return;
      }
      // Resolve inside the fixtures directory only (no path traversal).
      const filePath = path.resolve(root, "." + pathname);
      if (!filePath.startsWith(root + path.sep) && filePath !== root) {
        res.writeHead(403, { "content-type": "text/plain" });
        res.end("Forbidden");
        return;
      }
      let stat;
      try {
        stat = await fs.stat(filePath);
      } catch {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("Not found: " + pathname);
        return;
      }
      if (stat.isDirectory()) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("Not found: " + pathname);
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const data = await fs.readFile(filePath);
      res.writeHead(200, {
        "content-type": MIME[ext] ?? "application/octet-stream",
        "content-length": data.length,
        "cache-control": "no-store",
      });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch (err) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("Server error: " + (err instanceof Error ? err.message : String(err)));
    }
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = parsePort(process.argv.slice(2));
  const server = createFixtureServer();
  server.on("error", (err) => {
    console.error(`Could not start fixture server: ${err.message}`);
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    console.log(`Fixtures served from ${ROOT}`);
    console.log(`  http://127.0.0.1:${actualPort}/`);
    console.log("Press Ctrl+C to stop.");
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
