#!/usr/bin/env node
/**
 * Sugestões de desafio (Over/Under 2.5 + Ambas Marcam, odds BetBra 1.60–1.80, janela 24h).
 * Standalone para VPS — também sobe HTTP em --serve.
 *
 * Uso:
 *   node scripts/arbishield-desafio-suggestions.mjs
 *   node scripts/arbishield-desafio-suggestions.mjs --serve
 *   PROFIT_MARGIN_PCT=7 node scripts/arbishield-desafio-suggestions.mjs
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!(k in process.env)) process.env[k] = v;
  }
}

loadEnvFile(resolve(root, ".env.local"));
loadEnvFile(resolve(root, ".env"));
loadEnvFile("/opt/arbishield/deploy/vps-supabase/.env");
loadEnvFile("/opt/arbishield/.arbishield-odds-sync.env");

const UA = process.env.MEXCHANGE_BOT_USER_AGENT || "BOT/SOFTWARE;Arbitrex;1.0";
const API_BASE =
  process.env.MEXCHANGE_API_BASE_URL ||
  "https://mexchange-api.betbra.bet.br/api";
const REFERER =
  process.env.MEXCHANGE_REFERER || "https://mexchange.betbra.bet.br/";
const SITE = process.env.EXCHANGE_SITE_ORIGIN || "https://betbra.bet.br";
const SOCCER_ID = Number(process.env.FULLTBET_SOCCER_SPORT_ID || "15");
const SPACING = Number(process.env.MEXCHANGE_REQUEST_SPACING_MS || 200);
const LISTEN =
  process.env.DESAFIO_SUGGESTIONS_LISTEN || "127.0.0.1:3099";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastReq = 0;
async function spaced(fn) {
  const wait = Math.max(0, SPACING - (Date.now() - lastReq));
  if (wait) await sleep(wait);
  lastReq = Date.now();
  return fn();
}

async function betbra(url, headers = {}) {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Language": "pt-BR,pt;q=0.9",
      "User-Agent": UA,
      Referer: REFERER,
      Cookie: "BIAB_LANGUAGE=PT_BR",
      ...headers,
    },
  });
  const text = await res.text();
  if (!res.ok || text.trim().startsWith("<!")) {
    throw new Error(`BetBra ${res.status}: ${text.slice(0, 120)}`);
  }
  return JSON.parse(text);
}

function calcArbiOddFromCasa(casaOdd, profitMarginPct) {
  const m = profitMarginPct / 100;
  const invTarget = 1 - m;
  const invCasa = 1 / casaOdd;
  if (invCasa >= invTarget) return null;
  const arbi = 1 / (invTarget - invCasa);
  if (!Number.isFinite(arbi) || arbi <= 1) return null;
  return Number(arbi.toFixed(3));
}

function calcStakes(casaOdd, arbiOdd, liquidityCents) {
  const arbiStakeCents = Math.max(100, Math.round(liquidityCents * 0.1));
  const casaStakeCents = Math.max(
    100,
    Math.round((arbiStakeCents * arbiOdd) / casaOdd)
  );
  const marginPct = (1 - (1 / casaOdd + 1 / arbiOdd)) * 100;
  return {
    casaStakeCents,
    arbiStakeCents,
    marginPct: Number(marginPct.toFixed(2)),
  };
}

function runnerOdd(runner) {
  const prices = runner.prices || [];
  const backs = prices.filter((p) => p.side === "back");
  if (backs.length) {
    return backs.reduce((a, b) =>
      a["decimal-odds"] > b["decimal-odds"] ? a : b
    )["decimal-odds"];
  }
  const last = runner["last-matched-odds"];
  return typeof last === "number" && last > 1 ? last : null;
}

function isOu25(market) {
  const name = (market.name || "").toLowerCase();
  const type = (market["market-type"] || "").toLowerCase();
  if (/1st|half|1º|1o|tempo|intervalo/.test(name)) return false;
  const labels = (market.runners || []).map((r) => (r.name || "").toLowerCase());
  const has25 =
    labels.some((l) => /\b2[.,]5\b/.test(l)) || /\b2[.,]5\b/.test(name);
  const isOu =
    name.includes("over") ||
    name.includes("under") ||
    name === "total" ||
    type.includes("total");
  return has25 && isOu;
}

function isAmbasMarcam(market) {
  const name = (market.name || "").toLowerCase();
  const type = (market["market-type"] || "").toLowerCase();
  if (/1st|half|1º|1o|tempo|intervalo/.test(name)) return false;
  if (
    name.includes("ambas") ||
    name.includes("both teams") ||
    name.includes("btts") ||
    type.includes("both_teams") ||
    type.includes("btts") ||
    /\bgg\b/.test(name)
  ) {
    return true;
  }
  const labels = (market.runners || []).map((r) => (r.name || "").toLowerCase());
  const hasYesNo =
    labels.some((l) => /^(sim|yes|gg)$/.test(l.trim())) &&
    labels.some((l) => /^(n[aã]o|no|ng)$/.test(l.trim()));
  return hasYesNo && (name.includes("marcam") || name.includes("score"));
}

function classifyOu(name) {
  const n = name.toLowerCase();
  if (!/\b2[.,]5\b/.test(n)) return null;
  if (/mais|over|acima/.test(n)) return "over_2_5";
  if (/menos|under|abaixo/.test(n)) return "under_2_5";
  return null;
}

function classifyBtts(name) {
  const n = name.toLowerCase().trim();
  if (n === "sim" || n === "yes" || n === "gg" || /^yes\b/.test(n)) {
    return "btts_yes";
  }
  if (
    n === "nao" ||
    n === "não" ||
    n === "no" ||
    n === "ng" ||
    /^no\b/.test(n)
  ) {
    return "btts_no";
  }
  return null;
}

function sideLabel(side) {
  switch (side) {
    case "over_2_5":
      return "Mais 2.5 gols na partida";
    case "under_2_5":
      return "Menos 2.5 gols na partida";
    case "btts_yes":
      return "Ambas Marcam — Sim";
    case "btts_no":
      return "Ambas Marcam — Não";
    default:
      return side;
  }
}

function opposite(side) {
  switch (side) {
    case "over_2_5":
      return "under_2_5";
    case "under_2_5":
      return "over_2_5";
    case "btts_yes":
      return "btts_no";
    case "btts_no":
      return "btts_yes";
    default:
      return side;
  }
}

function parseTeams(event) {
  const parts = event.name.split(/\s+vs\.?\s+/i);
  if (parts.length >= 2) return { home: parts[0].trim(), away: parts[1].trim() };
  return { home: event.name, away: "—" };
}

async function loadDetails(afterMs, beforeMs) {
  const after = Math.floor(afterMs / 1000);
  const before = Math.floor(beforeMs / 1000);
  const params = new URLSearchParams({
    offset: "0",
    "per-page": "50",
    after: String(after),
    before: String(before),
    ids: "",
    "sport-ids": String(SOCCER_ID),
    "sort-by": "start-time",
    "sort-direction": "asc",
    "en-market-names": "Moneyline,Match Odds,Winner",
  });
  const list = await spaced(() =>
    betbra(`${API_BASE}/events?${params}`)
  );
  const events = (list.events || []).filter(
    (e) =>
      !e["in-running-flag"] &&
      /vs\.?/i.test(e.name) &&
      new Date(e.start).getTime() >= afterMs &&
      new Date(e.start).getTime() <= beforeMs
  );
  const details = [];
  for (const e of events) {
    try {
      const detail = await spaced(() =>
        betbra(`${API_BASE}/events/${e.id}`, {
          Referer: `${SITE}/b/exchange/sport/soccer/event/${e.id}`,
        })
      );
      if (detail?.markets?.length) details.push(detail);
    } catch {
      /* skip */
    }
  }
  return details;
}

