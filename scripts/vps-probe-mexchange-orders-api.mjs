#!/usr/bin/env node
/**
 * Probe da API pública autenticada de trading (Mexchange/BetBra).
 * Rodar na VPS (IP BR) — daqui o Cloudflare redireciona para countryblock.
 *
 *   node scripts/vps-probe-mexchange-orders-api.mjs
 *   EXCHANGE_SESSION_TOKEN=... node scripts/vps-probe-mexchange-orders-api.mjs
 *
 * Marker: vps-probe-mexchange-orders-api-v1
 */
import {
  resolveOrdersApiBase,
  buildExchangeAuthHeaders,
  EXCHANGE_PUBLIC_TRADING_API,
} from "./lib/exchange-orders-adapter.mjs";

const BASE = resolveOrdersApiBase();
const TOKEN = String(
  process.env.EXCHANGE_SESSION_TOKEN ||
    process.env.MEXCHANGE_SESSION_TOKEN ||
    ""
).trim();
const AUTH_STYLE = String(process.env.EXCHANGE_ORDERS_AUTH_STYLE || "bearer");

const PATHS = [
  "/orders",
  "/v1/orders",
  "/trading/orders",
  "/bets",
  "/bet",
  "/customer/orders",
  "/customer/bets",
  "/offers",
  "/offer",
  "/unmatched",
  "/matched-bets",
  "/account",
  "/account/orders",
  "/session",
  "/events?sport-id=15",
];

async function probe(path, withAuth) {
  const url = `${BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const session = withAuth && TOKEN ? { accessToken: TOKEN } : {};
  const headers = buildExchangeAuthHeaders(session, AUTH_STYLE);
  if (!withAuth) {
    delete headers.Authorization;
    delete headers["X-Auth-Token"];
  }
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      headers,
      redirect: "manual",
    });
  } catch (e) {
    return {
      path,
      auth: withAuth,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  const text = await res.text();
  const ct = res.headers.get("content-type") || "";
  const loc = res.headers.get("location") || "";
  let snippet = text.slice(0, 160).replace(/\s+/g, " ");
  if (ct.includes("html") || snippet.startsWith("<!")) {
    snippet = "[html]";
  }
  return {
    path,
    auth: withAuth,
    status: res.status,
    ms: Date.now() - t0,
    ct: ct.slice(0, 40),
    location: loc.slice(0, 80),
    snippet,
  };
}

async function main() {
  console.log("==> probe mexchange orders API");
  console.log("    marker:", "vps-probe-mexchange-orders-api-v1");
  console.log("    publicApi:", EXCHANGE_PUBLIC_TRADING_API);
  console.log("    base:", BASE);
  console.log("    authStyle:", AUTH_STYLE);
  console.log("    token:", TOKEN ? `${TOKEN.slice(0, 6)}…` : "(nenhum — só anônimo)");
  console.log("");

  for (const path of PATHS) {
    const anon = await probe(path, false);
    console.log(
      JSON.stringify({
        ...anon,
        kind: "anon",
      })
    );
    if (TOKEN) {
      const authed = await probe(path, true);
      console.log(
        JSON.stringify({
          ...authed,
          kind: "authed",
        })
      );
    }
  }

  console.log("");
  console.log("OK — revise status 200/401/405 vs 302 countryblock.");
  console.log("Paths 401/405 com token costumam indicar endpoint real.");
  console.log(
    "Depois setar EXCHANGE_ORDERS_PLACE_PATH / CANCEL_PATH / STATUS_PATH + EXCHANGE_ORDERS_LIVE=1"
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
