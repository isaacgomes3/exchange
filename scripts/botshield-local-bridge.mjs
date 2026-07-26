#!/usr/bin/env node
/**
 * Agente local BotShield — roda no PC (Windows) com IP residencial.
 *
 * A VPS chama este agente para login/saldo/account/place na BetBra/Mexchange,
 * evitando o WAF "API blocked" do IP de datacenter.
 *
 * Uso (PowerShell):
 *   $env:BRIDGE_SECRET="troque-este-segredo"
 *   $env:PORT="8787"
 *   $env:EXCHANGE_BRAND="betbra"
 *   node scripts/botshield-local-bridge.mjs
 *
 * Túnel (outro terminal):
 *   cloudflared tunnel --url http://127.0.0.1:8787
 *   → copie a URL https://xxxx.trycloudflare.com para a VPS
 *     EXCHANGE_LOCAL_BRIDGE_URL / EXCHANGE_LOCAL_BRIDGE_SECRET
 */
import http from "node:http";
import { betbraLoginAndBalance } from "./lib/betbra-client-api.mjs";
import {
  fetchMexchangeAccountInfo,
  hasTradingSession,
  sanitizeTradingCookieHeader,
} from "./lib/mexchange-offers.mjs";
import { createOrdersAdapter } from "./lib/exchange-orders-adapter.mjs";

function envStr(name, fallback = "") {
  const v = process.env[name];
  return v == null || v === "" ? fallback : String(v);
}

const PORT = Number(envStr("PORT", envStr("BRIDGE_PORT", "8787"))) || 8787;
const HOST = envStr("BRIDGE_HOST", "127.0.0.1");
const SECRET = envStr(
  "BRIDGE_SECRET",
  envStr("EXCHANGE_LOCAL_BRIDGE_SECRET", "")
).trim();

if (!SECRET || SECRET.length < 12) {
  console.error(
    "ERRO: defina BRIDGE_SECRET com pelo menos 12 caracteres.\n" +
      '  PowerShell: $env:BRIDGE_SECRET="um-segredo-longo-aqui"'
  );
  process.exit(1);
}

// Garantir marca BetBra no processo local (salvo override)
if (!process.env.EXCHANGE_BRAND) process.env.EXCHANGE_BRAND = "betbra";
if (!process.env.EXCHANGE_ORDERS_LIVE) process.env.EXCHANGE_ORDERS_LIVE = "1";
if (!process.env.EXCHANGE_ORDERS_AUTH_STYLE) {
  process.env.EXCHANGE_ORDERS_AUTH_STYLE = "cookie";
}
if (!process.env.EXCHANGE_ORDERS_PAYLOAD) {
  process.env.EXCHANGE_ORDERS_PAYLOAD = "mexchange";
}
// Nunca o agente local chama a si mesmo via bridge
process.env.EXCHANGE_LOCAL_BRIDGE = "0";
delete process.env.EXCHANGE_LOCAL_BRIDGE_URL;
delete process.env.BOTSHIELD_LOCAL_BRIDGE_URL;

const adapter = createOrdersAdapter();

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function unauthorized(res) {
  send(res, 401, {
    ok: false,
    error: "Segredo do bridge inválido",
    code: "BRIDGE_UNAUTHORIZED",
  });
}

