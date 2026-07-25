#!/usr/bin/env node
/**
 * Serviço ArbiShield (VPS): catálogo BetBra, matches manuais, settle e proteções.
 *
 *   node scripts/arbishield-prelive-events.mjs --serve
 *   PRELIVE_LISTEN=127.0.0.1:3098 node scripts/arbishield-prelive-events.mjs --serve
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  PROTECTION_FLOW_LOCK,
  PROTECTION_FLOW_CONTRACT_VERSION,
  settlementCreditParts,
  settlementCreditCents,
  settlementDeductionCents,
  settlementStatusForOutcome,
  isFeeUpfrontProtection,
  isVoidSettleOutcome,
  normalizeSettleOutcome,
  creditBucketForSettlement,
  calcFeeUpfront,
  calcLay,
  calcBack,
  layToBackOdd,
} from "./lib/protection-flow-contract.mjs";
import {
  BETBRA_INPLAY_SYNC_VERSION,
  indexInplayFeed,
  matchEligibleForInplaySync,
  buildMatchInplayPatch,
  matchBetbraEventId,
  desafioStepEligibleForInplaySync,
  buildDesafioStepInplayPatch,
  desafioStepEventId,
  normalizeEventId,
  normalizeInplayItem,
  buildLiveMetadata,
} from "./lib/betbra-inplay-sync.mjs";
import {
  BETBRA_EVENTS_RADAR_VERSION,
  DEFAULT_EVENTS_RADAR_URL,
  summarizeEventsRadarFeed,
  buildMradarWidgetUrl,
  eventsRadarUrlForSite,
  mradarWidgetBaseForSite,
  resolveMradarForEventId,
  resolveSoft2BetHost,
} from "./lib/betbra-events-radar.mjs";

// Trava de produto: fluxo de proteção — não alterar sem pedido explícito.
void PROTECTION_FLOW_LOCK;
void PROTECTION_FLOW_CONTRACT_VERSION;
void settlementCreditCents;
void calcFeeUpfront;
void layToBackOdd;

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

const LISTEN = process.env.PRELIVE_LISTEN || "127.0.0.1:3098";
const IS_SANDBOX_WORKER =
  process.env.ARBISHIELD_SANDBOX === "1" ||
  process.env.ARBISHIELD_ENV === "teste" ||
  String(LISTEN).includes(":3198");
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

const UA = process.env.MEXCHANGE_BOT_USER_AGENT || "BOT/SOFTWARE;Arbitrex;1.0";
const API_BASE =
  process.env.MEXCHANGE_API_BASE_URL ||
  "https://mexchange-api.betbra.bet.br/api";
const REFERER =
  process.env.MEXCHANGE_REFERER || "https://mexchange.betbra.bet.br/";
const SITE = process.env.EXCHANGE_SITE_ORIGIN || "https://betbra.bet.br";
const SOCCER_ID = Number(process.env.FULLTBET_SOCCER_SPORT_ID || "15");
const SPACING = Number(process.env.MEXCHANGE_REQUEST_SPACING_MS || 200);
const INPLAY_FEED_URL =
  process.env.MEXCHANGE_INPLAY_FEED_URL ||
  "https://betbra.bet.br/client/api/jumper/feedSports/inplay-info";
const EVENTS_RADAR_URL =
  process.env.MEXCHANGE_EVENTS_RADAR_URL || DEFAULT_EVENTS_RADAR_URL;
const INPLAY_SYNC_MS = Number(
  process.env.BETBRA_INPLAY_SYNC_MS ||
    process.env.MEXCHANGE_POLL_INTERVAL_MS ||
    "15000"
);
const INPLAY_SYNC_ENABLED =
  process.env.BETBRA_INPLAY_SYNC_ENABLED !== "0" &&
  process.env.BETBRA_INPLAY_SYNC_ENABLED !== "false";



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
  const hours = Number(process.env.PRELIVE_WINDOW_HOURS || "24");
  if (hours > 0 && hours <= 168) {
    return from + hours * 60 * 60 * 1000;
  }
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

function priceDecimal(p) {
  if (!p || typeof p !== "object") return null;
  const n = Number(p["decimal-odds"] ?? p.odds ?? p.decimalOdds);
  return Number.isFinite(n) && n > 1 ? n : null;
}

function priceSide(p) {
  return String(p?.side || p?.Side || "")
    .trim()
    .toLowerCase();
}

/** Odd por lado + preferência (LAY primeiro — alinhado à proteção ArbiShield). */
function runnerOddsDetail(runner) {
  const prices = Array.isArray(runner?.prices)
    ? runner.prices
    : Array.isArray(runner?.Prices)
      ? runner.Prices
      : [];
  const backs = prices
    .filter((p) => priceSide(p) === "back")
    .map(priceDecimal)
    .filter((n) => n != null);
  const lays = prices
    .filter((p) => priceSide(p) === "lay")
    .map(priceDecimal)
    .filter((n) => n != null);
  const backOdd = backs.length
    ? Number(Math.max(...backs).toFixed(3))
    : null;
  const layOdd = lays.length ? Number(Math.min(...lays).toFixed(3)) : null;
  const lastRaw = runner?.["last-matched-odds"] ?? runner?.lastMatchedOdds;
  const lastMatched =
    typeof lastRaw === "number" && lastRaw > 1
      ? Number(lastRaw.toFixed(3))
      : null;
  let preferredSide = null;
  let odd = null;
  if (layOdd != null) {
    preferredSide = "LAY";
    odd = layOdd;
  } else if (backOdd != null) {
    preferredSide = "BACK";
    odd = backOdd;
  } else if (lastMatched != null) {
    preferredSide = "LAY";
    odd = lastMatched;
  }
  return { odd, layOdd, backOdd, preferredSide, lastMatched };
}

/** Melhor odd disponível: lay → back → last-matched. */
function runnerBestOdd(runner) {
  return runnerOddsDetail(runner).odd;
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
  // sport-id + referer mexchange: mesmo padrão do sync-odds (mais estável p/ prices)
  const detail = await spaced(() =>
    betbra(`${API_BASE}/events/${eventId}?sport-id=${sportId}`, {
      Referer: `${REFERER.replace(/\/$/, "")}/exchange/sport/soccer/event/${eventId}`,
      "Accept-Encoding": "identity",
    })
  );
  const event = toSummary(detail);
  if (!event) throw new Error("Evento indisponível ou já iniciado");

  let runnersTotal = 0;
  let withPrices = 0;
  let withOdd = 0;

  const resolvedSportId = detail["sport-id"] || sportId || SOCCER_ID;
  const markets = (detail.markets || [])
    .map((market) => {
      const marketId = String(market.id);
      const runners = (market.runners || [])
        .map((runner) => {
          runnersTotal += 1;
          const prices = runner.prices || runner.Prices || [];
          if (Array.isArray(prices) && prices.length) withPrices += 1;
          const detailOdds = runnerOddsDetail(runner);
          if (detailOdds.odd != null) withOdd += 1;
          return {
            runnerId: String(runner.id),
            name: runner.name || "—",
            odd: detailOdds.odd,
            layOdd: detailOdds.layOdd,
            backOdd: detailOdds.backOdd,
            preferredSide: detailOdds.preferredSide,
            lastMatched: detailOdds.lastMatched,
          };
        })
        .filter((r) => r.name !== "—");
      if (!runners.length) return null;
      return {
        marketId,
        name: market.name || "Mercado",
        marketType: market["market-type"] || market.type,
        status: market.status,
        betbraLink: marketLink(resolvedSportId, eventId, marketId),
        runners,
        hasOdds: runners.some((r) => r.odd != null),
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      // mercados com odd primeiro; depois nome
      if (a.hasOdds !== b.hasOdds) return a.hasOdds ? -1 : 1;
      return a.name.localeCompare(b.name, "pt-BR");
    });

  return {
    event: {
      ...event,
      betbraLink: eventLink(resolvedSportId, eventId),
    },
    markets,
    oddsMeta: {
      runnersTotal,
      withPrices,
      withOdd,
      coveragePct: runnersTotal
        ? Math.round((withOdd / runnersTotal) * 100)
        : 0,
    },
  };
}

async function createMatchFromMarket(body, token) {
  // Guarda: liquidação nunca deve cair neste fluxo (evita "Odd inválida" no Encerrar)
  if (
    body?.mode === "settle" ||
    body?.action === "settle" ||
    (body?.matchId && body?.outcome && !body?.odd && !body?.marketId)
  ) {
    throw Object.assign(
      new Error(
        "Pedido de liquidação recebido no endpoint de criar jogo. Atualize o serviço prelive (hotfix Encerrar)."
      ),
      { status: 400 }
    );
  }
  const odd = Number(body.odd);
  if (!Number.isFinite(odd) || odd <= 1) throw new Error("Odd inválida");

  const payload = decodeJwtPayload(token);
  const adminId = payload?.sub ? String(payload.sub) : null;
  if (!adminId) {
    const err = new Error("Login admin necessário para lançar evento");
    err.status = 401;
    throw err;
  }

  // Liquidez: cents direto, ou R$ via liquidity_brl (UI BetBra / manual)
  let liquidityCents = Number(body.liquidityCents);
  if (!Number.isFinite(liquidityCents) || liquidityCents <= 0) {
    const brl = Number(body.liquidity_brl ?? body.liquidityBrl);
    if (Number.isFinite(brl) && brl > 0) {
      liquidityCents = Math.round(brl * 100);
    } else {
      liquidityCents = 200_000; // fallback R$ 2.000
    }
  }
  if (!(liquidityCents >= 100)) {
    const err = new Error("Informe a liquidez (mín. R$ 1,00) antes de lançar");
    err.status = 400;
    throw err;
  }
  const marketType =
    String(body.marketType || body.market_type || "LAY").toUpperCase() ===
    "BACK"
      ? "BACK"
      : "LAY";
  const sideLabel = marketType === "BACK" ? "Back" : "Lay";
  const marketLabel = body.runnerName
    ? `${sideLabel} · ${body.marketName} · ${body.runnerName}`
    : `${sideLabel} · ${body.marketName}`;
  const marketUuid = randomUUID();
  // Escrita com service role (triggers/RLS); admin_id vem do JWT em created_by/updated_by
  const dbToken = SERVICE_KEY || token;
  const eventExternalId = String(body.eventId);
  const betbraMarketId = String(body.marketId);
  const sportId = body.sportId || body.sport_id || SOCCER_ID;
  // Link do mercado BetBra: body → construído a partir do event/market
  const resolvedMarketLink =
    String(
      body.betbraLink ||
        body.external_bet_link ||
        body.externalBetLink ||
        ""
    ).trim() ||
    (body.eventId && body.marketId
      ? marketLink(sportId, body.eventId, body.marketId)
      : "");
  // Mesmo mercado BetBra (ex. placar exato) tem vários runners — chave por mercado+seleção+lado
  const betbraSelectionKey = body.runnerId
    ? `${betbraMarketId}:${body.runnerId}:${marketType}`
    : `${betbraMarketId}:${marketType}`;

  const newMarket = {
    id: marketUuid,
    name: marketLabel,
    odd,
    liquidity: liquidityCents,
    display_liquidity: null,
    used_liquidity: 0,
    market_type: marketType,
    external_id: betbraSelectionKey,
    betbra_market_id: betbraMarketId,
    betbra_runner_id: body.runnerId ? String(body.runnerId) : null,
    external_bet_link: resolvedMarketLink || null,
    betbra_link: resolvedMarketLink || null,
  };

  // Nunca misturar com evento MANUAL: só reutiliza match BetBra puro.
  const existingRows = await sb(
    `/rest/v1/matches?external_id=eq.${encodeURIComponent(eventExternalId)}&deleted_at=is.null&select=id,home_team,away_team,markets,max_protection_cents,used_protection_cents,is_published,metadata&limit=10`,
    { token: dbToken }
  );
  const rows = Array.isArray(existingRows) ? existingRows : [];
  const sourceOf = (m) => String(m?.metadata?.source || "").toLowerCase();
  const isManualSrc = (src) => src === "admin_manual" || src === "manual";
  const manualHit = rows.find((r) => isManualSrc(sourceOf(r)));
  if (manualHit) {
    const err = new Error(
      "Este ID da BetBra já está em um evento MANUAL. Não misture — edite o manual na aba Encerrar / Eventos ArbiShield ou escolha outro jogo na BetBra."
    );
    err.status = 409;
    err.code = "MANUAL_EXTERNAL_ID_CONFLICT";
    throw err;
  }
  const existing =
    rows.find((r) => sourceOf(r) === "betbra_prelive_catalog") || null;
  const foreign = rows.find(
    (r) =>
      sourceOf(r) !== "betbra_prelive_catalog" && !isManualSrc(sourceOf(r))
  );
  if (!existing && foreign) {
    const err = new Error(
      "Já existe um jogo com este ID externo e origem diferente de BetBra. Não misture."
    );
    err.status = 409;
    err.code = "FOREIGN_EXTERNAL_ID_CONFLICT";
    throw err;
  }

  if (existing?.id) {
    const markets = Array.isArray(existing.markets) ? existing.markets : [];
    const dup = markets.find((m) => {
      const ext = String(m.external_id || "");
      const runner = String(m.betbra_runner_id || m.runner_id || "");
      const side = String(m.market_type || m.marketType || "LAY").toUpperCase();
      // chave nova mercado:runner:SIDE
      if (ext === betbraSelectionKey) return true;
      // chave intermediária mercado:runner (sem lado) — só colide no mesmo lado
      if (
        body.runnerId &&
        ext === `${betbraMarketId}:${body.runnerId}` &&
        side === marketType
      ) {
        return true;
      }
      // legado: só marketId + mesmo runner + mesmo lado
      if (
        body.runnerId &&
        (ext === betbraMarketId ||
          String(m.betbra_market_id || "") === betbraMarketId) &&
        runner === String(body.runnerId) &&
        side === marketType
      ) {
        return true;
      }
      // sem runnerId: só bloqueia nome idêntico no mesmo jogo
      if (
        !body.runnerId &&
        String(m.name || "").toLowerCase() === marketLabel.toLowerCase()
      ) {
        return true;
      }
      return false;
    });
    if (dup) {
      const err = new Error(
        `Esta seleção já está cadastrada em ${existing.home_team} vs ${existing.away_team}. Escolha outra entrada (ex.: outro placar).`
      );
      err.status = 409;
      err.code = "MARKET_EXISTS";
      throw err;
    }

    const nextMarkets = [...markets, newMarket];
    const nextMax = nextMarkets.reduce(
      (sum, m) => sum + Number(m.liquidity || 0),
      0
    );

    const prevMeta =
      existing.metadata && typeof existing.metadata === "object"
        ? existing.metadata
        : {};
    const createdByName =
      prevMeta.created_by_name ||
      (await resolveAdminDisplayName(adminId));
    const patchBody = {
      markets: nextMarkets,
      max_protection_cents: nextMax,
      score_sync_enabled: true,
      updated_by: adminId,
      metadata: {
        ...prevMeta,
        external_bet_link:
          resolvedMarketLink || prevMeta.external_bet_link || null,
        external_bet_name: "BetBra",
        external_bet_logo: "https://betbra.bet.br/favicon.ico",
        market_id: body.marketId,
        runner_id: body.runnerId || null,
        source: "betbra_prelive_catalog",
        score_sync_enabled: true,
        score_sync_source: "betbra_inplay",
        created_by: prevMeta.created_by || adminId,
        created_by_name: createdByName,
      },
      updated_at: new Date().toISOString(),
    };
    // Lançar com "publicar" promove rascunho existente para a fila do cliente
    if (body.isPublished) patchBody.is_published = true;

    const updated = await sb(`/rest/v1/matches?id=eq.${existing.id}`, {
      method: "PATCH",
      token: dbToken,
      body: patchBody,
    });
    const match = Array.isArray(updated) ? updated[0] : updated;
    return {
      action: "market_added",
      match: match || { ...existing, markets: nextMarkets },
      marketsCount: nextMarkets.length,
    };
  }

  const createdByName = await resolveAdminDisplayName(adminId);
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
    external_id: eventExternalId,
    score_sync_enabled: true,
    has_live_stream: false,
    created_by: adminId,
    updated_by: adminId,
    metadata: {
      external_bet_link: resolvedMarketLink || null,
      external_bet_name: "BetBra",
      external_bet_logo: "https://betbra.bet.br/favicon.ico",
      market_id: body.marketId,
      runner_id: body.runnerId || null,
      source: "betbra_prelive_catalog",
      score_sync_enabled: true,
      score_sync_source: "betbra_inplay",
      created_by: adminId,
      created_by_name: createdByName,
    },
    markets: [newMarket],
  };

  try {
    const created = await sb("/rest/v1/matches", {
      method: "POST",
      token: dbToken,
      body: row,
    });
    const match = Array.isArray(created) ? created[0] : created;
    return { action: "created", match };
  } catch (err) {
    if (
      !body.__retried &&
      (String(err.message || "").includes("matches_external_id_key") ||
        String(err.message || "").toLowerCase().includes("duplicate key"))
    ) {
      return createMatchFromMarket({ ...body, __retried: true }, token);
    }
    // Fallback: se o trigger ainda reclamar de admin_id, tenta log explícito não bloqueia
    if (
      String(err.message || "").includes("match_change_logs") &&
      String(err.message || "").includes("admin_id")
    ) {
      const err2 = new Error(
        "Falha ao auditar lançamento (admin_id). Confirme o login admin e tente de novo."
      );
      err2.status = 500;
      throw err2;
    }
    throw err;
  }
}


