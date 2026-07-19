#!/usr/bin/env node
/**
 * Espelha https://arbishield.app e sobe servidor local (SPA).
 * Uso: npm run arbishield:local
 */

import http from "node:http";
import { spawn } from "node:child_process";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "arbishield-local");
const PORT = Number(process.env.ARBISHIELD_LOCAL_PORT ?? "5173");
const ORIGIN = process.env.ARBISHIELD_REMOTE_ORIGIN ?? "https://arbishield.app";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function runMirror() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, "scripts/mirror-arbishield-app.mjs")], {
      cwd: root,
      stdio: "inherit",
    });
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`mirror exit ${code}`))
    );
  });
}

function sendFile(res, filePath) {
  const type = MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
  createReadStream(filePath).pipe(res);
}

function startServer() {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === "/") pathname = "/index.html";

      const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
      let filePath = join(outDir, safe);

      if (!filePath.startsWith(outDir)) {
        res.writeHead(403).end("Forbidden");
        return;
      }

      if (existsSync(filePath) && statSync(filePath).isFile()) {
        sendFile(res, filePath);
        return;
      }

      // SPA fallback
      const index = join(outDir, "index.html");
      if (existsSync(index)) {
        sendFile(res, index);
        return;
      }

      res.writeHead(404).end("Not found");
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log("\n  ArbiShield — acesso local");
    console.log("  ========================");
    console.log(`  App:      http://localhost:${PORT}`);
    console.log(`  Login:    http://localhost:${PORT}/auth`);
    console.log(`  Terminal: http://localhost:${PORT}/app`);
    console.log(`  Backend:  ${ORIGIN} → Supabase wknyfxikmmvjzpbevlid`);
    console.log("\n  No Supabase → Authentication → URL Configuration, adicione:");
    console.log(`    Site URL: http://localhost:${PORT}`);
    console.log(`    Redirect: http://localhost:${PORT}/**\n`);
  });
}

const needsMirror =
  !existsSync(join(outDir, "index.html")) ||
  !existsSync(join(outDir, "assets/main-D_khrzRh.js"));

if (needsMirror || process.argv.includes("--refresh")) {
  console.log(`Espelhando ${ORIGIN} → arbishield-local/ ...`);
  await runMirror();
}

startServer();
