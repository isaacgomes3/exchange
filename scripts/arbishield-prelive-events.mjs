#!/usr/bin/env node
/**
 * Catálogo pré-live BetBra + criação de matches (standalone VPS).
 *
 *   node scripts/arbishield-prelive-events.mjs --serve
 *   PRELIVE_LISTEN=127.0.0.1:3098 node scripts/arbishield-prelive-events.mjs --serve
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

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
const LISTEN = process.env.PRELIVE_LISTEN || "127.0.0.1:3098";
const SUPABASE_URL = (
  process.env.ARBISHIELD_SUPABASE_URL ||
  process.env.API_EXTERNAL_URL ||
  "http://127.0.0.1:8000"
).replace(/\/$/, "");
const SERVICE_KEY =
  process.env.ARBISHIELD_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.ANON_KEY || process.env.SUPABASE_ANON_KEY;

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

function endOfDaySaoPaulo(from = Date.now()) {
  const brDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(from));
  return Date.parse(`${brDay}T23:59:59.999-03:00`);
}

function parseTeams(event) {
  const parts = event.name.split(/\s+vs\.?\s+/i);
  if (parts.length >= 2) {
    return { home: parts[0].trim(), away: parts[1].trim() };
  }
  return { home: event.name, away: "—" };
}

function extractLeague(event) {
  for (const tag of event["meta-tags"] || []) {
    if (tag.type === "COMPETITION" || tag.type === "competition") {
      return tag.name || "Competição";
    }
    if (tag["meta-tags"]) {
      for (const sub of tag["meta-tags"]) {
        if (sub.name) return sub.name;
      }
    }
    if (tag.name && tag.name !== event.name) return tag.name;
  }
  return "Exchange BetBra";
}

function runnerBackOdd(runner) {
  const backs = (runner.prices || []).filter((p) => p.side === "back");
  if (backs.length) {
    return Number(
      backs
        .reduce((a, b) =>
          a["decimal-odds"] > b["decimal-odds"] ? a : b
        )["decimal-odds"].toFixed(3)
    );
  }
  const last = runner["last-matched-odds"];
  return typeof last === "number" && last > 1 ? Number(last.toFixed(3)) : null;
}

function eventLink(sportId, eventId) {
  return `${SITE}/b/exchange/sport/soccer/event/${eventId}`;
}

function marketLink(sportId, eventId, marketId) {
  return `${eventLink(sportId, eventId)}/market/${marketId}`;
}

function toSummary(event) {
  if (event["in-running-flag"]) return null;
  if (!/vs\.?/i.test(event.name)) return null;
  const startMs = new Date(event.start).getTime();
  if (!Number.isFinite(startMs) || startMs < Date.now()) return null;
  const teams = parseTeams(event);
  return {
    eventId: String(event.id),
    eventName: event.name,
    homeTeam: teams.home,
    awayTeam: teams.away,
    league: extractLeague(event),
    startsAt: event.start,
    minutesToKickoff: Math.max(
      0,
      Math.round((startMs - Date.now()) / 60_000)
    ),
    sportId: event["sport-id"] || SOCCER_ID,
    betbraLink: eventLink(event["sport-id"] || SOCCER_ID, event.id),
  };
}

async function listPreliveEventsForDay() {
  const now = Date.now();
  const end = endOfDaySaoPaulo(now);
  const params = new URLSearchParams({
    offset: "0",
    "per-page": "80",
    after: String(Math.floor(now / 1000)),
    before: String(Math.floor(end / 1000)),
    ids: "",
    "sport-ids": String(SOCCER_ID),
    "sort-by": "start-time",
    "sort-direction": "asc",
    "en-market-names": "Moneyline,Match Odds,Winner",
  });
  const list = await spaced(() => betbra(`${API_BASE}/events?${params}`));
  const events = (list.events || [])
    .map(toSummary)
    .filter(Boolean)
    .sort(
      (a, b) =>
        new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
    );
  return {
    events,
    total: events.length,
    window: {
      from: new Date(now).toISOString(),
      to: new Date(end).toISOString(),
      timezone: "America/Sao_Paulo",
    },
  };
}

async function getPreliveEventMarkets(eventId, sportId = SOCCER_ID) {
  const detail = await spaced(() =>
    betbra(`${API_BASE}/events/${eventId}`, {
      Referer: eventLink(sportId, eventId),
    })
  );
  const event = toSummary(detail);
  if (!event) throw new Error("Evento indisponível ou já iniciado");

  const markets = (detail.markets || [])
    .map((market) => {
      const runners = (market.runners || [])
        .map((runner) => ({
          runnerId: String(runner.id),
          name: runner.name || "—",
          odd: runnerBackOdd(runner),
        }))
        .filter((r) => r.name !== "—");
      if (!runners.length) return null;
      return {
        marketId: String(market.id),
        name: market.name || "Mercado",
        marketType: market["market-type"] || market.type,
        status: market.status,
        runners,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return { event, markets };
}

async function sb(path, { token, method = "GET", body } = {}) {
  const key = token || SERVICE_KEY || ANON_KEY;
  if (!key) throw new Error("Sem chave Supabase");
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: ANON_KEY || key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg =
      (data && data.message) ||
      (data && data.error_description) ||
      text.slice(0, 200);
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function createMatchFromMarket(body, token) {
  const odd = Number(body.odd);
  if (!Number.isFinite(odd) || odd <= 1) throw new Error("Odd inválida");

  const liquidityCents = Number(body.liquidityCents ?? 200_000);
  const marketLabel = body.runnerName
    ? `${body.marketName} · ${body.runnerName}`
    : body.marketName;
  const marketUuid = randomUUID();

  const row = {
    home_team: body.homeTeam,
    away_team: body.awayTeam,
    league: body.league,
    starts_at: new Date(body.startsAt).toISOString(),
    status: "open",
    status_v2: "open",
    is_published: Boolean(body.isPublished),
    sport_type: "futebol",
    max_protection_cents: liquidityCents,
    used_protection_cents: 0,
    protection_odds: { home: odd, away: odd },
    external_id: String(body.eventId),
    score_sync_enabled: false,
    has_live_stream: false,
    metadata: {
      external_bet_link: body.betbraLink,
      external_bet_name: "BetBra",
      external_bet_logo: "https://betbra.bet.br/favicon.ico",
      market_id: body.marketId,
      runner_id: body.runnerId || null,
      source: "betbra_prelive_catalog",
    },
    markets: [
      {
        id: marketUuid,
        name: marketLabel,
        odd,
        liquidity: liquidityCents,
        display_liquidity: null,
        used_liquidity: 0,
        market_type: "LAY",
        external_id: String(body.marketId),
      },
    ],
  };

  const created = await sb("/rest/v1/matches", {
    method: "POST",
    token: token || SERVICE_KEY,
    body: row,
  });
  return Array.isArray(created) ? created[0] : created;
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
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  });
  res.end(JSON.stringify(payload));
}

function bearerFromReq(req) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || null;
}

async function handleApi(req, res) {
  if (req.method === "OPTIONS") return sendJson(res, 204, {});

  const url = new URL(req.url, "http://127.0.0.1");

  if (url.pathname === "/health") {
    return sendJson(res, 200, { ok: true, service: "prelive-events" });
  }

  if (url.pathname === "/api/arbishield/prelive-events" && req.method === "GET") {
    try {
      const eventId = url.searchParams.get("eventId");
      if (eventId) {
        const sportId = Number(url.searchParams.get("sportId") || SOCCER_ID);
        const result = await getPreliveEventMarkets(eventId, sportId);
        return sendJson(res, 200, { ok: true, ...result });
      }
      const result = await listPreliveEventsForDay();
      return sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      return sendJson(res, 500, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/matches" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const token = bearerFromReq(req);
      const match = await createMatchFromMarket(body, token);
      return sendJson(res, 200, { ok: true, match });
    } catch (err) {
      const status = err.status === 409 ? 409 : err.status || 500;
      return sendJson(res, status, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return sendJson(res, 404, { ok: false, error: "not_found" });
}

async function main() {
  if (!process.argv.includes("--serve")) {
    const result = await listPreliveEventsForDay();
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const [host, portStr] = LISTEN.split(":");
  const port = Number(portStr || 3098);
  const server = createServer((req, res) => {
    handleApi(req, res).catch((err) => {
      sendJson(res, 500, { ok: false, error: String(err) });
    });
  });
  server.listen(port, host, () => {
    console.log(`prelive-events on http://${host}:${port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