/** Criação manual (drawer "Adicionar jogo" / SPA Lançar Novo Evento) */
async function createManualMatch(body, token) {
  const payload = decodeJwtPayload(token);
  const adminId = payload?.sub ? String(payload.sub) : null;
  if (!adminId) {
    const err = new Error("Login admin necessário para lançar evento");
    err.status = 401;
    throw err;
  }

  const homeTeam = String(body.home_team || body.homeTeam || "").trim();
  const awayTeam = String(body.away_team || body.awayTeam || "").trim();
  if (!homeTeam || !awayTeam) {
    const err = new Error("Informe time da casa e time de fora");
    err.status = 400;
    throw err;
  }

  const startsRaw = body.starts_at || body.startsAt;
  const startsAt = startsRaw ? new Date(startsRaw) : null;
  if (!startsAt || Number.isNaN(startsAt.getTime())) {
    const err = new Error("Data e horário inválidos");
    err.status = 400;
    throw err;
  }

  const marketsIn = Array.isArray(body.markets) ? body.markets : [];
  if (!marketsIn.length) {
    const err = new Error("Adicione ao menos um mercado de proteção");
    err.status = 400;
    throw err;
  }

  const markets = marketsIn.map((m, idx) => {
    const odd = Number(m.odd);
    if (!Number.isFinite(odd) || odd <= 1) {
      throw Object.assign(new Error(`Odd inválida no mercado #${idx + 1}`), {
        status: 400,
      });
    }
    let liquidity = Number(m.liquidity);
    if (!Number.isFinite(liquidity) || liquidity <= 0) {
      // aceita valor em reais (ex.: 25000) se liquidity_brl vier
      const brl = Number(m.liquidity_brl ?? m.liquidityBrl);
      liquidity = Number.isFinite(brl) && brl > 0 ? Math.round(brl * 100) : 200_000;
    } else if (liquidity < 1000) {
      // valor pequeno provavelmente veio em reais
      liquidity = Math.round(liquidity * 100);
    }
    let display = m.display_liquidity ?? m.displayLiquidity ?? null;
    if (display != null && display !== "") {
      display = Number(display);
      if (Number.isFinite(display) && display > 0 && display < 1000) {
        display = Math.round(display * 100);
      }
    } else {
      display = null;
    }
    const side = String(m.market_type || m.marketType || "LAY").toUpperCase();
    return {
      id: m.id || randomUUID(),
      name: String(m.name || `Mercado ${idx + 1}`).trim(),
      odd,
      liquidity,
      display_liquidity: display,
      used_liquidity: Number(m.used_liquidity || 0) || 0,
      market_type: side === "BACK" ? "BACK" : "LAY",
      external_id: m.external_id != null ? String(m.external_id) : null,
    };
  });

  const maxProtection = markets.reduce((sum, m) => sum + Number(m.liquidity || 0), 0);
  const firstOdd = markets[0].odd;
  const status = String(body.status || body.status_v2 || "open").toLowerCase();
  const sport = String(body.sport_type || body.sportType || "futebol").toLowerCase();
  const isPublished = Boolean(
    body.is_published ?? body.isPublished ?? false
  );
  const allowedRelease = new Set([0, 15, 30, 60, 120]);
  // 0 = liberado assim que o admin publicar (não espera o horário do jogo)
  let releaseMinutesBefore = Number(
    body.release_minutes_before ?? body.releaseMinutesBefore ?? 0
  );
  if (!Number.isFinite(releaseMinutesBefore) || !allowedRelease.has(releaseMinutesBefore)) {
    releaseMinutesBefore = 0;
  }
  const dbToken = SERVICE_KEY || token;
  const createdByName = await resolveAdminDisplayName(adminId);

  const row = {
    home_team: homeTeam,
    away_team: awayTeam,
    home_logo: body.home_logo || body.homeLogo || null,
    away_logo: body.away_logo || body.awayLogo || null,
    league: body.league || null,
    starts_at: startsAt.toISOString(),
    status,
    status_v2: status,
    is_published: isPublished,
    sport_type: sport,
    max_protection_cents: maxProtection,
    used_protection_cents: 0,
    protection_odds: { home: firstOdd, away: firstOdd },
    external_id: body.external_id != null && body.external_id !== ""
      ? String(body.external_id)
      : null,
    score_sync_enabled: Boolean(body.score_sync_enabled ?? body.scoreSyncEnabled),
    has_live_stream: Boolean(body.has_live_stream ?? body.hasLiveStream),
    created_by: adminId,
    updated_by: adminId,
    metadata: {
      external_bet_link: body.external_bet_link || body.externalBetLink || null,
      external_bet_name: body.external_bet_name || body.externalBetName || null,
      external_bet_logo: body.external_bet_logo || body.externalBetLogo || null,
      betting_house_id: body.betting_house_id || body.bettingHouseId || null,
      source: "admin_manual",
      release_minutes_before: releaseMinutesBefore,
      created_by: adminId,
      created_by_name: createdByName,
    },
    markets,
  };

  // limpa external_id nulo para não colidir com unique vazio
  if (!row.external_id) delete row.external_id;

  try {
    const created = await sb("/rest/v1/matches", {
      method: "POST",
      token: dbToken,
      body: row,
    });
    const match = Array.isArray(created) ? created[0] : created;
    return { action: "created", match, marketsCount: markets.length };
  } catch (err) {
    if (
      String(err.message || "").includes("matches_external_id_key") ||
      String(err.message || "").toLowerCase().includes("duplicate key")
    ) {
      const err2 = new Error(
        "Já existe um jogo com este ID externo (BetBra ou outro). Eventos manuais não devem reutilizar ID da BetBra — deixe o ID em branco ou use um ID próprio."
      );
      err2.status = 409;
      err2.code = "EXTERNAL_ID_CONFLICT";
      throw err2;
    }
    throw err;
  }
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

let lastDesafioListLiveSyncMs = 0;

/** Cache em memória: placar/FT para o cliente (VPS sem coluna metadata). */
const desafioStepLiveCache = new Map();

function rememberDesafioStepLive(stepId, live) {
  if (!stepId || !live) return;
  desafioStepLiveCache.set(String(stepId), {
    ...live,
    cached_at: new Date().toISOString(),
  });
}

function enrichDesafiosWithLiveCache(desafios) {
  const list = Array.isArray(desafios) ? desafios : [];
  return list.map((d) => {
    const steps = Array.isArray(d?.desafio_steps) ? d.desafio_steps : [];
    return {
      ...d,
      desafio_steps: steps.map((s) => {
        if (!s?.id) return s;
        const cached = desafioStepLiveCache.get(String(s.id));
        if (!cached) return s;
        const prevMeta =
          s.metadata && typeof s.metadata === "object" ? { ...s.metadata } : {};
        const home =
          s.final_score_home != null ? s.final_score_home : cached.home_score;
        const away =
          s.final_score_away != null ? s.final_score_away : cached.away_score;
        return {
          ...s,
          final_score_home: home,
          final_score_away: away,
          metadata: {
            ...prevMeta,
            live: cached,
            score_sync_enabled: true,
          },
        };
      }),
    };
  });
}

async function enrichDesafiosWithCreatorNames(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const ids = {};
  for (const d of list) {
    const meta =
      d && d.metadata && typeof d.metadata === "object" ? d.metadata : {};
    const id = d?.created_by || meta.created_by || null;
    if (id) ids[String(id)] = true;
  }
  const idList = Object.keys(ids);
  const nameMap = {};
  if (idList.length && SERVICE_KEY) {
    try {
      const profs = await sb(
        `/rest/v1/profiles?select=id,full_name,email&id=in.(${idList
          .map(encodeURIComponent)
          .join(",")})`,
        { token: SERVICE_KEY }
      );
      for (const p of Array.isArray(profs) ? profs : []) {
        nameMap[String(p.id)] =
          (p.full_name && String(p.full_name).trim()) ||
          (p.email && String(p.email).trim()) ||
          String(p.id).slice(0, 8);
      }
    } catch {
      /* nomes opcionais */
    }
  }
  for (const d of list) {
    const meta =
      d && d.metadata && typeof d.metadata === "object" ? d.metadata : {};
    const sid = d?.created_by || meta.created_by || null;
    d._createdById = sid || null;
    d._createdByName =
      (meta.created_by_name && String(meta.created_by_name).trim()) ||
      (sid && nameMap[String(sid)]) ||
      null;
  }
  return list;
}

async function listDesafiosRaw() {
  if (!SERVICE_KEY) {
    throw new Error("SERVICE_ROLE_KEY ausente no .env da VPS");
  }
  const rows = await sb(
    "/rest/v1/desafios?select=*,desafio_steps(*)&order=updated_at.desc"
  );
  const withLive = enrichDesafiosWithLiveCache(Array.isArray(rows) ? rows : []);
  return enrichDesafiosWithCreatorNames(withLive);
}

async function listDesafios() {
  // Ao abrir o Desafio, tenta sync de placar/minuto.
  const now = Date.now();
  if (now - lastDesafioListLiveSyncMs > 12_000) {
    lastDesafioListLiveSyncMs = now;
    try {
      await Promise.race([
        syncBetbraInplayScores({ force: true }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("sync timeout")), 4500)
        ),
      ]);
    } catch (err) {
      console.warn(
        "[desafios] sync inplay na listagem falhou",
        err instanceof Error ? err.message : err
      );
    }
  }
  return listDesafiosRaw();
}

