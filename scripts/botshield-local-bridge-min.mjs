#!/usr/bin/env node
/**
 * Bridge mínimo — só /health (sem imports).
 * Use para validar Node/porta no Windows antes do agente completo.
 *
 *   $env:PORT="8787"
 *   $env:BRIDGE_SECRET="botshieldLocalSecret99"
 *   node scripts/botshield-local-bridge-min.mjs
 */
import http from "node:http";

const PORT = Number(process.env.PORT || process.env.BRIDGE_PORT || 8787) || 8787;
const HOST = process.env.BRIDGE_HOST || "127.0.0.1";
const SECRET = String(
  process.env.BRIDGE_SECRET || process.env.EXCHANGE_LOCAL_BRIDGE_SECRET || ""
).trim();

console.log("[min-bridge] iniciando...");
if (!SECRET || SECRET.length < 12) {
  console.error('ERRO: $env:BRIDGE_SECRET="botshieldLocalSecret99"');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
  const body = JSON.stringify({
    ok: true,
    service: "botshield-local-bridge-min",
    path: url.pathname,
  });
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
});

server.on("error", (e) => {
  console.error("[min-bridge] erro:", e.message || e);
  if (e.code === "EADDRINUSE") {
    console.error(`[min-bridge] porta ${PORT} em uso — feche o outro node ou mude PORT`);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log("==> MIN bridge OK");
  console.log(`    listen  http://${HOST}:${PORT}`);
  console.log("    DEIXE ESTA JANELA ABERTA");
  console.log("Outra janela:");
  console.log(`  Invoke-RestMethod http://${HOST}:${PORT}/health`);
  console.log(`Secret VPS: ${SECRET}`);
});