function buildSuggestion(event, market, kind, params) {
  const odds = {};
  const classify = kind === "over_under_25" ? classifyOu : classifyBtts;
  const sides =
    kind === "over_under_25"
      ? ["over_2_5", "under_2_5"]
      : ["btts_yes", "btts_no"];
  for (const runner of market.runners || []) {
    const side = classify(runner.name || "");
    if (!side) continue;
    const odd = runnerOdd(runner);
    if (odd != null) odds[side] = Number(Number(odd).toFixed(3));
  }
  const candidates = [];
  for (const side of sides) {
    const odd = odds[side];
    if (odd != null && odd >= params.casaOddMin && odd <= params.casaOddMax) {
      candidates.push({ side, odd });
    }
  }
  if (!candidates.length) return null;
  const mid = (params.casaOddMin + params.casaOddMax) / 2;
  candidates.sort((a, b) => Math.abs(a.odd - mid) - Math.abs(b.odd - mid));
  const pick = candidates[0];
  const arbiSide = opposite(pick.side);
  const arbiOdd = calcArbiOddFromCasa(pick.odd, params.profitMarginPct);
  if (arbiOdd == null) return null;
  const stakes = calcStakes(pick.odd, arbiOdd, params.liquidityCents);
  const teams = parseTeams(event);
  const minutesToKickoff = Math.max(
    0,
    Math.round((new Date(event.start).getTime() - Date.now()) / 60000)
  );
  const marketLabel =
    kind === "over_under_25" ? "Over/Under 2.5" : "Ambas Marcam";
  return {
    eventId: event.id,
    eventName: event.name,
    homeTeam: teams.home,
    awayTeam: teams.away,
    startsAt: event.start,
    minutesToKickoff,
    betbraMarketId: String(market.id),
    betbraLink: `${SITE}/b/exchange/sport/soccer/event/${event.id}/market/${market.id}`,
    marketKind: kind,
    casaSide: pick.side,
    casaMarketName: sideLabel(pick.side),
    casaOdd: pick.odd,
    arbiSide,
    arbiMarketName: sideLabel(arbiSide),
    arbiOdd,
    profitMarginPct: stakes.marginPct,
    casaStakeCents: stakes.casaStakeCents,
    arbiStakeCents: stakes.arbiStakeCents,
    liquidityCents: params.liquidityCents,
    rationale:
      `Entrada BetBra em ${marketLabel}: ${sideLabel(pick.side)} @ ${pick.odd}. ` +
      `ArbiShield oferece o contrário @ ${arbiOdd} (~${stakes.marginPct}% margem).`,
  };
}