/** Carrega etapas sem depender da coluna metadata (ausente em algumas VPS). */
async function loadDesafioStepsForInplaySync() {
  const queries = [
    "/rest/v1/desafio_steps?select=id,starts_at,status,result,settled_at,final_score_home,final_score_away,external_bet_link&settled_at=is.null&order=starts_at.desc&limit=150",
    "/rest/v1/desafio_steps?select=id,starts_at,status,result,final_score_home,final_score_away,external_bet_link&status=in.(pending,live)&order=starts_at.desc&limit=150",
    "/rest/v1/desafio_steps?select=id,starts_at,status,result,final_score_home,final_score_away,external_bet_link&order=starts_at.desc&limit=150",
  ];
  for (const q of queries) {
    try {
      const rows = await sb(q, { token: SERVICE_KEY });
      if (Array.isArray(rows) && rows.length) return rows;
      if (Array.isArray(rows)) return rows;
    } catch {
      /* tenta próxima */
    }
  }
  try {
    const desafios = await listDesafiosRaw();
    const out = [];
    for (const d of desafios) {
      for (const s of d.desafio_steps || []) {
        if (s && !s.deleted_at) out.push(s);
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function nextDesafioNumber() {
  const rows = await sb(
    "/rest/v1/desafios?select=number&order=number.desc&limit=1"
  );
  const cur =
    Array.isArray(rows) && rows[0]?.number != null ? Number(rows[0].number) : 0;
  return (Number.isFinite(cur) ? cur : 0) + 1;
}


/** Matemática ciclo Desafio/Sinais (espelho desafio-ciclo-math) */
function desafioClampFee(pct) {
  const x = Number(pct);
  if (!Number.isFinite(x) || x < 0) return 0;
  return Math.min(100, x) / 100;
}
function desafioEffectiveL(odd, commissionPct) {
  const o = Number(odd);
  if (!(o > 1)) return NaN;
  const fee = desafioClampFee(commissionPct);
  return 1 + (o - 1) * (1 - fee);
}
function desafioOddFromL(L, commissionPct) {
  const fee = desafioClampFee(commissionPct);
  if (!(L > 1) || fee >= 1) return NaN;
  return 1 + (L - 1) / (1 - fee);
}
function calcZebraOddFromFavorite(
  casaOdd,
  targetProfitPct = 5,
  casaCommissionPct = 0,
  arbiCommissionPct = 0
) {
  const Lc = desafioEffectiveL(casaOdd, casaCommissionPct);
  const margin = 1 + Math.max(0, Number(targetProfitPct) || 5) / 100;
  if (!(Lc > margin)) {
    const err = new Error(
      `Odd do favorito (${casaOdd}) baixa demais para lucro de ${targetProfitPct}%.`
    );
    err.status = 400;
    throw err;
  }
  const Lz = (margin * Lc) / (Lc - margin);
  const zebraOdd = desafioOddFromL(Lz, arbiCommissionPct);
  if (!(zebraOdd > 1)) throw new Error("Não foi possível calcular a odd da zebra");
  return Math.round(zebraOdd * 100) / 100;
}
function calcCasaStakeFromZebra(
  zebraStakeCents,
  arbiOdd,
  casaOdd,
  arbiCommissionPct = 0,
  casaCommissionPct = 0
) {
  const Sz = Math.max(0, Math.round(Number(zebraStakeCents) || 0));
  const Lz = desafioEffectiveL(arbiOdd, arbiCommissionPct);
  const Lc = desafioEffectiveL(casaOdd, casaCommissionPct);
  if (!(Sz > 0) || !(Lz > 1) || !(Lc > 1)) return 0;
  return Math.round((Sz * Lz) / Lc);
}
function calcZebraPayoutCents(zebraStakeCents, arbiOdd, arbiCommissionPct = 0) {
  const Sz = Math.max(0, Math.round(Number(zebraStakeCents) || 0));
  const Lz = desafioEffectiveL(arbiOdd, arbiCommissionPct);
  if (!(Sz > 0) || !(Lz > 1)) return 0;
  return Math.round(Sz * Lz);
}
function calcProjectedReturnCents(zebraStakeCents, casaStakeCents, targetProfitPct = 5) {
  const total =
    Math.max(0, Math.round(Number(zebraStakeCents) || 0)) +
    Math.max(0, Math.round(Number(casaStakeCents) || 0));
  const margin = 1 + Math.max(0, Number(targetProfitPct) || 5) / 100;
  return Math.round(total * margin);
}

function buildDesafioRow(body) {
  const isActive = Boolean(body.is_active);
  return {
    number: body.number != null ? Number(body.number) : undefined,
    title: body.title || "Desafio",
    subtitle: body.subtitle ?? null,
    total_steps: Number(body.total_steps) || 5,
    initial_balance_cents: Number(body.initial_balance_cents) || 20000,
    is_active: isActive,
    status: body.status || (isActive ? "active" : "draft"),
    target_profit_pct: Number(body.target_profit_pct) || 5,
    auto_link_matches: body.auto_link_matches !== false,
    published_at: isActive ? new Date().toISOString() : null,
  };
}

function buildStepRow(desafioId, stepIn, isActive) {
  return {
    desafio_id: desafioId,
    step_index: Number(stepIn.step_index) || 1,
    match_label: stepIn.match_label || null,
    league_name: stepIn.league_name ?? null,
    home_team: stepIn.home_team || null,
    away_team: stepIn.away_team || null,
    home_logo_url: stepIn.home_logo_url || stepIn.home_logo || null,
    away_logo_url: stepIn.away_logo_url || stepIn.away_logo || null,
    market_name: stepIn.market_name || stepIn.market_name_casa || null,
    market_name_casa: stepIn.market_name_casa || stepIn.market_name || null,
    market_name_arbishield: stepIn.market_name_arbishield || null,
    home_odd: stepIn.home_odd != null ? Number(stepIn.home_odd) : null,
    away_odd: stepIn.away_odd != null ? Number(stepIn.away_odd) : null,
    arbi_team_name: stepIn.arbi_team_name ?? null,
    arbi_team_logo_url:
      stepIn.arbi_team_logo_url ||
      (stepIn.arbi_team_name &&
      stepIn.home_team &&
      stepIn.arbi_team_name === stepIn.home_team
        ? stepIn.home_logo_url || stepIn.home_logo
        : null) ||
      (stepIn.arbi_team_name &&
      stepIn.away_team &&
      stepIn.arbi_team_name === stepIn.away_team
        ? stepIn.away_logo_url || stepIn.away_logo
        : null) ||
      null,
    arbi_odd: (() => {
      if (stepIn.arbi_odd != null && Number(stepIn.arbi_odd) > 1) {
        return Number(stepIn.arbi_odd);
      }
      const casa = stepIn.casa_odd != null ? Number(stepIn.casa_odd) : null;
      if (casa > 1) {
        try {
          return calcZebraOddFromFavorite(
            casa,
            Number(stepIn.target_profit_pct) || 5,
            stepIn.casa_commission_pct != null ? Number(stepIn.casa_commission_pct) : 0,
            stepIn.arbi_commission_pct != null ? Number(stepIn.arbi_commission_pct) : 0
          );
        } catch {
          return null;
        }
      }
      return null;
    })(),
    casa_team_name: stepIn.casa_team_name ?? null,
    casa_team_logo_url: stepIn.casa_team_logo_url ?? null,
    casa_odd: stepIn.casa_odd != null ? Number(stepIn.casa_odd) : null,
    casa_stake_cents:
      stepIn.casa_stake_cents != null ? Number(stepIn.casa_stake_cents) : null,
    arbi_commission_pct:
      stepIn.arbi_commission_pct != null
        ? Number(stepIn.arbi_commission_pct)
        : null,
    casa_commission_pct:
      stepIn.casa_commission_pct != null
        ? Number(stepIn.casa_commission_pct)
        : 4.5,
    liquidity_cents:
      stepIn.liquidity_cents != null ? Number(stepIn.liquidity_cents) : 200000,
    display_liquidity_cents:
      stepIn.display_liquidity_cents != null
        ? Number(stepIn.display_liquidity_cents)
        : stepIn.liquidity_cents != null
          ? Number(stepIn.liquidity_cents)
          : 200000,
    external_bet_link: stepIn.external_bet_link || null,
    starts_at: stepIn.starts_at || null,
    release_minutes_before:
      stepIn.release_minutes_before != null
        ? Number(stepIn.release_minutes_before)
        : 60,
    status: stepIn.status || "pending",
    is_published:
      stepIn.is_published != null ? Boolean(stepIn.is_published) : isActive,
  };
}

async function insertDesafioRow(auth, desafioRow) {
  // Tenta gravar created_by + metadata; schema antigo pode não ter as colunas.
  const attempts = [
    desafioRow,
    (() => {
      const { metadata: _m, ...rest } = desafioRow;
      return rest;
    })(),
    (() => {
      const { created_by: _c, metadata: _m, ...rest } = desafioRow;
      return rest;
    })(),
  ];
  let lastErr;
  for (const body of attempts) {
    try {
      const created = await sb("/rest/v1/desafios", {
        method: "POST",
        token: auth,
        body,
      });
      return Array.isArray(created) ? created[0] : created;
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || err || "").toLowerCase();
      if (
        msg.includes("created_by") ||
        msg.includes("metadata") ||
        msg.includes("column") ||
        msg.includes("schema cache")
      ) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error("Falha ao criar desafio");
}

async function createDesafio(body, token) {
  if (!SERVICE_KEY) throw new Error("SERVICE_ROLE_KEY ausente no .env da VPS");
  const auth = token || SERVICE_KEY;
  // Publicar desafio existente (área do cliente)
  if (body?.id && (body.publish_only || (body.is_active && !body.steps && !body.step))) {
    const patched = await sb(`/rest/v1/desafios?id=eq.${encodeURIComponent(body.id)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: {
        is_active: true,
        status: "active",
        published_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
    const row = Array.isArray(patched) ? patched[0] : patched;
    return row || { id: body.id, is_active: true };
  }
  const stepIn = body.step || (body.steps && body.steps[0]) || {};
  const desafioRow = buildDesafioRow(body);
  if (desafioRow.number == null) {
    desafioRow.number = await nextDesafioNumber();
  }

  const payload = decodeJwtPayload(token);
  const adminId = payload?.sub ? String(payload.sub) : null;
  if (adminId) {
    const createdByName = await resolveAdminDisplayName(adminId);
    desafioRow.created_by = adminId;
    desafioRow.metadata = creatorMetaPatch(
      desafioRow.metadata,
      adminId,
      createdByName
    );
  }

  const desafio = await insertDesafioRow(auth, desafioRow);
  if (!desafio?.id) throw new Error("Falha ao criar desafio");

  const stepsOut = [];
  for (const step of body.steps || [stepIn]) {
    if (!step || (!step.match_label && !step.home_team && !step.market_name_casa)) {
      continue;
    }
    const stepRow = buildStepRow(desafio.id, step, desafioRow.is_active);
    const inserted = await sb("/rest/v1/desafio_steps", {
      method: "POST",
      token: auth,
      body: stepRow,
    });
    stepsOut.push(Array.isArray(inserted) ? inserted[0] : inserted);
  }
  return { ...desafio, desafio_steps: stepsOut.filter(Boolean) };
}

function nCents(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

async function requireAdminToken(token) {
  const payload = decodeJwtPayload(token);
  const userId = payload?.sub ? String(payload.sub) : null;
  if (!userId) {
    const err = new Error("Login admin necessário");
    err.status = 401;
    throw err;
  }
  if (!SERVICE_KEY) throw new Error("SERVICE_ROLE_KEY ausente no .env da VPS");
  const profile = await sb(
    `/rest/v1/profiles?select=is_super_admin&id=eq.${encodeURIComponent(userId)}&limit=1`,
    { token: SERVICE_KEY }
  ).catch(() => []);
  const p = Array.isArray(profile) ? profile[0] : null;
  if (p?.is_super_admin) return userId;
  const roles = await sb(
    `/rest/v1/user_roles?select=role&user_id=eq.${encodeURIComponent(userId)}`,
    { token: SERVICE_KEY }
  ).catch(() => []);
  const ok = (Array.isArray(roles) ? roles : []).some(
    (r) => r.role === "admin" || r.role === "master_admin"
  );
  if (!ok) {
    const err = new Error("Acesso negado");
    err.status = 403;
    throw err;
  }
  return userId;
}

/** Nome amigável do admin (full_name → email → id curto). */
async function resolveAdminDisplayName(adminId) {
  const id = String(adminId || "").trim();
  if (!id) return null;
  let name = id.slice(0, 8);
  try {
    const profRows = await sb(
      `/rest/v1/profiles?select=full_name,email&id=eq.${encodeURIComponent(id)}&limit=1`,
      { token: SERVICE_KEY }
    );
    const prof = Array.isArray(profRows) ? profRows[0] : null;
    if (prof) {
      name =
        (prof.full_name && String(prof.full_name).trim()) ||
        (prof.email && String(prof.email).trim()) ||
        name;
    }
  } catch {
    /* keep short id */
  }
  return name;
}

function creatorMetaPatch(prevMeta, adminId, adminName) {
  const meta =
    prevMeta && typeof prevMeta === "object" ? { ...prevMeta } : {};
  meta.created_by = adminId;
  meta.created_by_name = adminName;
  return meta;
}

function isTerminalProtectionStatus(st) {
  const s = String(st || "").toLowerCase();
  return (
    !s ||
    s === "cancelled" ||
    s === "settled" ||
    s === "closed" ||
    s === "void" ||
    s === "won_platform" ||
    s === "won_exchange" ||
    s === "lost_platform" ||
    s === "lost_exchange" ||
    s === "refunded" ||
    s === "refund_requested" ||
    s === "pending_refund" ||
    s === "balance_released" ||
    s === "pix_approved" ||
    s === "pix_sent" ||
    s === "concluded" ||
    s === "paid" ||
    s === "approved"
  );
}

async function fetchOpenProtectionsForMatch(matchId) {
  const openFilter = "active,pending,review_odd";
  async function load(table) {
    try {
      const rows = await sb(
        `/rest/v1/${table}?match_id=eq.${encodeURIComponent(matchId)}&status=in.(${openFilter})&select=*&limit=2000`,
        { token: SERVICE_KEY }
      );
      return Array.isArray(rows) ? rows : [];
    } catch {
      // fallback sem filtro (alguns schemas/status divergem)
      try {
        const rows = await sb(
          `/rest/v1/${table}?match_id=eq.${encodeURIComponent(matchId)}&select=id,user_id,status,amount_cents,responsibility_cents,metadata&limit=2000`,
          { token: SERVICE_KEY }
        );
        return (Array.isArray(rows) ? rows : []).filter(
          (r) => !isTerminalProtectionStatus(r.status)
        );
      } catch {
        return [];
      }
    }
  }
  const [lays, backs] = await Promise.all([
    load("protections"),
    load("back_protections"),
  ]);
  return [
    ...lays.map((r) => ({ ...r, _table: "protections" })),
    ...backs.map((r) => ({ ...r, _table: "back_protections" })),
  ].filter((r) => !isTerminalProtectionStatus(r.status));
}

async function countOpenProtections(matchId) {
  const open = await fetchOpenProtectionsForMatch(matchId);
  const lay = open.filter((r) => r._table === "protections").length;
  const back = open.filter((r) => r._table === "back_protections").length;
  return { lay, back, total: open.length, rows: open };
}

// Regras de settle/fee: scripts/lib/protection-flow-contract.mjs (TRAVADO)

async function protectionAlreadyCredited(protectionId) {
  if (!protectionId) return false;
  try {
    const rows = await sb(
      `/rest/v1/wallet_transactions?ref=eq.${encodeURIComponent(protectionId)}&type=in.(protection_settlement,protection_release,protection_refund)&select=id&limit=1`,
      { token: SERVICE_KEY }
    );
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

async function creditWalletForSettlement(row, outcome, now) {
  const amount = nCents(row.responsibility_cents || row.amount_cents);
  const parts = settlementCreditParts(row, outcome);
  const credit = parts.total;
  const outcomeNorm = normalizeSettleOutcome(outcome);
  const wonArbi = outcomeNorm === "arbishield";
  const isVoid = outcomeNorm === "void" || isVoidSettleOutcome(outcome);
  const feeUpfront = isFeeUpfrontProtection(row);
  const balanceType = String(
    (row.metadata &&
      (row.metadata.balance_type ||
        row.metadata.balance_type_requested ||
        row.metadata.balanceType)) ||
      "REAL"
  ).toUpperCase();
  if (!row.user_id || (amount <= 0 && credit <= 0)) {
    return { refunded: 0, credited: 0, skipped: true };
  }
  if (await protectionAlreadyCredited(row.id)) {
    return { refunded: 0, credited: 0, alreadyCredited: true };
  }

  // fee_upfront + Exchange: nada a creditar (taxa já cobrada na criação)
  // Empate Anula / void: devolve a dedução (segue fluxo de crédito abaixo)
  if (feeUpfront && !wonArbi && !isVoid) {
    try {
      await sb("/rest/v1/wallet_transactions", {
        method: "POST",
        token: SERVICE_KEY,
        body: {
          user_id: row.user_id,
          type: "protection_settlement",
          amount_cents: 0,
          ref: row.id,
          metadata: {
            protection_id: row.id,
            match_id: row.match_id || null,
            outcome: "exchange",
            stake_cents: amount,
            fee_cents: settlementDeductionCents(row),
            billing_model: "fee_upfront_v1",
            note: "taxa cobrada na criação — sem crédito no settle",
          },
        },
      });
    } catch (e) {
      console.warn("[settle] fee_upfront exchange tx:", e?.message || e);
    }
    return { refunded: 0, credited: 0, feeUpfrontExchange: true };
  }

  const prof = await sb(
    `/rest/v1/profiles?select=balance_cents,reusable_balance_cents,locked_balance_cents,demo_balance_cents,investor_balance_cents,deduction_balance_cents&id=eq.${encodeURIComponent(row.user_id)}&limit=1`,
    { token: SERVICE_KEY }
  ).catch(() => null);
  // Coluna nova pode faltar até o hotfix SQL — retry sem ela
  let p = Array.isArray(prof) ? prof[0] : null;
  if (!p) {
    const prof2 = await sb(
      `/rest/v1/profiles?select=balance_cents,reusable_balance_cents,locked_balance_cents,demo_balance_cents,investor_balance_cents&id=eq.${encodeURIComponent(row.user_id)}&limit=1`,
      { token: SERVICE_KEY }
    );
    p = Array.isArray(prof2) ? prof2[0] : null;
  }
  if (!p) throw new Error(`Perfil ${row.user_id} não encontrado para crédito`);

  const patch = { updated_at: now };
  // Legado: solta o stake do locked. fee_upfront não travou stake.
  if (!feeUpfront) {
    patch.locked_balance_cents = Math.max(
      0,
      nCents(p.locked_balance_cents) - amount
    );
  }
  // ArbiShield: stake + dedução → bucket do contrato (REAL=Saldo Reembolso).
  const bucket = creditBucketForSettlement(balanceType);
  if (bucket === "demo_balance_cents") {
    patch.demo_balance_cents = nCents(p.demo_balance_cents) + credit;
  } else if (bucket === "investor_balance_cents") {
    patch.investor_balance_cents = nCents(p.investor_balance_cents) + credit;
  } else {
    patch.deduction_balance_cents = nCents(p.deduction_balance_cents) + credit;
  }

  let creditedOk = false;
  let lastErr = null;
  const attempts = [
    patch,
    (() => {
      const s = { ...patch };
      delete s.updated_at;
      return s;
    })(),
  ];
  // Fallback se deduction_balance_cents ainda não existir no schema
  if (bucket === "deduction_balance_cents") {
    attempts.push({
      updated_at: now,
      balance_cents: nCents(p.balance_cents) + credit,
    });
    attempts.push({ balance_cents: nCents(p.balance_cents) + credit });
  }
  for (const body of attempts) {
    try {
      await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(row.user_id)}`, {
        method: "PATCH",
        token: SERVICE_KEY,
        body,
      });
      creditedOk = true;
      if (body.balance_cents != null && body.deduction_balance_cents == null) {
        bucket = "balance_cents";
      }
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!creditedOk) {
    throw lastErr || new Error("Falha ao creditar carteira do cliente");
  }

  try {
    await sb("/rest/v1/wallet_transactions", {
      method: "POST",
      token: SERVICE_KEY,
      body: {
        user_id: row.user_id,
        type: "protection_settlement",
        amount_cents: credit,
        ref: row.id,
        metadata: {
          protection_id: row.id,
          match_id: row.match_id || null,
          outcome: String(outcome).toLowerCase(),
          stake_cents: parts.stake,
          fee_cents: parts.fee,
          fee_returned_cents: wonArbi || isVoid ? parts.fee : 0,
          bucket,
          billing_model: feeUpfront ? "fee_upfront_v1" : "legacy_lock",
          fix: isVoid
            ? "settle-empate-anula-deducao-v1"
            : "settle-arbishield-stake-mais-deducao-v1",
          note: isVoid
            ? "Empate Anula: devolve só a dedução (Saldo Reembolso)"
            : wonArbi
              ? "ArbiShield: stake + dedução creditados (Saldo Reembolso / bucket origem)"
              : undefined,
        },
      },
    });
  } catch (e) {
    console.warn(
      "[settle] wallet_transactions:",
      e instanceof Error ? e.message : e
    );
  }

  return {
    refunded: credit,
    credited: credit,
    stakeCents: parts.stake,
    feeCents: parts.fee,
    bucket,
    void: isVoid,
  };
}

async function settleOneProtectionRow(row, outcome, now) {
  const outcomeNorm = normalizeSettleOutcome(outcome);
  const wonArbi = outcomeNorm === "arbishield";
  const isVoid = outcomeNorm === "void";
  const status = settlementStatusForOutcome(outcomeNorm);
  const amount = nCents(row.responsibility_cents || row.amount_cents);

  // Crédito OBRIGATÓRIO antes de marcar a proteção (não engolir erro de saldo)
  const creditResult = await creditWalletForSettlement(row, outcomeNorm, now);
  const refunded = creditResult.refunded || 0;

  // Schema VPS: protections NÃO tem updated_at — nunca incluir no PATCH.
  // NÃO usar fallback status:"settled" (UI cliente mostra como EXCHANGE).
  const settledOutcome = isVoid ? "void" : outcomeNorm;
  const attempts = [
    {
      status,
      settled_at: now,
      settled_outcome: settledOutcome,
      result: status,
    },
    { status, settled_at: now, settled_outcome: settledOutcome },
    { status, settled_at: now, result: status },
    { status, settled_at: now },
  ];
  if (wonArbi) {
    // fallback se lost_exchange não existir no enum do banco
    attempts.push(
      {
        status: "won_platform",
        settled_at: now,
        settled_outcome: settledOutcome,
        result: "lost_exchange",
      },
      {
        status: "won_platform",
        settled_at: now,
        settled_outcome: settledOutcome,
      }
    );
  }
  if (isVoid) {
    attempts.push(
      {
        status: "cancelled",
        settled_at: now,
        settled_outcome: "void",
        result: "void",
      },
      { status: "cancelled", settled_at: now, settled_outcome: "void" }
    );
  }
  let lastErr = null;
  for (const body of attempts) {
    try {
      await sb(`/rest/v1/${row._table}?id=eq.${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        token: SERVICE_KEY,
        body,
      });
      return {
        ok: true,
        refunded,
        credited: refunded,
        status: body.status,
        amount,
        alreadyCredited: !!creditResult.alreadyCredited,
      };
    } catch (err) {
      lastErr = err;
    }
  }
  throw (
    lastErr ||
    new Error(
      `Falha ao liquidar proteção ${row.id} (crédito ${refunded}¢ já pode ter sido lançado)`
    )
  );
}

async function fetchProtectionsNeedingCredit(matchId) {
  async function load(table) {
    try {
      const rows = await sb(
        `/rest/v1/${table}?match_id=eq.${encodeURIComponent(matchId)}&status=in.(won_exchange,won_platform,lost_exchange,lost_platform,settled)&select=*&limit=2000`,
        { token: SERVICE_KEY }
      );
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }
  const [lays, backs] = await Promise.all([
    load("protections"),
    load("back_protections"),
  ]);
  const all = [
    ...lays.map((r) => ({ ...r, _table: "protections" })),
    ...backs.map((r) => ({ ...r, _table: "back_protections" })),
  ];
  const out = [];
  for (const row of all) {
    if (!(await protectionAlreadyCredited(row.id))) out.push(row);
  }
  return out;
}

async function settleMatchFromBody(body, token) {
  const adminId = await requireAdminToken(token);
  const matchId = String(body?.matchId || body?.id || "").trim();
  if (!matchId) throw new Error("matchId obrigatório");
  let outcome = normalizeSettleOutcome(body?.outcome || "");
  if (outcome !== "arbishield" && outcome !== "exchange" && outcome !== "void") {
    throw new Error(
      "outcome inválido (use arbishield, exchange ou empate_anula/void)"
    );
  }
  let finalScore = body?.finalScore || body?.final_score || null;
  if (
    !finalScore &&
    (body?.homeScore != null || body?.awayScore != null)
  ) {
    finalScore = `${Number(body.homeScore || 0)}-${Number(body.awayScore || 0)}`;
  }
  if (!finalScore) throw new Error("placar obrigatório");

  const rows = await sb(
    `/rest/v1/matches?id=eq.${encodeURIComponent(matchId)}&select=*&limit=1`,
    { token: SERVICE_KEY }
  );
  const match = Array.isArray(rows) ? rows[0] : null;
  if (!match) throw new Error("Partida não encontrada");

  const now = new Date().toISOString();
  let markets = Array.isArray(match.markets) ? [...match.markets] : [];
  markets = markets.map((m) => ({ ...m, settled_outcome: outcome }));

  // IMPORTANTE: liquidar proteções ANTES de marcar a partida.
  // Trigger legado no Postgres bloqueia UPDATE matches → settled enquanto
  // houver LAY/BACK ativos ("Encerramento bloqueado: existem N proteções…").
  let open = await fetchOpenProtectionsForMatch(matchId);
  let repaired = false;
  if (open.length === 0) {
    // Partida já encerrada sem crédito na carteira (bug anterior) — reprocessa
    const needing = await fetchProtectionsNeedingCredit(matchId);
    if (needing.length) {
      open = needing;
      repaired = true;
    }
  }
  let settledCount = 0;
  let refundedCents = 0;
  const settleErrors = [];

  for (const row of open) {
    try {
      const r = await settleOneProtectionRow(row, outcome, now);
      settledCount += 1;
      refundedCents += r.refunded || 0;
    } catch (err) {
      settleErrors.push(
        `${row._table}/${row.id}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (!repaired) {
    const still = await countOpenProtections(matchId);
    if (still.total > 0) {
      const detail = settleErrors.length
        ? ` Detalhes: ${settleErrors.slice(0, 3).join(" | ")}`
        : "";
      throw Object.assign(
        new Error(
          `Não foi possível liquidar todas as proteções (${still.lay} LAY / ${still.back} BACK ainda abertas).${detail}`
        ),
        { status: 409 }
      );
    }
  } else if (settleErrors.length) {
    throw Object.assign(
      new Error(
        `Falha ao reparar crédito na carteira: ${settleErrors.slice(0, 3).join(" | ")}`
      ),
      { status: 409 }
    );
  } else if (settledCount === 0 && settleErrors.length === 0 && open.length === 0) {
    // sem abertas e sem reparo — ainda assim marca placar se pedido
  }

  // Resolve nome do admin para gravar “Encerrado por”
  const settledByName =
    (await resolveAdminDisplayName(adminId)) || adminId.slice(0, 8);

  const prevMeta =
    match.metadata && typeof match.metadata === "object" ? { ...match.metadata } : {};
  prevMeta.settled_by = adminId;
  prevMeta.settled_by_name = settledByName;
  prevMeta.settled_at = now;
  prevMeta.settled_outcome = outcome;

  // Só agora marca a partida (evita o trigger de proteções ativas).
  // updated_by/settled_by = adminId: trigger match_change_logs exige admin_id NOT NULL.
  // status_v2 enum na VPS aceita "closed" (não "settled").
  // Finalizado NUNCA fica publicado — some da grade do cliente e da Fila.
  const basePatch = {
    final_score: String(finalScore),
    settled_at: now,
    status: "settled",
    is_published: false,
    markets,
    updated_at: now,
    updated_by: adminId,
    settled_by: adminId,
    metadata: prevMeta,
  };
  const patchAttempts = [
    { ...basePatch, status_v2: "closed" },
    { ...basePatch, status_v2: "finished" },
    basePatch,
  ];
  let patched = false;
  let lastPatchErr = null;
  for (const body of patchAttempts) {
    try {
      await sb(`/rest/v1/matches?id=eq.${encodeURIComponent(matchId)}`, {
        method: "PATCH",
        token: SERVICE_KEY,
        body,
      });
      patched = true;
      break;
    } catch (err) {
      lastPatchErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (/admin_id|match_change_logs/i.test(msg)) {
        // tenta de novo com o token do admin (JWT sub = admin_id no trigger)
        try {
          await sb(`/rest/v1/matches?id=eq.${encodeURIComponent(matchId)}`, {
            method: "PATCH",
            token,
            body,
          });
          patched = true;
          break;
        } catch (errAdmin) {
          lastPatchErr = errAdmin;
        }
      }
    }
  }
  if (!patched) {
    const msg = lastPatchErr instanceof Error ? lastPatchErr.message : String(lastPatchErr || "");
    if (/bloqueado|ativas|liquidação oficial|liquidacao oficial/i.test(msg)) {
      const again = await countOpenProtections(matchId);
      throw Object.assign(
        new Error(
          `Encerramento ainda bloqueado pelo banco (${again.lay} LAY / ${again.back} BACK). Proteções liquidadas nesta rodada: ${settledCount}.`
        ),
        { status: 409 }
      );
    }
    if (/admin_id|match_change_logs/i.test(msg)) {
      throw Object.assign(
        new Error(
          "Falha ao auditar encerramento (admin_id). Confirme o login admin e tente de novo."
        ),
        { status: 400 }
      );
    }
    throw lastPatchErr || new Error("Falha ao marcar partida como encerrada");
  }

  try {
    await sb("/rest/v1/admin_audit_logs", {
      method: "POST",
      token: SERVICE_KEY,
      body: {
        admin_id: adminId,
        action: "ADMIN_ACTION_SETTLE",
        entity_type: "matches",
        entity_id: matchId,
        details: {
          outcome,
          finalScore,
          settledCount,
          refundedCents,
          repaired,
          fix: "settle-arbishield-saldo-real-v1",
        },
      },
    });
  } catch {
    /* */
  }

  return {
    ok: true,
    matchId,
    outcome,
    finalScore: String(finalScore),
    settledCount,
    refundedCents,
    repaired,
    fix: "settle-arbishield-saldo-real-v1",
  };
}

function decodeJwtPayload(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length < 2) return null;
    const json = Buffer.from(
      parts[1].replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Valida o JWT no Auth (assinatura/expiração). Não confiar só no payload base64. */
async function requireUserIdFromToken(userToken) {
  const token = String(userToken || "").trim();
  if (!token) {
    const err = new Error("Não autorizado");
    err.status = 401;
    throw err;
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: "GET",
      headers: {
        apikey: ANON_KEY || SERVICE_KEY,
        Authorization: `Bearer ${token}`,
      },
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok || !data?.id) {
      const err = new Error("Sessão inválida ou expirada");
      err.status = 401;
      throw err;
    }
    return String(data.id);
  } catch (e) {
    if (e && e.status === 401) throw e;
    // Fallback: payload sem verify só se Auth estiver fora — ainda exige sub
    const payload = decodeJwtPayload(token);
    const sub = payload?.sub ? String(payload.sub) : "";
    if (!sub) {
      const err = new Error("Não autorizado");
      err.status = 401;
      throw err;
    }
    console.warn(
      "[auth] /auth/v1/user falhou — usando sub do JWT sem verify:",
      e instanceof Error ? e.message : e
    );
    return sub;
  }
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

// Cálculo fee_upfront / LAY / BACK: scripts/lib/protection-flow-contract.mjs (TRAVADO)

async function createProtection(body, userToken) {
  if (!SERVICE_KEY) throw new Error("SERVICE_ROLE_KEY ausente no .env da VPS");
  const userId = await requireUserIdFromToken(userToken);

  const matchId = String(body.matchId || "");
  const marketId = body.marketId ? String(body.marketId) : null;
  const amountCents = Math.floor(Number(body.amountCents));
  const odd = Number(body.odd);
  const balanceType = String(body.balanceType || "REAL").toUpperCase();
  const side = body.side ? String(body.side) : "home";

  if (!matchId) {
    const err = new Error("matchId obrigatório");
    err.status = 400;
    throw err;
  }
  if (!(amountCents > 0)) {
    const err = new Error("Valor inválido");
    err.status = 400;
    throw err;
  }
  if (!(odd > 1.01)) {
    const err = new Error("Odd inválida");
    err.status = 400;
    throw err;
  }

  const matchRows = await sb(
    `/rest/v1/matches?id=eq.${encodeURIComponent(matchId)}&select=id,home_team,away_team,starts_at,status,status_v2,is_published,deleted_at,markets,max_protection_cents,used_protection_cents,metadata&limit=1`,
    { token: SERVICE_KEY }
  );
  const match = Array.isArray(matchRows) ? matchRows[0] : null;
  if (!match || match.deleted_at) {
    const err = new Error("Jogo não encontrado");
    err.status = 404;
    throw err;
  }
  if (match.is_published === false) {
    const err = new Error("Jogo não publicado");
    err.status = 400;
    throw err;
  }
  {
    const matchMeta =
      match.metadata && typeof match.metadata === "object" ? match.metadata : {};
    if (matchMeta.sandbox_test === true && !IS_SANDBOX_WORKER) {
      const err = new Error(
        "Evento de teste: proteja em https://arbishield.app/sandbox/app-proteger.html (API sandbox)."
      );
      err.status = 400;
      throw err;
    }
  }
  if (match.starts_at) {
    const startMs = new Date(match.starts_at).getTime();
    const now = Date.now();
    // Alinha com a grade do cliente (LIVE_WINDOW ≈ 2h30 pós-kickoff).
    const LIVE_WINDOW_MS = 9000 * 1000;
    if (Number.isFinite(startMs) && startMs + LIVE_WINDOW_MS <= now) {
      const err = new Error(
        "Jogo fora da janela de proteção. Não é possível criar novas proteções."
      );
      err.status = 400;
      throw err;
    }
    const meta =
      match.metadata && typeof match.metadata === "object" ? match.metadata : {};
    const releaseMins = Number(
      meta.release_minutes_before ?? match.release_minutes_before ?? 0
    );
    if (Number.isFinite(releaseMins) && releaseMins > 0 && Number.isFinite(startMs)) {
      const unlockAt = startMs - releaseMins * 60_000;
      if (now < unlockAt) {
        const err = new Error(
          `Entradas liberam ${releaseMins} min antes do jogo. Aguarde a liberação.`
        );
        err.status = 400;
        throw err;
      }
    }
  }

  const markets = Array.isArray(match.markets) ? [...match.markets] : [];
  let market =
    (marketId && markets.find((m) => String(m.id) === marketId)) ||
    markets[0] ||
    null;

  const marketType =
    body.marketType === "BACK" || body.marketType === "LAY"
      ? body.marketType
      : String(market?.market_type || "").toUpperCase() === "BACK"
        ? "BACK"
        : "LAY";

  if (market) {
    const liq = n(market.liquidity);
    const used = n(market.used_liquidity);
    if (liq > 0 && amountCents > liq - used) {
      const err = new Error("Liquidez insuficiente neste mercado");
      err.status = 400;
      throw err;
    }
  }

  const usedMatch = n(match.used_protection_cents);
  const maxMatch = n(match.max_protection_cents);
  if (maxMatch > 0 && amountCents > maxMatch - usedMatch) {
    const err = new Error("Liquidez insuficiente neste jogo");
    err.status = 400;
    throw err;
  }

  let profileRows = await sb(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,balance_cents,reusable_balance_cents,deduction_balance_cents,demo_balance_cents,investor_balance_cents,account_status,locked_balance_cents&limit=1`,
    { token: SERVICE_KEY }
  ).catch(() => null);
  if (!Array.isArray(profileRows) || !profileRows[0]) {
    profileRows = await sb(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,balance_cents,reusable_balance_cents,demo_balance_cents,investor_balance_cents,account_status,locked_balance_cents&limit=1`,
      { token: SERVICE_KEY }
    );
  }
  const profile = Array.isArray(profileRows) ? profileRows[0] : null;
  if (!profile) {
    const err = new Error("Perfil não encontrado");
    err.status = 404;
    throw err;
  }
  const st = String(profile.account_status || "").toLowerCase();
  if (["blocked", "suspended", "banned", "inactive", "inativo"].includes(st)) {
    const err = new Error("Conta bloqueada para operar");
    err.status = 403;
    throw err;
  }

  const c = marketType === "BACK" ? calcBack(amountCents, odd) : calcLay(amountCents, odd);
  const feeCents = Math.max(0, n(c.arbiShieldDeductionCents));

  let available = 0;
  if (balanceType === "DEMO") available = n(profile.demo_balance_cents);
  else if (balanceType === "INVESTOR")
    available = n(profile.investor_balance_cents);
  else
    available =
      n(profile.balance_cents) +
      n(profile.reusable_balance_cents) +
      n(profile.deduction_balance_cents);

  // fee_upfront: só precisa ter saldo para a DEDUÇÃO (não para o stake)
  // Se REAL estiver zerado mas DEMO cobrir (crédito de teste), usa DEMO.
  let walletType = balanceType;
  if (feeCents > available && walletType === "REAL") {
    const demoAvail = n(profile.demo_balance_cents);
    if (demoAvail >= feeCents) {
      walletType = "DEMO";
      available = demoAvail;
      console.warn(
        "[createProtection] REAL sem saldo para dedução — usando DEMO automaticamente"
      );
    }
  }
  if (feeCents > available) {
    const err = new Error(
      `Saldo insuficiente para a dedução de ${(feeCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} (1,5% fica com você; o restante do lucro da odd é cobrado agora). Saldo ${walletType}: ${(available / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.`
    );
    err.status = 400;
    throw err;
  }

  const balanceBefore = available;
  // NÃO trava o stake em locked_balance — só debita a dedução
  const patch = {
    updated_at: new Date().toISOString(),
  };
  let balanceAfter = 0;

  if (walletType === "DEMO") {
    patch.demo_balance_cents = n(profile.demo_balance_cents) - feeCents;
    balanceAfter = patch.demo_balance_cents;
  } else if (walletType === "INVESTOR") {
    patch.investor_balance_cents =
      n(profile.investor_balance_cents) - feeCents;
    balanceAfter = patch.investor_balance_cents;
  } else {
    // Consome banca real + reusable primeiro; depois Saldo Reembolso
    let left = feeCents;
    const bal = n(profile.balance_cents) + n(profile.reusable_balance_cents);
    const ded = n(profile.deduction_balance_cents);
    patch.reusable_balance_cents = 0;
    if (bal >= left) {
      patch.balance_cents = bal - left;
      patch.deduction_balance_cents = ded;
      left = 0;
    } else {
      left -= bal;
      patch.balance_cents = 0;
      patch.deduction_balance_cents = Math.max(0, ded - left);
      left = 0;
    }
    balanceAfter =
      n(patch.balance_cents) + n(patch.deduction_balance_cents);
  }

  const patchedProfile = await sb(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      token: SERVICE_KEY,
      body: patch,
    }
  );
  const patchedRow = Array.isArray(patchedProfile)
    ? patchedProfile[0]
    : patchedProfile;
  if (feeCents > 0 && patchedRow) {
    const okDebit =
      walletType === "DEMO"
        ? n(patchedRow.demo_balance_cents) ===
          n(profile.demo_balance_cents) - feeCents
        : walletType === "INVESTOR"
          ? n(patchedRow.investor_balance_cents) ===
            n(profile.investor_balance_cents) - feeCents
          : n(patchedRow.balance_cents) +
              n(patchedRow.deduction_balance_cents) +
              n(patchedRow.reusable_balance_cents) ===
            n(profile.balance_cents) +
              n(profile.reusable_balance_cents) +
              n(profile.deduction_balance_cents) -
              feeCents;
    if (!okDebit) {
      const err = new Error(
        `Falha ao debitar saldo ${walletType} (dedução ${feeCents} não aplicada no perfil).`
      );
      err.status = 500;
      throw err;
    }
  }

  const meta = {
    ...(body.metadata && typeof body.metadata === "object" ? body.metadata : {}),
    market_id: market?.id || marketId || null,
    market_name: market?.name || null,
    market_type: marketType,
    market_odd: market?.odd ?? odd,
    home_team: match.home_team || null,
    away_team: match.away_team || null,
    league: match.league || match.competition || null,
    starts_at: match.starts_at || null,
    source: "v2_create_protection_fee_upfront",
    billing_model: "fee_upfront_v1",
    fee_upfront: true,
    fee_charged_cents: feeCents,
    stake_cents: amountCents,
    user_profit_cents: c.userProfitCents,
    gross_profit_cents: c.grossProfitCents,
    calculations: c,
    balance_type: walletType,
    balance_type_requested: balanceType,
  };

  let protectionId = "";
  try {
    if (marketType === "BACK") {
      const inserted = await sb("/rest/v1/back_protections", {
        method: "POST",
        token: SERVICE_KEY,
        body: {
          user_id: userId,
          match_id: matchId,
          odd: c.odd,
          status: "active",
          amount_cents: c.coverageCents,
          user_profit_cents: c.userProfitCents,
          platform_deduction_cents: feeCents,
          balance_before_cents: balanceBefore,
          balance_after_cents: balanceAfter,
          metadata: meta,
        },
      });
      protectionId = Array.isArray(inserted) ? inserted[0]?.id : inserted?.id;
    } else {
      const inserted = await sb("/rest/v1/protections", {
        method: "POST",
        token: SERVICE_KEY,
        body: {
          user_id: userId,
          match_id: matchId,
          side,
          odd: c.odd,
          status: "active",
          amount_cents: c.responsibilityCents,
          responsibility_cents: c.responsibilityCents,
          user_profit_cents: c.userProfitCents,
          platform_deduction_cents: feeCents,
          platform_profit_cents: feeCents,
          locked_deduction_cents: 0,
          exchange_fee_cents: 0,
          exchange_profit_net_cents: c.grossProfitCents,
          balance_before_cents: balanceBefore,
          balance_after_cents: balanceAfter,
          metadata: meta,
        },
      });
      protectionId = Array.isArray(inserted) ? inserted[0]?.id : inserted?.id;
    }
    if (!protectionId) throw new Error("Falha ao gravar proteção");
  } catch (err) {
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: {
        balance_cents: profile.balance_cents,
        reusable_balance_cents: profile.reusable_balance_cents,
        demo_balance_cents: profile.demo_balance_cents,
        investor_balance_cents: profile.investor_balance_cents,
        locked_balance_cents: profile.locked_balance_cents,
        updated_at: new Date().toISOString(),
      },
    }).catch(() => {});
    throw err;
  }

  if (market) {
    const idx = markets.findIndex((m) => String(m.id) === String(market.id));
    if (idx >= 0) {
      markets[idx] = {
        ...markets[idx],
        used_liquidity: n(markets[idx].used_liquidity) + amountCents,
      };
    }
  }

  await sb(`/rest/v1/matches?id=eq.${encodeURIComponent(matchId)}`, {
    method: "PATCH",
    token: SERVICE_KEY,
    body: {
      markets,
      used_protection_cents: usedMatch + amountCents,
      updated_at: new Date().toISOString(),
    },
  });

  await sb("/rest/v1/wallet_transactions", {
    method: "POST",
    token: SERVICE_KEY,
    body: {
      user_id: userId,
      type: "protection_fee",
      amount_cents: -feeCents,
      balance_before_cents: balanceBefore,
      balance_after_cents: balanceAfter,
      ref: protectionId,
      metadata: {
        protection_id: protectionId,
        match_id: matchId,
        market_type: marketType,
        balance_type: walletType,
        billing_model: "fee_upfront_v1",
        stake_cents: amountCents,
        fee_cents: feeCents,
        user_profit_cents: c.userProfitCents,
      },
    },
  }).catch((e) => {
    console.warn("[createProtection] wallet_transactions:", e.message || e);
  });

  return {
    ok: true,
    protectionId,
    marketType,
    amountCents,
    feeChargedCents: feeCents,
    userProfitCents: c.userProfitCents,
    billingModel: "fee_upfront_v1",
    balanceType: walletType,
    balanceAfterCents: balanceAfter,
    sandboxWorker: IS_SANDBOX_WORKER,
  };
}

const CONTESTATION_LOCK_MS = 5 * 60 * 1000;

async function patchProtectionNoUpdatedAt(table, protectionId, body) {
  const payload = { ...body };
  delete payload.updated_at;
  await sb(`/rest/v1/${table}?id=eq.${encodeURIComponent(protectionId)}`, {
    method: "PATCH",
    token: SERVICE_KEY,
    body: payload,
  });
}

async function loadProtectionForContest(protectionId, category) {
  const isBack = String(category || "").toUpperCase() === "BACK";
  const table = isBack ? "back_protections" : "protections";
  const rows = await sb(
    `/rest/v1/${table}?select=*&id=eq.${encodeURIComponent(protectionId)}&limit=1`,
    { token: SERVICE_KEY }
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    const err = new Error("Proteção não encontrada");
    err.status = 404;
    throw err;
  }
  return { table, row, isBack };
}

function contestMetaFromRow(row, isBack) {
  if (isBack) {
    const calc =
      (row.calculations && typeof row.calculations === "object"
        ? row.calculations
        : null) ||
      (row.metadata && row.metadata.calculations) ||
      {};
    return (
      (calc && calc.contestation) ||
      (row.metadata && row.metadata.contestation) ||
      {}
    );
  }
  return (row.metadata && row.metadata.contestation) || {};
}

async function restoreMatchLiquidity(matchId, amountCents, marketId) {
  if (!matchId || !(amountCents > 0)) return;
  try {
    const matches = await sb(
      `/rest/v1/matches?select=id,used_protection_cents,markets&id=eq.${encodeURIComponent(matchId)}&limit=1`,
      { token: SERVICE_KEY }
    );
    const match = Array.isArray(matches) ? matches[0] : null;
    if (!match) return;
    const used = Math.max(0, n(match.used_protection_cents) - amountCents);
    let markets = Array.isArray(match.markets) ? [...match.markets] : [];
    if (marketId && markets.length) {
      markets = markets.map((m) => {
        if (String(m?.id) !== String(marketId)) return m;
        return {
          ...m,
          used_liquidity: Math.max(0, n(m.used_liquidity) - amountCents),
        };
      });
    }
    await sb(`/rest/v1/matches?id=eq.${encodeURIComponent(matchId)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: {
        used_protection_cents: used,
        markets,
        updated_at: new Date().toISOString(),
      },
    });
  } catch {
    /* liquidez best-effort */
  }
}

/** Já existe lançamento de estorno/liquidação para esta proteção? */
async function protectionRefundAlreadyDone(protectionId) {
  if (!protectionId) return false;
  try {
    const byRef = await sb(
      `/rest/v1/wallet_transactions?ref=eq.${encodeURIComponent(protectionId)}&type=in.(protection_refund,protection_settlement,protection_release)&select=id&limit=1`,
      { token: SERVICE_KEY }
    );
    if (Array.isArray(byRef) && byRef.length) return true;
  } catch {
    /* */
  }
  try {
    // fallback: metadata.protection_id (lançamentos antigos sem ref)
    const rows = await sb(
      `/rest/v1/wallet_transactions?type=eq.protection_refund&select=id,metadata&order=created_at.desc&limit=200`,
      { token: SERVICE_KEY }
    );
    return (Array.isArray(rows) ? rows : []).some(
      (t) =>
        t?.metadata &&
        String(t.metadata.protection_id || "") === String(protectionId)
    );
  } catch {
    return false;
  }
}

/**
 * Claim atômico: só 1 processo marca cancelled.
 * Evita F5 / contest_list creditar o mesmo estorno várias vezes.
 */
async function claimProtectionCancelled(table, protectionId, metadata) {
  const body = {
    status: "cancelled",
    settled_at: new Date().toISOString(),
    result: "cancelled_refund",
  };
  if (metadata != null) body.metadata = metadata;
  try {
    const claimed = await sb(
      `/rest/v1/${table}?id=eq.${encodeURIComponent(protectionId)}&status=in.(active,pending,review_odd)`,
      { method: "PATCH", token: SERVICE_KEY, body }
    );
    return Array.isArray(claimed) && claimed.length > 0;
  } catch (e) {
    // schema sem result/metadata → tenta só status
    try {
      const claimed = await sb(
        `/rest/v1/${table}?id=eq.${encodeURIComponent(protectionId)}&status=in.(active,pending,review_odd)`,
        {
          method: "PATCH",
          token: SERVICE_KEY,
          body: {
            status: "cancelled",
            settled_at: new Date().toISOString(),
          },
        }
      );
      return Array.isArray(claimed) && claimed.length > 0;
    } catch (e2) {
      console.warn("[prelive] claim cancel failed:", e2.message || e2);
      return false;
    }
  }
}

/** Estorno + status cancelled (service role) — IDEMPOTENTE. */
async function refundAndCancelProtection(table, row, audit = {}) {
  const protectionId = row.id;
  const stakeCents = n(row.responsibility_cents || row.amount_cents);
  const feeUpfront = isFeeUpfrontProtection(row);
  const feeCents = settlementDeductionCents(row);
  // fee_upfront: devolve a DEDUÇÃO cobrada na criação (nunca o stake)
  // legado: devolve o stake travado
  const amount = feeUpfront ? feeCents : stakeCents;
  const balanceType = String(
    (row.metadata && row.metadata.balance_type) ||
      (row.metadata && row.metadata.balance_type_requested) ||
      "REAL"
  ).toUpperCase();
  const userId = row.user_id ? String(row.user_id) : null;
  const st = String(row.status || "").toLowerCase();

  if (st === "cancelled") {
    return {
      ok: true,
      alreadyCancelled: true,
      action: "cancellation",
      auto: true,
      protectionId,
      status: "cancelled",
      refundedCents: 0,
    };
  }

  if (await protectionRefundAlreadyDone(protectionId)) {
    // Já creditou antes — só garante status cancelled, NÃO credita de novo
    try {
      await claimProtectionCancelled(table, protectionId, null);
    } catch {
      /* */
    }
    return {
      ok: true,
      alreadyRefunded: true,
      action: "cancellation",
      auto: true,
      protectionId,
      status: "cancelled",
      refundedCents: 0,
    };
  }

  const prevMeta =
    row.metadata && typeof row.metadata === "object" ? { ...row.metadata } : {};
  if (feeUpfront) {
    prevMeta.billing_model = prevMeta.billing_model || "fee_upfront_v1";
    prevMeta.fee_upfront = true;
    if (!(n(prevMeta.fee_charged_cents) > 0) && feeCents > 0) {
      prevMeta.fee_charged_cents = feeCents;
    }
  }
  prevMeta.auto_cancel = {
    reason: audit.reason || null,
    cancelled_at: new Date().toISOString(),
    cancelled_by: audit.cancelled_by || null,
    auto: true,
    refund_kind: feeUpfront ? "fee" : "stake",
    refund_cents: amount,
  };
  if (audit.reason) {
    prevMeta.contestation = {
      ...(prevMeta.contestation || {}),
      type: "cancellation",
      reason: audit.reason,
      cancelled_at: prevMeta.auto_cancel.cancelled_at,
      auto: true,
    };
  }

  // 1) Claim ANTES do crédito — 2º F5 não passa
  const claimed = await claimProtectionCancelled(table, protectionId, prevMeta);
  if (!claimed) {
    return {
      ok: true,
      alreadyCancelled: true,
      action: "cancellation",
      auto: true,
      protectionId,
      status: "cancelled",
      refundedCents: 0,
    };
  }

  if (feeUpfront && !(amount > 0)) {
    console.warn(
      "[prelive] fee_upfront cancel sem dedução para estornar:",
      protectionId
    );
  }

  // 2) Credita só quem ganhou o claim
  if (userId && amount > 0) {
    const prof = await sb(
      `/rest/v1/profiles?select=balance_cents,locked_balance_cents,demo_balance_cents,investor_balance_cents&id=eq.${encodeURIComponent(userId)}&limit=1`,
      { token: SERVICE_KEY }
    );
    const p = Array.isArray(prof) ? prof[0] : null;
    if (p) {
      const patchFull = {
        updated_at: new Date().toISOString(),
      };
      if (feeUpfront) {
        // Devolve só a taxa no mesmo bucket usado na criação
        if (balanceType === "DEMO") {
          patchFull.demo_balance_cents = n(p.demo_balance_cents) + amount;
        } else if (balanceType === "INVESTOR") {
          patchFull.investor_balance_cents = n(p.investor_balance_cents) + amount;
        } else {
          patchFull.balance_cents = n(p.balance_cents) + amount;
        }
        // fee_upfront não trava stake — não mexe em locked
      } else {
        // Legado: devolve stake e solta locked
        if (balanceType === "DEMO") {
          patchFull.demo_balance_cents = n(p.demo_balance_cents) + amount;
        } else if (balanceType === "INVESTOR") {
          patchFull.investor_balance_cents = n(p.investor_balance_cents) + amount;
        } else {
          patchFull.balance_cents = n(p.balance_cents) + amount;
        }
        patchFull.locked_balance_cents = Math.max(
          0,
          n(p.locked_balance_cents) - stakeCents
        );
      }
      try {
        await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
          method: "PATCH",
          token: SERVICE_KEY,
          body: patchFull,
        });
      } catch {
        const slim = { ...patchFull };
        delete slim.updated_at;
        await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
          method: "PATCH",
          token: SERVICE_KEY,
          body: slim,
        });
      }
    }
    try {
      await sb("/rest/v1/wallet_transactions", {
        method: "POST",
        token: SERVICE_KEY,
        body: {
          user_id: userId,
          type: "protection_refund",
          amount_cents: amount,
          ref: protectionId,
          metadata: {
            protection_id: protectionId,
            auto_cancel: true,
            billing_model: feeUpfront ? "fee_upfront_v1" : "legacy_lock",
            refund_kind: feeUpfront ? "fee" : "stake",
            fee_cents: feeCents,
            stake_cents: stakeCents,
            balance_type: balanceType,
            ...(audit || {}),
          },
        },
      });
    } catch (e) {
      console.warn("[prelive] wallet_transactions refund:", e.message || e);
    }
  }

  const marketId =
    row.market_id ||
    (row.metadata && (row.metadata.market_id || row.metadata.marketId)) ||
    null;
  // Liquidez do jogo sempre pelo stake (não pela taxa)
  await restoreMatchLiquidity(row.match_id, stakeCents, marketId);

  try {
    await sb(
      `/rest/v1/odd_contestations?protection_id=eq.${encodeURIComponent(protectionId)}&status=eq.pending`,
      {
        method: "PATCH",
        token: SERVICE_KEY,
        body: {
          status: "approved",
          resolved_at: new Date().toISOString(),
          resolved_by: audit.cancelled_by || null,
        },
      }
    );
  } catch {
    /* */
  }

  return {
    ok: true,
    action: "cancellation",
    auto: true,
    protectionId,
    status: "cancelled",
    refundedCents: amount,
  };
}

/**
 * Cancelamento pelo cliente: imediato, sem fila ADM.
 * (legado: "Cancelar Ancoragem" — saldo estornado na hora)
 */
async function contestCancelAuto(body, token) {
  const payload = decodeJwtPayload(token);
  const userId = payload?.sub ? String(payload.sub) : null;
  if (!userId) {
    const err = new Error("Não autorizado");
    err.status = 401;
    throw err;
  }
  if (!SERVICE_KEY) throw new Error("SERVICE_ROLE_KEY ausente no .env da VPS");

  const protectionId = String(body.protectionId || body.id || "").trim();
  const category = String(
    body.category || body.marketType || body.market_category || "LAY"
  ).toUpperCase();
  const reason = String(body.reason || body.note || "Cancelamento solicitado pelo cliente").trim();
  if (!protectionId) {
    const err = new Error("protectionId obrigatório");
    err.status = 400;
    throw err;
  }

  const { table, row } = await loadProtectionForContest(protectionId, category);
  if (String(row.user_id) !== String(userId)) {
    const err = new Error("Proteção não pertence a este usuário");
    err.status = 403;
    throw err;
  }
  const st = String(row.status || "").toLowerCase();
  if (st === "cancelled") {
    return { ok: true, alreadyCancelled: true, status: "cancelled", protectionId };
  }
  if (st !== "active" && st !== "pending" && st !== "review_odd") {
    const err = new Error("Só é possível cancelar proteções ativas ou em contestação");
    err.status = 400;
    throw err;
  }

  // Mesma trava de 5 min do legado
  if (row.match_id) {
    const matches = await sb(
      `/rest/v1/matches?select=id,starts_at&id=eq.${encodeURIComponent(row.match_id)}&limit=1`,
      { token: SERVICE_KEY }
    );
    const match = Array.isArray(matches) ? matches[0] : null;
    if (match?.starts_at) {
      const t = new Date(match.starts_at).getTime();
      if (!Number.isNaN(t) && Date.now() > t - CONTESTATION_LOCK_MS) {
        const err = new Error(
          "Cancelamento bloqueado: faltam menos de 5 minutos para o início da partida (ou o jogo já começou)."
        );
        err.status = 400;
        throw err;
      }
    }
  }

  return refundAndCancelProtection(table, row, {
    reason: reason.length >= 3 ? reason : "Cancelamento solicitado pelo cliente",
    cancelled_by: userId,
  });
}

async function contestSubmit(body, token) {
  const payload = decodeJwtPayload(token);
  const userId = payload?.sub ? String(payload.sub) : null;
  if (!userId) {
    const err = new Error("Não autorizado");
    err.status = 401;
    throw err;
  }
  if (!SERVICE_KEY) throw new Error("SERVICE_ROLE_KEY ausente no .env da VPS");

  const protectionId = String(body.protectionId || body.id || "").trim();
  const category = String(
    body.category || body.marketType || body.market_category || "LAY"
  ).toUpperCase();
  const contestTypeRaw = String(body.contestType || body.type || "odd_adjustment").toLowerCase();
  const contestType =
    contestTypeRaw === "cancellation" ||
    contestTypeRaw === "cancel" ||
    contestTypeRaw === "cancelamento"
      ? "cancellation"
      : "odd_adjustment";
  if (!protectionId) {
    const err = new Error("protectionId obrigatório");
    err.status = 400;
    throw err;
  }

  // Cancelamento NÃO vai para o ADM — estorna na hora
  if (contestType === "cancellation") {
    return contestCancelAuto(body, token);
  }

  const { table, row, isBack } = await loadProtectionForContest(
    protectionId,
    category
  );
  if (String(row.user_id) !== String(userId)) {
    const err = new Error("Proteção não pertence a este usuário");
    err.status = 403;
    throw err;
  }
  const st = String(row.status || "").toLowerCase();
  if (st === "review_odd") return { ok: true, alreadyExists: true };
  if (st !== "active" && st !== "pending") {
    const err = new Error("Só é possível contestar proteções ativas");
    err.status = 400;
    throw err;
  }

  if (row.match_id) {
    const matches = await sb(
      `/rest/v1/matches?select=id,starts_at&id=eq.${encodeURIComponent(row.match_id)}&limit=1`,
      { token: SERVICE_KEY }
    );
    const match = Array.isArray(matches) ? matches[0] : null;
    if (match?.starts_at) {
      const t = new Date(match.starts_at).getTime();
      if (!Number.isNaN(t) && Date.now() > t - CONTESTATION_LOCK_MS) {
        const err = new Error(
          "Contestação bloqueada: faltam menos de 5 minutos para o início da partida (ou o jogo já começou)."
        );
        err.status = 400;
        throw err;
      }
    }
  }

  const originalOdd = Number(row.odd);
  let requestedOdd = null;
  const proofUrl = String(body.proofUrl || body.betProofUrl || body.proof_url || "").trim();
  const reason = String(body.reason || body.note || "").trim();
  requestedOdd = Number(String(body.newOdd ?? body.requestedOdd ?? "").replace(",", "."));
  if (!(requestedOdd > 1)) {
    const err = new Error("Informe uma odd válida (> 1)");
    err.status = 400;
    throw err;
  }
  if (!proofUrl) {
    const err = new Error("Anexe o print do comprovante da casa de aposta");
    err.status = 400;
    throw err;
  }

  const contestation = {
    type: "odd_adjustment",
    original_odd: originalOdd,
    requested_odd: requestedOdd,
    proof_url: proofUrl || null,
    reason: reason || null,
    requested_at: new Date().toISOString(),
    requested_by: userId,
  };

  const prevMeta =
    row.metadata && typeof row.metadata === "object" ? { ...row.metadata } : {};
  prevMeta.contestation = contestation;
  const patch = { status: "review_odd", metadata: prevMeta };
  if (isBack) {
    const prevCalc =
      row.calculations && typeof row.calculations === "object"
        ? { ...row.calculations }
        : {};
    prevCalc.contestation = contestation;
    patch.calculations = prevCalc;
    prevMeta.calculations = prevCalc;
    patch.metadata = prevMeta;
  }

  await patchProtectionNoUpdatedAt(table, protectionId, patch);

  try {
    await sb("/rest/v1/odd_contestations", {
      method: "POST",
      token: SERVICE_KEY,
      body: {
        user_id: userId,
        protection_id: protectionId,
        status: "pending",
        contest_type: "odd_adjustment",
        original_odd: originalOdd,
        requested_odd: requestedOdd,
        proof_url: proofUrl || null,
        reason: reason || null,
        created_at: new Date().toISOString(),
      },
    });
  } catch (e) {
    console.warn("[prelive] odd_contestations insert:", e.message || e);
  }

  return {
    ok: true,
    alreadyExists: false,
    status: "review_odd",
    contestType: "odd_adjustment",
    label: "Em Contestação (Pendente)",
  };
}

async function contestList(token) {
  await requireAdminToken(token);
  if (!SERVICE_KEY) throw new Error("SERVICE_ROLE_KEY ausente no .env da VPS");

  async function load(table, category) {
    const rows = await sb(
      `/rest/v1/${table}?select=*&status=eq.review_odd&order=created_at.desc&limit=300`,
      { token: SERVICE_KEY }
    ).catch(() => []);
    return (Array.isArray(rows) ? rows : []).map((r) => ({
      ...r,
      market_category: category,
      _table: table,
    }));
  }

  const raw = [
    ...(await load("protections", "LAY")),
    ...(await load("back_protections", "BACK")),
  ];

  // NÃO estornar no list — listagem nunca deve alterar saldo (bug F5 / overcredit).
  // Cancelamentos em review_odd ficam ocultos do ADM; heal separado via script VPS.
  let skippedCancel = 0;
  const oddOnly = [];
  for (const r of raw) {
    const isBack = r.market_category === "BACK";
    const meta = contestMetaFromRow(r, isBack);
    if (meta.type === "cancellation") {
      skippedCancel += 1;
      continue;
    }
    oddOnly.push(r);
  }
  if (skippedCancel > 0) {
    console.warn(
      `[prelive] contest_list: ${skippedCancel} cancelamento(s) em review_odd ignorados (sem auto-estorno na listagem)`
    );
  }

  const list = oddOnly.sort((a, b) =>
    String(b.created_at || "").localeCompare(String(a.created_at || ""))
  );

  const userIds = [...new Set(list.map((r) => r.user_id).filter(Boolean))];
  const matchIds = [...new Set(list.map((r) => r.match_id).filter(Boolean))];
  const [profiles, matches] = await Promise.all([
    userIds.length
      ? sb(
          `/rest/v1/profiles?select=id,full_name&id=in.(${userIds.map(encodeURIComponent).join(",")})`,
          { token: SERVICE_KEY }
        ).catch(() => [])
      : [],
    matchIds.length
      ? sb(
          `/rest/v1/matches?select=id,home_team,away_team,league,starts_at&id=in.(${matchIds.map(encodeURIComponent).join(",")})`,
          { token: SERVICE_KEY }
        ).catch(() => [])
      : [],
  ]);
  const profileMap = new Map((Array.isArray(profiles) ? profiles : []).map((p) => [p.id, p]));
  const matchMap = new Map((Array.isArray(matches) ? matches : []).map((m) => [m.id, m]));

  return list.map((r) => {
    const isBack = r.market_category === "BACK";
    const meta = contestMetaFromRow(r, isBack);
    return {
      ...r,
      profiles: profileMap.get(r.user_id) || { full_name: "Usuário" },
      matches: matchMap.get(r.match_id) || null,
      contestation: {
        type: "odd_adjustment",
        requested_odd: meta.requested_odd ?? null,
        original_odd: meta.original_odd ?? Number(r.odd),
        proof_url: meta.proof_url ?? null,
        reason: meta.reason ?? null,
        requested_at: meta.requested_at ?? r.created_at,
      },
    };
  });
}

async function contestApprove(body, token) {
  const adminId = await requireAdminToken(token);
  const protectionId = String(body.protectionId || body.id || "").trim();
  const category = String(
    body.category || body.marketType || body.market_category || "LAY"
  ).toUpperCase();
  if (!protectionId) throw new Error("protectionId obrigatório");

  const { table, row, isBack } = await loadProtectionForContest(protectionId, category);
  if (String(row.status || "").toLowerCase() !== "review_odd") {
    throw new Error("Esta proteção não está em contestação");
  }
  const meta = contestMetaFromRow(row, isBack);
  const contestType = meta.type === "cancellation" ? "cancellation" : "odd_adjustment";

  if (contestType === "cancellation") {
    const result = await refundAndCancelProtection(table, row, {
      reason: meta.reason || "Cancelamento aprovado pelo admin",
      cancelled_by: adminId,
    });
    return result;
  }

  const approvedOdd = Number(
    String(body.approvedOdd ?? meta.requested_odd ?? "").replace(",", ".")
  );
  if (!(approvedOdd > 1)) throw new Error("Odd aprovada inválida");
  const amount = n(row.responsibility_cents || row.amount_cents);
  const prevMeta =
    row.metadata && typeof row.metadata === "object" ? { ...row.metadata } : {};
  prevMeta.contestation = {
    ...meta,
    approved_odd: approvedOdd,
    approved_at: new Date().toISOString(),
    approved_by: adminId,
    contestation_approved: true,
  };

  let patch;
  if (isBack) {
    const c = calcBack(amount, approvedOdd);
    patch = {
      status: "active",
      odd: approvedOdd,
      amount_cents: c.coverageCents,
      user_profit_cents: c.userProfitCents,
      platform_deduction_cents: c.arbiShieldDeductionCents,
      metadata: prevMeta,
      calculations: { ...(row.calculations || {}), ...c, contestation: prevMeta.contestation },
    };
  } else {
    const c = calcLay(amount, approvedOdd);
    patch = {
      status: "active",
      odd: approvedOdd,
      amount_cents: c.responsibilityCents,
      responsibility_cents: c.responsibilityCents,
      user_profit_cents: c.userProfitCents,
      platform_deduction_cents: c.arbiShieldDeductionCents,
      platform_profit_cents: c.arbiShieldDeductionCents,
      locked_deduction_cents: c(c.lockedDeductionCents),
      exchange_fee_cents: c.exchangeFeeCents,
      exchange_profit_net_cents: c.exchangeProfitNetCents,
      metadata: prevMeta,
    };
  }
  await patchProtectionNoUpdatedAt(table, protectionId, patch);
  try {
    await sb(
      `/rest/v1/odd_contestations?protection_id=eq.${encodeURIComponent(protectionId)}&status=eq.pending`,
      {
        method: "PATCH",
        token: SERVICE_KEY,
        body: {
          status: "approved",
          approved_odd: approvedOdd,
          resolved_at: new Date().toISOString(),
          resolved_by: adminId,
        },
      }
    );
  } catch {
    /* */
  }
  return { ok: true, action: "odd_adjustment", protectionId, approvedOdd, status: "active" };
}

async function contestReject(body, token) {
  const adminId = await requireAdminToken(token);
  const protectionId = String(body.protectionId || body.id || "").trim();
  const category = String(
    body.category || body.marketType || body.market_category || "LAY"
  ).toUpperCase();
  const reason = String(
    body.reason || body.note || "Odd validada como correta pelo sistema."
  ).trim();
  if (!protectionId) throw new Error("protectionId obrigatório");

  const { table, row, isBack } = await loadProtectionForContest(protectionId, category);
  if (String(row.status || "").toLowerCase() !== "review_odd") {
    throw new Error("Esta proteção não está em contestação");
  }
  const meta = contestMetaFromRow(row, isBack);
  const prevMeta =
    row.metadata && typeof row.metadata === "object" ? { ...row.metadata } : {};
  prevMeta.contestation = {
    ...meta,
    rejected_at: new Date().toISOString(),
    rejected_by: adminId,
    reject_reason: reason,
  };
  const patch = { status: "active", metadata: prevMeta };
  if (isBack) {
    const prevCalc =
      row.calculations && typeof row.calculations === "object"
        ? { ...row.calculations }
        : {};
    prevCalc.contestation = prevMeta.contestation;
    patch.calculations = prevCalc;
  }
  await patchProtectionNoUpdatedAt(table, protectionId, patch);
  try {
    await sb(
      `/rest/v1/odd_contestations?protection_id=eq.${encodeURIComponent(protectionId)}&status=eq.pending`,
      {
        method: "PATCH",
        token: SERVICE_KEY,
        body: {
          status: "rejected",
          resolved_at: new Date().toISOString(),
          resolved_by: adminId,
          reject_reason: reason,
        },
      }
    );
  } catch {
    /* */
  }
  return { ok: true, protectionId, status: "active", rejected: true };
}

function normalizeTeamName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function teamNamesMatch(a, b) {
  const na = normalizeTeamName(a);
  const nb = normalizeTeamName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.includes(nb) || nb.includes(na);
}

function crestUrlsFrom(crest) {
  const raw = String(crest || "").trim();
  if (!raw) return { logo: "", logoPng: null, logoSvg: null };
  if (raw.endsWith(".svg")) {
    return {
      logo: raw,
      logoSvg: raw,
      logoPng: raw.replace(/\.svg$/i, ".png"),
    };
  }
  if (raw.endsWith(".png")) {
    const svg = raw.replace(/\.png$/i, ".svg");
    return { logo: svg, logoSvg: svg, logoPng: raw };
  }
  return { logo: raw, logoPng: raw, logoSvg: null };
}

async function searchTheSportsDbTeams(query) {
  const url =
    "https://www.thesportsdb.com/api/v1/json/123/searchteams.php?t=" +
    encodeURIComponent(query);
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`TheSportsDB ${res.status}`);
  const data = await res.json();
  const teams = Array.isArray(data?.teams) ? data.teams : [];
  return teams
    .filter((t) => String(t.strSport || "").toLowerCase() === "soccer")
    .map((t) => {
      const logoPng = String(t.strBadge || t.strLogo || "").trim() || null;
      return {
        id: `tsdb:${t.idTeam || normalizeTeamName(t.strTeam || query)}`,
        name: String(t.strTeam || "").trim(),
        shortName: String(t.strTeamShort || "").trim() || null,
        country: String(t.strCountry || "").trim() || null,
        league: String(t.strLeague || "").trim() || null,
        logo: logoPng || "",
        logoPng,
        logoSvg: null,
        source: "thesportsdb",
      };
    })
    .filter((t) => t.name && t.logo);
}

async function searchFootballDataTeams(query, token) {
  const url =
    "https://api.football-data.org/v4/teams?limit=25&name=" +
    encodeURIComponent(query);
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Auth-Token": token,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`football-data.org ${res.status}: ${text.slice(0, 120)}`);
  }
  const data = await res.json();
  const teams = Array.isArray(data?.teams) ? data.teams : [];
  return teams
    .map((t) => {
      const crests = crestUrlsFrom(t.crest);
      return {
        id: `fd:${t.id ?? normalizeTeamName(t.name || query)}`,
        name: String(t.name || "").trim(),
        shortName: String(t.shortName || t.tla || "").trim() || null,
        country: String(t.area?.name || "").trim() || null,
        league: null,
        logo: crests.logo,
        logoPng: crests.logoPng,
        logoSvg: crests.logoSvg,
        source: "football-data",
      };
    })
    .filter((t) => t.name && t.logo);
}

function mergeFootballTeams(primary, secondary) {
  const out = [];
  const used = new Set();
  for (const a of primary) {
    const match = secondary.find(
      (b) => !used.has(b.id) && teamNamesMatch(a.name, b.name)
    );
    if (match) {
      used.add(match.id);
      const logoSvg = match.logoSvg || a.logoSvg;
      const logoPng = a.logoPng || match.logoPng;
      out.push({
        id: a.id,
        name: a.name,
        shortName: a.shortName || match.shortName,
        country: a.country || match.country,
        league: a.league || match.league,
        logo: logoSvg || logoPng || a.logo || match.logo,
        logoPng,
        logoSvg,
        source: "merged",
      });
    } else {
      out.push(a);
    }
  }
  for (const b of secondary) {
    if (!used.has(b.id)) out.push(b);
  }
  return out;
}

async function searchFootballTeams(rawQuery) {
  const query = String(rawQuery || "").trim();
  if (query.length < 2) {
    return { teams: [], providers: [] };
  }

  const providers = [];
  let sportsDb = [];
  let footballData = [];

  const sportsDbPromise = searchTheSportsDbTeams(query)
    .then((rows) => {
      sportsDb = rows;
      providers.push("thesportsdb");
    })
    .catch((err) => {
      console.warn("[football-teams] thesportsdb", err);
    });

  const token =
    process.env.FOOTBALL_DATA_API_TOKEN ||
    process.env.FOOTBALL_DATA_API_KEY ||
    "";
  const footballDataPromise = token
    ? searchFootballDataTeams(query, token)
        .then((rows) => {
          footballData = rows;
          providers.push("football-data");
        })
        .catch((err) => {
          console.warn("[football-teams] football-data", err);
        })
    : Promise.resolve();

  await Promise.all([sportsDbPromise, footballDataPromise]);

  const teams = mergeFootballTeams(
    footballData.length ? footballData : sportsDb,
    footballData.length ? sportsDb : []
  ).slice(0, 20);

  return { teams, providers };
}

/** Um jogo teste BACK+LAY @ 1.10 — sem JWT admin. Só localhost do worker. */
async function launchTestEvent(query = {}) {
  if (!SERVICE_KEY) throw Object.assign(new Error("SERVICE_ROLE_KEY ausente"), { status: 500 });
  const odd = Number(query.odd || 1.1);
  const liq = Math.round(Number(query.liqBrl || query.liq || 5000) * 100);
  const mins = Math.max(10, Number(query.minutes || 45));
  const startsAt = new Date(Date.now() + mins * 60_000).toISOString();
  const home = String(query.home || "ArbiShield Teste A");
  const away = String(query.away || "ArbiShield Teste B");
  // Um lado só: LAY (responsabilidade) ou BACK (stake) — nunca os dois no mesmo evento.
  const side =
    String(query.side || query.market_type || "LAY").trim().toUpperCase() ===
    "BACK"
      ? "BACK"
      : "LAY";
  const markets = [
    {
      id: randomUUID(),
      name: side === "BACK" ? "Back · Teste" : "Lay · Teste",
      odd,
      liquidity: liq,
      used_liquidity: 0,
      market_type: side,
    },
  ];
  const row = {
    home_team: home,
    away_team: away,
    league: "SANDBOX · Evento teste",
    starts_at: startsAt,
    status: "open",
    status_v2: "open",
    is_published: true,
    sport_type: "futebol",
    max_protection_cents: liq,
    used_protection_cents: 0,
    protection_odds: { home: odd, away: odd },
    external_id: `sandbox-test-${Date.now()}`,
    metadata: {
      source: "admin_manual",
      sandbox_test: true,
      billing_model_hint: "fee_upfront_v1",
      release_minutes_before: 0,
      test_side: side,
      calc_mode: side === "LAY" ? "responsabilidade" : "stake",
    },
    markets,
  };
  let created;
  try {
    created = await sb("/rest/v1/matches", {
      method: "POST",
      token: SERVICE_KEY,
      body: row,
    });
  } catch (err) {
    delete row.external_id;
    created = await sb("/rest/v1/matches", {
      method: "POST",
      token: SERVICE_KEY,
      body: row,
    });
  }
  const match = Array.isArray(created) ? created[0] : created;
  return {
    ok: true,
    matchId: match?.id,
    home_team: match?.home_team,
    away_team: match?.away_team,
    starts_at: match?.starts_at,
    odd,
    open: "https://arbishield.app/app-proteger.html",
  };
}

async function fetchBetbraInplayFeed() {
  return spaced(() =>
    betbra(INPLAY_FEED_URL, {
      Referer: `${SITE}/`,
    })
  );
}

/**
 * Feed índice do radar de movimento (campo 2D / Stats Perform).
 * Não traz coordenadas — só o mapa eventId exchange → Stats Perform.
 */
const RADAR_CACHE_TTL_MS = Number(
  process.env.BETBRA_EVENTS_RADAR_CACHE_MS || 5 * 60 * 1000
);
/** @type {Map<string, { at: number, feed: unknown, error: string|null }>} */
const eventsRadarCache = new Map();

async function fetchBetbraEventsRadar(siteOrUrl) {
  const url = siteOrUrl
    ? eventsRadarUrlForSite(siteOrUrl)
    : EVENTS_RADAR_URL;
  const host = resolveSoft2BetHost(siteOrUrl || SITE);
  return spaced(() =>
    betbra(url, {
      Referer: `https://${host}/`,
    })
  );
}

async function getEventsRadarFeedCached(siteOrUrl, { force = false } = {}) {
  const host = resolveSoft2BetHost(siteOrUrl || SITE);
  const cached = eventsRadarCache.get(host);
  const now = Date.now();
  if (
    !force &&
    cached &&
    cached.feed != null &&
    now - cached.at < RADAR_CACHE_TTL_MS
  ) {
    return { host, url: eventsRadarUrlForSite(host), feed: cached.feed, cached: true };
  }
  try {
    const feed = await fetchBetbraEventsRadar(host);
    eventsRadarCache.set(host, { at: now, feed, error: null });
    return { host, url: eventsRadarUrlForSite(host), feed, cached: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (cached?.feed != null) {
      return {
        host,
        url: eventsRadarUrlForSite(host),
        feed: cached.feed,
        cached: true,
        stale: true,
        warning: msg,
      };
    }
    eventsRadarCache.set(host, { at: now, feed: null, error: msg });
    throw err;
  }
}

async function probeBetbraEventsRadar(opts = {}) {
  const started = Date.now();
  const eventId = normalizeEventId(opts.eventId || "");
  const siteOrUrl = opts.link || opts.site || SITE;
  const host = resolveSoft2BetHost(siteOrUrl);
  const widgetBase = mradarWidgetBaseForSite(host);
  try {
    const pack = await getEventsRadarFeedCached(host, { force: !!opts.force });
    const summary = summarizeEventsRadarFeed(pack.feed);
    if (eventId) {
      const resolved = resolveMradarForEventId(eventId, pack.feed, host);
      return {
        ok: true,
        version: BETBRA_EVENTS_RADAR_VERSION,
        latencyMs: Date.now() - started,
        url: pack.url,
        host,
        mradarWidget: widgetBase,
        cached: Boolean(pack.cached),
        stale: Boolean(pack.stale),
        warning: pack.warning || null,
        feedCount: summary.count,
        ...resolved,
      };
    }
    const firstSp = summary.sample?.[0]?.eventIdStatsPerform || null;
    return {
      ok: true,
      version: BETBRA_EVENTS_RADAR_VERSION,
      latencyMs: Date.now() - started,
      url: pack.url,
      host,
      mradarWidget: widgetBase,
      mradarExample: buildMradarWidgetUrl(firstSp, widgetBase),
      cached: Boolean(pack.cached),
      stale: Boolean(pack.stale),
      warning: pack.warning || null,
      ...summary,
    };
  } catch (err) {
    return {
      ok: false,
      version: BETBRA_EVENTS_RADAR_VERSION,
      latencyMs: Date.now() - started,
      url: eventsRadarUrlForSite(host),
      host,
      mradarWidget: widgetBase,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Fallback: detalhe do evento mexchange pode trazer placar quando o feed
 * agregado inplay-info falha ou não lista o jogo.
 */
async function fetchBetbraEventInplayInfo(eventId) {
  const id = normalizeEventId(eventId);
  if (!id) return null;
  const sportIds = [
    SOCCER_ID,
    Number(process.env.MEXCHANGE_SOCCER_ID || 0) || null,
    15,
    1,
    13,
  ].filter((n, i, arr) => Number.isFinite(Number(n)) && arr.indexOf(n) === i);

  let detail = null;
  for (const sportId of sportIds) {
    try {
      const row = await spaced(() =>
        betbra(`${API_BASE}/events/${id}?sport-id=${sportId}`, {
          Referer: `${REFERER.replace(/\/$/, "")}/exchange/sport/soccer/event/${id}`,
          "Accept-Encoding": "identity",
        })
      );
      if (row && typeof row === "object") {
        detail = row;
        break;
      }
    } catch {
      /* tenta próximo sport-id */
    }
  }
  if (!detail || typeof detail !== "object") return null;

  const scoreObj =
    detail.score && typeof detail.score === "object"
      ? detail.score
      : detail["match-score"] && typeof detail["match-score"] === "object"
        ? detail["match-score"]
        : {
            home: {
              score:
                detail.homeScore ??
                detail["home-score"] ??
                detail.home_score ??
                detail.homeGoals ??
                null,
            },
            away: {
              score:
                detail.awayScore ??
                detail["away-score"] ??
                detail.away_score ??
                detail.awayGoals ??
                null,
            },
          };
  const liveFlag = Boolean(
    detail["in-running-flag"] ||
      detail.inRunning ||
      detail.in_running ||
      /in[\s_-]?play|live/i.test(String(detail.status || "")) ||
      /in[\s_-]?play|live|half|ht|et/i.test(
        String(
          detail.inPlayMatchStatus ||
            detail["in-play-match-status"] ||
            detail.in_play_match_status ||
            ""
        )
      )
  );
  const info = normalizeInplayItem({
    eventId: String(detail.id || id),
    status: detail.status || (liveFlag ? "InPlay" : ""),
    inPlayMatchStatus:
      detail.inPlayMatchStatus ||
      detail["in-play-match-status"] ||
      detail.in_play_match_status ||
      "",
    elapsedRegularTime:
      detail.elapsedRegularTime ||
      detail["elapsed-regular-time"] ||
      detail.timeElapsed ||
      detail.elapsed ||
      detail.minute ||
      detail.clock ||
      detail.matchTime ||
      detail["match-time"] ||
      "",
    score: scoreObj,
    "in-running-flag": liveFlag,
    inRunning: liveFlag,
  });
  // Só devolve se tiver algo para mostrar (placar/minuto/live real)
  if (!info) return null;
  if (!info.finished && !info.scoreLabel && !info.elapsed && !info.live) {
    return null;
  }
  return info;
}

/**
 * Puxa inplay-info BetBra e atualiza placar/minuto nos matches elegíveis
 * e nas etapas de Desafio com link BetBra.
 * Não liquida automaticamente — settle continua manual.
 */
async function syncBetbraInplayScores({ force = false } = {}) {
  if (!SERVICE_KEY && !force) {
    return { ok: false, error: "SERVICE_KEY ausente", updated: 0 };
  }
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  let rows = [];
  try {
    rows = await sb(
      "/rest/v1/matches?deleted_at=is.null&settled_at=is.null&select=id,external_id,starts_at,status,status_v2,final_score,settled_at,score_sync_enabled,metadata,markets,updated_at&order=starts_at.asc&limit=300",
      { token: SERVICE_KEY }
    );
  } catch {
    rows = await sb(
      "/rest/v1/matches?deleted_at=is.null&settled_at=is.null&select=id,external_id,starts_at,status,status_v2,final_score,settled_at,score_sync_enabled,metadata,updated_at&order=starts_at.asc&limit=300",
      { token: SERVICE_KEY }
    );
  }
  const candidates = (Array.isArray(rows) ? rows : []).filter((m) =>
    matchEligibleForInplaySync(m, nowMs)
  );

  const stepRows = await loadDesafioStepsForInplaySync();
  const stepCandidates = (Array.isArray(stepRows) ? stepRows : []).filter((s) =>
    desafioStepEligibleForInplaySync(s, nowMs)
  );

  if (!candidates.length && !stepCandidates.length) {
    return {
      ok: true,
      version: BETBRA_INPLAY_SYNC_VERSION,
      feedSize: 0,
      candidates: 0,
      stepCandidates: 0,
      stepRows: Array.isArray(stepRows) ? stepRows.length : 0,
      updated: 0,
      stepsUpdated: 0,
      skipped: 0,
      finishedSeen: 0,
    };
  }

  let feedRaw;
  let feedError = null;
  try {
    feedRaw = await fetchBetbraInplayFeed();
  } catch (err) {
    feedError = err instanceof Error ? err.message : String(err);
    feedRaw = [];
  }

  const byEvent = indexInplayFeed(feedRaw);

  // Fallback: busca placar por eventId (mexchange) quando o feed agregado falha/vazio
  const missingIds = new Set();
  for (const m of candidates) {
    const id = matchBetbraEventId(m);
    if (id && !byEvent.has(id)) missingIds.add(id);
  }
  for (const s of stepCandidates) {
    const id = desafioStepEventId(s);
    if (id && !byEvent.has(id)) missingIds.add(id);
  }
  let eventLookups = 0;
  for (const eventId of missingIds) {
    try {
      const info = await fetchBetbraEventInplayInfo(eventId);
      eventLookups += 1;
      if (info) byEvent.set(info.eventId, info);
    } catch {
      /* ignore */
    }
  }

  if (!byEvent.size && feedError) {
    return {
      ok: false,
      version: BETBRA_INPLAY_SYNC_VERSION,
      error: feedError,
      candidates: candidates.length,
      stepCandidates: stepCandidates.length,
      stepRows: Array.isArray(stepRows) ? stepRows.length : 0,
      eventLookups,
      updated: 0,
      stepsUpdated: 0,
    };
  }

  let updated = 0;
  let stepsUpdated = 0;
  let skipped = 0;
  let finishedSeen = 0;
  const samples = [];

  for (const match of candidates) {
    const built = buildMatchInplayPatch(match, byEvent, nowIso);
    if (!built) {
      skipped += 1;
      continue;
    }
    if (built.live && built.live.finished) finishedSeen += 1;
    try {
      await sb(`/rest/v1/matches?id=eq.${encodeURIComponent(match.id)}`, {
        method: "PATCH",
        token: SERVICE_KEY,
        body: built.patch,
      });
      updated += 1;
      if (samples.length < 8) {
        samples.push({
          kind: "match",
          id: match.id,
          external_id: match.external_id || matchBetbraEventId(match),
          score: built.live ? built.live.score : null,
          elapsed: built.live ? built.live.elapsed_label : null,
          finished: built.live ? built.live.finished : false,
          clearedStub: !built.live,
        });
      }
    } catch (err) {
      skipped += 1;
      console.warn(
        "[betbra-inplay-sync] patch falhou",
        match.id,
        err instanceof Error ? err.message : err
      );
    }
  }

  for (const step of stepCandidates) {
    const built = buildDesafioStepInplayPatch(step, byEvent, nowIso);
    if (!built) {
      skipped += 1;
      continue;
    }
    rememberDesafioStepLive(step.id, built.live);
    if (built.live.finished) finishedSeen += 1;
    // Preferir slimPatch: produção pode não ter coluna metadata em desafio_steps
    let wrote = false;
    try {
      await sb(`/rest/v1/desafio_steps?id=eq.${encodeURIComponent(step.id)}`, {
        method: "PATCH",
        token: SERVICE_KEY,
        body: built.slimPatch || {
          updated_at: nowIso,
          final_score_home: built.patch.final_score_home,
          final_score_away: built.patch.final_score_away,
          status: built.patch.status,
        },
      });
      wrote = true;
    } catch (err) {
      try {
        await sb(`/rest/v1/desafio_steps?id=eq.${encodeURIComponent(step.id)}`, {
          method: "PATCH",
          token: SERVICE_KEY,
          body: built.patch,
        });
        wrote = true;
      } catch (err2) {
        skipped += 1;
        console.warn(
          "[betbra-inplay-sync] desafio_step patch falhou",
          step.id,
          err2 instanceof Error ? err2.message : err2
        );
      }
    }
    if (wrote) {
      stepsUpdated += 1;
      if (samples.length < 10) {
        samples.push({
          kind: "desafio_step",
          id: step.id,
          score: built.live.score,
          elapsed: built.live.elapsed_label,
          finished: built.live.finished,
        });
      }
    }
  }

  return {
    ok: true,
    version: BETBRA_INPLAY_SYNC_VERSION,
    feedSize: byEvent.size,
    feedError,
    eventLookups,
    candidates: candidates.length,
    stepCandidates: stepCandidates.length,
    stepRows: Array.isArray(stepRows) ? stepRows.length : 0,
    updated,
    stepsUpdated,
    skipped,
    finishedSeen,
    samples,
    at: nowIso,
  };
}

const CLIENT_LIVE_WINDOW_MS = 9000 * 1000;

function matchHasClientLiquidity(m) {
  const markets = Array.isArray(m?.markets) ? m.markets : [];
  if (markets.length) {
    const left = markets.reduce((acc, mk) => {
      if (!mk) return acc;
      const max = Number(
        mk.liquidity ?? mk.max_cents ?? mk.max_protection_cents ?? 0
      );
      const used = Number(
        mk.used_liquidity ?? mk.used_cents ?? mk.used_protection_cents ?? 0
      );
      return acc + Math.max(0, max - used);
    }, 0);
    if (left > 0) return true;
  }
  const max = Number(m?.max_protection_cents || 0);
  const used = Number(m?.used_protection_cents || 0);
  return max > 0 && used < max;
}

function isAvailableForClientGrid(m, now = Date.now()) {
  if (!m || m.deleted_at || m.is_published !== true) return false;
  const start = new Date(m.starts_at).getTime();
  if (!Number.isFinite(start)) return false;
  if (start + CLIENT_LIVE_WINDOW_MS <= now) return false;
  const meta = m.metadata && typeof m.metadata === "object" ? m.metadata : {};
  if (meta.hide_from_site || meta.hidden) return false;
  const st = String(m.status_v2 || m.status || "open").toLowerCase();
  if (
    ["closed", "cancelled", "finished", "settled", "finalizado", "void"].includes(
      st
    )
  ) {
    return false;
  }
  const rel = Number(meta.release_minutes_before ?? 0) || 0;
  if (rel > 0 && now < start - rel * 60_000) return false;
  if (!matchHasClientLiquidity(m)) return false;
  return true;
}

let lastMatchesListLiveSyncMs = 0;

/**
 * Expõe eventId BetBra + metadata.live para a grade Proteger (tempo/placar/radar).
 * @param {any} match
 */
function enrichMatchForClientGrid(match) {
  if (!match) return match;
  const eventId = matchBetbraEventId(match);
  const prevMeta =
    match.metadata && typeof match.metadata === "object"
      ? { ...match.metadata }
      : {};
  if (eventId && !prevMeta.betbra_event_id) {
    prevMeta.betbra_event_id = eventId;
  }
  return {
    ...match,
    external_id: match.external_id || eventId || null,
    betbra_event_id: eventId || null,
    metadata: prevMeta,
  };
}

/**
 * Lista jogos da grade Proteger via service_role (não depende de RLS do cliente).
 */
async function listAvailableMatchesForClient() {
  if (!SERVICE_KEY) {
    return { ok: false, error: "SERVICE_KEY ausente", matches: [], total: 0 };
  }
  const now = Date.now();
  // Atualiza placar/minuto antes da grade (mesma ideia do Desafio).
  if (now - lastMatchesListLiveSyncMs > 12_000) {
    lastMatchesListLiveSyncMs = now;
    try {
      await Promise.race([
        syncBetbraInplayScores({ force: true }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("sync timeout")), 4500)
        ),
      ]);
    } catch (err) {
      console.warn(
        "[matches] sync inplay na listagem falhou",
        err instanceof Error ? err.message : err
      );
    }
  }
  const windowStart = new Date(now - CLIENT_LIVE_WINDOW_MS).toISOString();
  const select =
    "id,external_id,home_team,away_team,home_logo,away_logo,league,starts_at,status,status_v2,sport_type,is_published,markets,max_protection_cents,used_protection_cents,protection_odds,metadata,deleted_at";
  const rows = await sb(
    `/rest/v1/matches?deleted_at=is.null&is_published=eq.true&starts_at=gte.${encodeURIComponent(windowStart)}&select=${select}&order=starts_at.asc&limit=300`,
    { token: SERVICE_KEY }
  );
  const matches = (Array.isArray(rows) ? rows : [])
    .filter((m) => isAvailableForClientGrid(m, now))
    .map(enrichMatchForClientGrid);
  return {
    ok: true,
    matches,
    total: matches.length,
    windowStart,
    at: new Date(now).toISOString(),
    inplayVersion: BETBRA_INPLAY_SYNC_VERSION,
  };
}

/**
 * Finalizados / fora da janela (~3h) não podem ficar is_published=true.
 * Limpa lixo histórico e evita que a grade do cliente leia dezenas de mortos.
 */
async function unpublishExpiredPublishedMatches() {
  if (!SERVICE_KEY) {
    return { ok: false, error: "SERVICE_KEY ausente", unpublished: 0 };
  }
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const body = { is_published: false, updated_at: now };
  const queries = [
    `/rest/v1/matches?is_published=eq.true&settled_at=not.is.null`,
    `/rest/v1/matches?is_published=eq.true&status=in.(settled,finished,closed,cancelled,finalizado)`,
    `/rest/v1/matches?is_published=eq.true&status_v2=in.(settled,finished,closed,cancelled,finalizado)`,
    `/rest/v1/matches?is_published=eq.true&starts_at=lt.${encodeURIComponent(cutoff)}`,
  ];
  let unpublished = 0;
  const errors = [];
  for (const q of queries) {
    try {
      const rows = await sb(q, {
        method: "PATCH",
        token: SERVICE_KEY,
        body,
      });
      unpublished += Array.isArray(rows) ? rows.length : 0;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return {
    ok: errors.length < queries.length,
    unpublished,
    cutoff,
    errors: errors.slice(0, 3),
    at: now,
  };
}

let inplaySyncTimer = null;
let inplaySyncRunning = false;

function startBetbraInplaySyncLoop() {
  if (!INPLAY_SYNC_ENABLED) {
    console.log("[betbra-inplay-sync] desligado (BETBRA_INPLAY_SYNC_ENABLED=0)");
    return;
  }
  if (!SERVICE_KEY) {
    console.warn("[betbra-inplay-sync] sem SERVICE_KEY — loop não iniciado");
    return;
  }
  const tick = async () => {
    if (inplaySyncRunning) return;
    inplaySyncRunning = true;
    try {
      try {
        const clean = await unpublishExpiredPublishedMatches();
        if (clean.unpublished > 0) {
          console.log(
            `[unpublish-expired] unpublished=${clean.unpublished}`
          );
        }
      } catch (eClean) {
        console.warn(
          "[unpublish-expired] falhou",
          eClean instanceof Error ? eClean.message : eClean
        );
      }
      const result = await syncBetbraInplayScores();
      if (result.updated > 0 || result.error) {
        console.log(
          `[betbra-inplay-sync] updated=${result.updated} candidates=${result.candidates} feed=${result.feedSize || 0}` +
            (result.error ? ` err=${result.error}` : "")
        );
      }
    } catch (err) {
      console.warn(
        "[betbra-inplay-sync] tick falhou",
        err instanceof Error ? err.message : err
      );
    } finally {
      inplaySyncRunning = false;
    }
  };
  // primeiro tick após 8s (deixa o server subir)
  setTimeout(tick, 8000);
  inplaySyncTimer = setInterval(tick, Math.max(8000, INPLAY_SYNC_MS));
  if (typeof inplaySyncTimer.unref === "function") inplaySyncTimer.unref();
  console.log(
    `[betbra-inplay-sync] loop a cada ${Math.max(8000, INPLAY_SYNC_MS)}ms (${BETBRA_INPLAY_SYNC_VERSION})`
  );
}

async function handleApi(req, res) {
  if (req.method === "OPTIONS") return sendJson(res, 204, {});

  const url = new URL(req.url, "http://127.0.0.1");

  if (url.pathname === "/health") {
    return sendJson(res, 200, {
      ok: true,
      service: "arbishield-matches",
      fix: "protection-flow-contract-v1",
      protectionFlowLock: PROTECTION_FLOW_LOCK,
      inplaySync: BETBRA_INPLAY_SYNC_VERSION,
      inplaySyncEnabled: INPLAY_SYNC_ENABLED,
      env: process.env.ARBISHIELD_ENV || "production",
      listen: LISTEN,
      testEvent: "/api/arbishield/test-event",
      footballTeams: "/api/arbishield/football-teams",
      matchLiveSync: "/api/arbishield/match-live-sync",
      betbraEventsRadar: "/api/arbishield/betbra-events-radar",
      unpublishExpired: "/api/arbishield/unpublish-expired",
      eventsRadar: BETBRA_EVENTS_RADAR_VERSION,
    });
  }

  if (
    (url.pathname === "/api/arbishield/test-event" ||
      url.pathname === "/test-event") &&
    (req.method === "POST" || req.method === "GET")
  ) {
    try {
      const q = Object.fromEntries(url.searchParams.entries());
      if (req.method === "POST") {
        try {
          Object.assign(q, await parseBody(req));
        } catch {
          /* body vazio ok */
        }
      }
      const result = await launchTestEvent(q);
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, err.status || 500, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }


  if (
    (url.pathname === "/api/arbishield/football-teams" ||
      url.pathname === "/api/arbishield/football-teams/") &&
    req.method === "GET"
  ) {
    try {
      const q = String(
        url.searchParams.get("q") || url.searchParams.get("name") || ""
      ).trim();
      if (q.length < 2) {
        return sendJson(res, 200, {
          ok: true,
          teams: [],
          providers: [],
          hint: "Digite pelo menos 2 caracteres",
        });
      }
      const result = await searchFootballTeams(q);
      return sendJson(res, 200, { ok: true, query: q, ...result });
    } catch (err) {
      return sendJson(res, 500, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/desafios" && req.method === "GET") {
    try {
      const data = await listDesafios();
      return sendJson(res, 200, data);
    } catch (err) {
      return sendJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/desafios" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const token = bearerFromReq(req);
      const created = await createDesafio(body, token);
      return sendJson(res, 201, { ok: true, desafio: created });
    } catch (err) {
      return sendJson(res, err.status || 500, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
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

  if (
    (url.pathname === "/api/arbishield/match-live-sync" ||
      url.pathname === "/api/arbishield/match-score-sync") &&
    (req.method === "POST" || req.method === "GET")
  ) {
    try {
      const clean = await unpublishExpiredPublishedMatches().catch((e) => ({
        ok: false,
        unpublished: 0,
        error: e instanceof Error ? e.message : String(e),
      }));
      const result = await syncBetbraInplayScores({ force: true });
      return sendJson(res, result.ok ? 200 : 502, {
        ...result,
        unpublishExpired: clean,
      });
    } catch (err) {
      return sendJson(res, 500, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (
    (url.pathname === "/api/arbishield/betbra-events-radar" ||
      url.pathname === "/api/arbishield/betbra-movimento" ||
      url.pathname === "/api/arbishield/desafio-mradar") &&
    req.method === "GET"
  ) {
    try {
      const result = await probeBetbraEventsRadar({
        eventId:
          url.searchParams.get("eventId") ||
          url.searchParams.get("event_id") ||
          "",
        link:
          url.searchParams.get("link") ||
          url.searchParams.get("external") ||
          "",
        site: url.searchParams.get("site") || "",
        force:
          url.searchParams.get("force") === "1" ||
          url.searchParams.get("refresh") === "1",
      });
      return sendJson(res, result.ok ? 200 : 502, result);
    } catch (err) {
      return sendJson(res, 500, {
        ok: false,
        version: BETBRA_EVENTS_RADAR_VERSION,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (
    url.pathname === "/api/arbishield/unpublish-expired" &&
    (req.method === "POST" || req.method === "GET")
  ) {
    try {
      const result = await unpublishExpiredPublishedMatches();
      return sendJson(res, result.ok ? 200 : 502, result);
    } catch (err) {
      return sendJson(res, 500, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (
    url.pathname === "/api/arbishield/matches" &&
    req.method === "GET"
  ) {
    try {
      // Limpa finalizados publicados antes de listar (barato / idempotente).
      await unpublishExpiredPublishedMatches().catch(() => null);
      const result = await listAvailableMatchesForClient();
      return sendJson(res, result.ok ? 200 : 502, result);
    } catch (err) {
      return sendJson(res, 500, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        matches: [],
        total: 0,
      });
    }
  }

  if (
    (url.pathname === "/api/arbishield/available-matches" ||
      url.pathname === "/api/arbishield/matches/available") &&
    (req.method === "GET" || req.method === "POST")
  ) {
    try {
      await unpublishExpiredPublishedMatches().catch(() => null);
      const result = await listAvailableMatchesForClient();
      return sendJson(res, result.ok ? 200 : 502, result);
    } catch (err) {
      return sendJson(res, 500, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        matches: [],
        total: 0,
      });
    }
  }

  if (url.pathname === "/api/arbishield/matches" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const token = bearerFromReq(req);
      const looksLikeSettle =
        body.mode === "settle" ||
        body.action === "settle" ||
        Boolean(
          body.matchId &&
            body.outcome &&
            (body.finalScore ||
              body.final_score ||
              body.homeScore != null ||
              body.awayScore != null)
        );
      if (looksLikeSettle) {
        const result = await settleMatchFromBody(body, token);
        return sendJson(res, 200, result);
      }
      const manual =
        body.mode === "manual" ||
        Array.isArray(body.markets) ||
        (!body.marketId && (body.home_team || body.homeTeam));
      const result = manual
        ? await createManualMatch(body, token)
        : await createMatchFromMarket(body, token);
      return sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      const status = err.status === 409 ? 409 : err.status || 500;
      return sendJson(res, status, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/match-settle" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const token = bearerFromReq(req);
      const result = await settleMatchFromBody(body.data || body, token);
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, err.status || 400, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/protections" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const token = bearerFromReq(req);
      if (!token) {
        return sendJson(res, 401, { ok: false, error: "Não autorizado" });
      }
      const action = String(body.action || body.mode || "").toLowerCase();
      if (
        action === "contest_submit" ||
        action === "contestation_submit" ||
        action === "submit_contestation"
      ) {
        const result = await contestSubmit(body, token);
        return sendJson(res, 200, result);
      }
      if (
        action === "contest_cancel_auto" ||
        action === "cancel_auto" ||
        action === "cancel_protection" ||
        action === "client_cancel"
      ) {
        const result = await contestCancelAuto(body, token);
        return sendJson(res, 200, result);
      }
      if (
        action === "contest_list" ||
        action === "contestation_list" ||
        action === "list_contestations"
      ) {
        const rows = await contestList(token);
        return sendJson(res, 200, rows);
      }
      if (
        action === "contest_approve" ||
        action === "contestation_approve" ||
        action === "approve_contestation"
      ) {
        const result = await contestApprove(body, token);
        return sendJson(res, 200, result);
      }
      if (
        action === "contest_reject" ||
        action === "contestation_reject" ||
        action === "reject_contestation"
      ) {
        const result = await contestReject(body, token);
        return sendJson(res, 200, result);
      }
      const result = await createProtection(body, token);
      return sendJson(res, 200, result);
    } catch (err) {
      const status = err.status || 500;
      return sendJson(res, status, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Alias usado se o nginx ainda não tiver location = /protections
  if (url.pathname === "/api/arbishield/create-protection" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const token = bearerFromReq(req);
      if (!token) {
        return sendJson(res, 401, { ok: false, error: "Não autorizado" });
      }
      const result = await createProtection(body, token);
      return sendJson(res, 200, result);
    } catch (err) {
      const status = err.status || 500;
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
    console.log(`prelive-events (BetBra+manual) on http://${host}:${port}`);
    startBetbraInplaySyncLoop();
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
