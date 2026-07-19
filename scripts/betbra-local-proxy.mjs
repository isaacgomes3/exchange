#!/usr/bin/env node
/**
 * Proxy local BetBra — usa o IP da sua máquina para acessar a API.
 * Rode na sua máquina (Brasil): npm run proxy:local
 */

import http from "node:http";
import { networkInterfaces } from "node:os";

const PORT = Number(process.env.BETBRA_PROXY_PORT ?? "8787");
const HOST = process.env.BETBRA_PROXY_HOST ?? "0.0.0.0";

const UA =
  process.env.MEXCHANGE_BOT_USER_AGENT ??
  "BOT/SOFTWARE;ExchangeLive;1.0";
const BIAB_LANGUAGE = process.env.MEXCHANGE_BIAB_LANGUAGE ?? "PT_BR";
const API_BASE =
  process.env.MEXCHANGE_API_BASE_URL ??
  "https://mexchange-api.betbra.bet.br/api";
const SITE_ORIGIN =
  process.env.EXCHANGE_SITE_ORIGIN ?? "https://betbra.bet.br";
const MEXCHANGE_REFERER =
  process.env.MEXCHANGE_REFERER ?? "https://mexchange.betbra.bet.br/";
const INPLAY_URL =
  process.env.MEXCHANGE_INPLAY_FEED_URL ??
  "https://betbra.bet.br/client/api/jumper/feedSports/inplay-info";

function getLocalIps() {
  const ips = [];
  for (const iface of Object.values(networkInterfaces())) {
    for (const addr of iface ?? []) {
      if (addr.family === "IPv4" && !addr.internal) {
        ips.push(addr.address);
      }
    }
  }
  return ips;
}

function buildHeaders(type, sportId, eventId) {
  const cookie = `BIAB_LANGUAGE=${BIAB_LANGUAGE}`;
  const base = {
    Accept: "application/json",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "User-Agent": UA,
    Cookie: cookie,
  };

  if (type === "mexchange") {
    return { ...base, Referer: MEXCHANGE_REFERER };
  }
  if (type === "event-detail") {
    const slug = sportId === "9" ? "tennis" : "soccer";
    return {
      ...base,
      Referer: `${SITE_ORIGIN}/b/exchange/sport/${slug}/event/${eventId}`,
    };
  }
  return { ...base, Referer: `${SITE_ORIGIN}/` };
}

async function forwardToBetBra(targetUrl, headers) {
  const response = await fetch(targetUrl, {
    headers,
    redirect: "manual",
  });

  const text = await response.text();
  const contentType =
    response.headers.get("content-type") ?? "application/json";

  return { status: response.status, text, contentType };
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  try {
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          service: "betbra-local-proxy",
          localIps: getLocalIps(),
          userAgent: UA,
        })
      );
      return;
    }

    if (url.pathname === "/mexchange/events") {
      const target = `${API_BASE}/events${url.search}`;
      const result = await forwardToBetBra(target, buildHeaders("mexchange"));
      res.writeHead(result.status, { "Content-Type": result.contentType });
      res.end(result.text);
      return;
    }

    const eventMatch = url.pathname.match(/^\/mexchange\/events\/([^/]+)$/);
    if (eventMatch) {
      const eventId = eventMatch[1];
      const sportId = url.searchParams.get("sport-id") ?? "15";
      const target = `${API_BASE}/events/${eventId}${url.search}`;
      const result = await forwardToBetBra(
        target,
        buildHeaders("event-detail", sportId, eventId)
      );
      res.writeHead(result.status, { "Content-Type": result.contentType });
      res.end(result.text);
      return;
    }

    if (url.pathname === "/inplay") {
      const result = await forwardToBetBra(INPLAY_URL, buildHeaders("inplay"));
      res.writeHead(result.status, { "Content-Type": result.contentType });
      res.end(result.text);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Rota não encontrada", path: url.pathname }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  }
});

server.listen(PORT, HOST, () => {
  const ips = getLocalIps();
  console.log("");
  console.log("  BetBra Local Proxy — usando IP da sua máquina");
  console.log("  ─────────────────────────────────────────────");
  console.log(`  Local:   http://127.0.0.1:${PORT}`);
  for (const ip of ips) {
    console.log(`  Rede:    http://${ip}:${PORT}`);
  }
  console.log(`  Health:  http://127.0.0.1:${PORT}/health`);
  console.log("");
  console.log("  Configure no .env.local:");
  console.log("  MEXCHANGE_USE_LOCAL_PROXY=1");
  console.log(`  MEXCHANGE_LOCAL_PROXY_URL=http://127.0.0.1:${PORT}`);
  if (ips[0]) {
    console.log(`  # ou na rede: http://${ips[0]}:${PORT}`);
  }
  console.log("");
});