function suggestionsFromEvent(event, params) {
  const out = [];
  const markets = event.markets || [];
  const ou = markets.find(isOu25);
  if (ou) {
    const s = buildSuggestion(event, ou, "over_under_25", params);
    if (s) out.push(s);
  }
  const btts = markets.find(isAmbasMarcam);
  if (btts) {
    const s = buildSuggestion(event, btts, "ambas_marcam", params);
    if (s) out.push(s);
  }
  return out;
}

const WINDOW_24H_MINUTES = 24 * 60;

export async function generateDesafioSuggestions(input = {}) {
  const params = {
    casaOddMin: Number(input.casaOddMin ?? process.env.CASA_ODD_MIN ?? 1.6),
    casaOddMax: Number(input.casaOddMax ?? process.env.CASA_ODD_MAX ?? 1.8),
    profitMarginPct: Number(
      input.profitMarginPct ?? process.env.PROFIT_MARGIN_PCT ?? 5
    ),
    preLiveMinutes: Number(
      input.preLiveMinutes ?? process.env.PRELIVE_MINUTES ?? WINDOW_24H_MINUTES
    ),
    liquidityCents: Number(
      input.liquidityCents ?? process.env.LIQUIDITY_CENTS ?? 200000
    ),
    fallbackToday:
      input.fallbackToday !== undefined
        ? Boolean(input.fallbackToday)
        : process.env.FALLBACK_TODAY !== "0",
  };

  const now = Date.now();
  const windowTo = now + params.preLiveMinutes * 60_000;

  const details = await loadDetails(now, windowTo);
  const suggestions = details
    .flatMap((ev) => {
      try {
        return suggestionsFromEvent(ev, params);
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.minutesToKickoff - b.minutesToKickoff);

  return {
    ok: true,
    suggestions,
    scannedEvents: details.length,
    window: {
      from: new Date(now).toISOString(),
      to: new Date(windowTo).toISOString(),
      mode: "next_24h",
    },
    params,
  };
}

function parseBody(req) {
  return new Promise((resolvePromise) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1e6) req.destroy();
    });
    req.on("end", () => {
      if (!data) return resolvePromise({});
      try {
        resolvePromise(JSON.parse(data));
      } catch {
        resolvePromise({});
      }
    });
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  });
  res.end(body);
}

async function handleApi(req, res) {
  if (req.method === "OPTIONS") {
    return sendJson(res, 204, {});
  }
  const url = new URL(req.url, "http://127.0.0.1");
  if (
    url.pathname !== "/api/arbishield/desafio-suggestions" &&
    url.pathname !== "/" &&
    url.pathname !== "/health"
  ) {
    return sendJson(res, 404, { ok: false, error: "not_found" });
  }
  if (url.pathname === "/health") {
    return sendJson(res, 200, { ok: true });
  }

  const body = req.method === "POST" ? await parseBody(req) : {};
  const q = Object.fromEntries(url.searchParams.entries());
  const merged = { ...q, ...body };
  try {
    const result = await generateDesafioSuggestions(merged);
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 500, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function main() {
  const serve = process.argv.includes("--serve");
  if (serve) {
    const [host, portStr] = LISTEN.split(":");
    const port = Number(portStr || 3099);
    const server = createServer((req, res) => {
      handleApi(req, res).catch((err) => {
        sendJson(res, 500, { ok: false, error: String(err) });
      });
    });
    server.listen(port, host, () => {
      console.log(`desafio-suggestions listening on http://${host}:${port}`);
    });
    return;
  }

  const result = await generateDesafioSuggestions();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