function checkAuth(req) {
  const h = String(req.headers.authorization || "");
  const bearer = h.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  const x = String(req.headers["x-botshield-bridge-secret"] || "").trim();
  return bearer === SECRET || x === SECRET;
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function scrubSession(session = {}) {
  const s = { ...session };
  if (s.cookieHeader) {
    s.cookieHeader = sanitizeTradingCookieHeader(s.cookieHeader);
  }
  return s;
}

async function publicIp() {
  const urls = [
    "https://api.ipify.org",
    "https://ifconfig.me/ip",
    "https://icanhazip.com",
  ];
  for (const u of urls) {
    try {
      const r = await fetch(u, {
        headers: { Accept: "text/plain" },
        signal: AbortSignal.timeout(4000),
      });
      const t = String(await r.text() || "")
        .trim()
        .split(/\s+/)[0];
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(t)) return t;
    } catch {
      /* next */
    }
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      // health público mínimo (sem secret) para o túnel; detalhes exigem auth
      if (!checkAuth(req)) {
        return send(res, 200, { ok: true, service: "botshield-local-bridge" });
      }
      const ip = await publicIp();
      return send(res, 200, {
        ok: true,
        service: "botshield-local-bridge",
        brand: envStr("EXCHANGE_BRAND", "betbra"),
        publicIp: ip,
        live: process.env.EXCHANGE_ORDERS_LIVE === "1",
      });
    }

    if (!checkAuth(req)) return unauthorized(res);

    if (req.method === "GET" && url.pathname === "/v1/public-ip") {
      const ip = await publicIp();
      return send(res, 200, { ok: true, publicIp: ip });
    }

    if (req.method === "POST" && url.pathname === "/v1/login-balance") {
      const body = await readJson(req);
      const out = await betbraLoginAndBalance({
        login: body.login,
        password: body.password,
        validationCode: body.validationCode || body.code,
      });
      return send(res, 200, {
        ...out,
        via: "local-bridge",
        publicIp: await publicIp(),
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/mexchange-account") {
      const body = await readJson(req);
      let session = scrubSession(body.session || {});
      if (!hasTradingSession(session)) {
        return send(res, 400, {
          ok: false,
          authenticated: false,
          accountId: null,
          error: "Sessão sem cookies/token",
          code: "BETBRA_NO_SESSION",
        });
      }
      const acc = await fetchMexchangeAccountInfo(session);
      const authenticated = !!(acc.ok && acc.accountId);
      const balance =
        acc.raw?.balance != null
          ? Number(acc.raw.balance)
          : acc.raw?.availableBalance != null
            ? Number(acc.raw.availableBalance)
            : null;
      return send(res, authenticated ? 200 : 401, {
        ok: authenticated,
        authenticated,
        accountId: acc.accountId || null,
        balance: Number.isFinite(balance) ? balance : null,
        currency: acc.currency,
        httpStatus: acc.status,
        via: "local-bridge",
        publicIp: await publicIp(),
        hint: authenticated
          ? "Sessão OK via PC local — pode tentar place."
          : "accountId vazio mesmo no IP local — faça login/código no bridge ou cole Cookie fresco.",
        rawKeys:
          acc.raw && typeof acc.raw === "object" ? Object.keys(acc.raw) : [],
      });
    }

    if (req.method === "POST" && url.pathname === "/v1/place") {
      const body = await readJson(req);
      const session = scrubSession(body.session || {});
      const out = await adapter.placeOrder(session, body.payload || {});
      return send(res, 200, { ...out, via: "local-bridge" });
    }

    if (req.method === "POST" && url.pathname === "/v1/cancel") {
      const body = await readJson(req);
      const session = scrubSession(body.session || {});
      const out = await adapter.cancelOrder(session, body.orderId);
      return send(res, 200, { ...out, via: "local-bridge" });
    }

    send(res, 404, { ok: false, error: "not found" });
  } catch (err) {
    send(res, err.status || 500, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: err.code || undefined,
      validationRequired: err.validationRequired || undefined,
      details: err.details || undefined,
    });
  }
});

server.listen(PORT, HOST, async () => {
  const ip = await publicIp().catch(() => null);
  console.log("==> BotShield local bridge");
  console.log(`    listen  http://${HOST}:${PORT}`);
  console.log(`    brand   ${envStr("EXCHANGE_BRAND", "betbra")}`);
  console.log(`    publicIp ${ip || "(desconhecido)"}`);
  console.log("");
  console.log("Túnel (outro terminal):");
  console.log(`  cloudflared tunnel --url http://${HOST}:${PORT}`);
  console.log("Na VPS (.env):");
  console.log("  EXCHANGE_LOCAL_BRIDGE_URL=https://SEU-TUNEL.trycloudflare.com");
  console.log(`  EXCHANGE_LOCAL_BRIDGE_SECRET=${SECRET.slice(0, 4)}…`);
  console.log("  EXCHANGE_LOCAL_BRIDGE=1");
});
