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

/** Melhor odd disponível: back → lay → last-matched (exchange pode só ter um lado). */
function runnerBestOdd(runner) {
  const prices = Array.isArray(runner?.prices)
    ? runner.prices
    : Array.isArray(runner?.Prices)
      ? runner.Prices
      : [];
  const backs = prices
    .filter((p) => priceSide(p) === "back")
    .map(priceDecimal)
    .filter((n) => n != null);
  if (backs.length) {
    return Number(Math.max(...backs).toFixed(3));
  }
  const lays = prices
    .filter((p) => priceSide(p) === "lay")
    .map(priceDecimal)
    .filter((n) => n != null);
  if (lays.length) {
    return Number(Math.min(...lays).toFixed(3));
  }
  const last = runner?.["last-matched-odds"] ?? runner?.lastMatchedOdds;
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

  const markets = (detail.markets || [])
    .map((market) => {
      const runners = (market.runners || [])
        .map((runner) => {
          runnersTotal += 1;
          const prices = runner.prices || runner.Prices || [];
          if (Array.isArray(prices) && prices.length) withPrices += 1;
          const odd = runnerBestOdd(runner);
          if (odd != null) withOdd += 1;
          return {
            runnerId: String(runner.id),
            name: runner.name || "—",
            odd,
          };
        })
        .filter((r) => r.name !== "—");
      if (!runners.length) return null;
      return {
        marketId: String(market.id),
        name: market.name || "Mercado",
        marketType: market["market-type"] || market.type,
        status: market.status,
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
    event,
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

  const liquidityCents = Number(body.liquidityCents ?? 200_000);
  const marketLabel = body.runnerName
    ? `${body.marketName} · ${body.runnerName}`
    : body.marketName;
  const marketUuid = randomUUID();
  // Escrita com service role (triggers/RLS); admin_id vem do JWT em created_by/updated_by
  const dbToken = SERVICE_KEY || token;
  const eventExternalId = String(body.eventId);
  const betbraMarketId = String(body.marketId);
  // Mesmo mercado BetBra (ex. placar exato) tem vários runners — chave por mercado+seleção
  const betbraSelectionKey = body.runnerId
    ? `${betbraMarketId}:${body.runnerId}`
    : betbraMarketId;

  const newMarket = {
    id: marketUuid,
    name: marketLabel,
    odd,
    liquidity: liquidityCents,
    display_liquidity: null,
    used_liquidity: 0,
    market_type: "LAY",
    external_id: betbraSelectionKey,
    betbra_market_id: betbraMarketId,
    betbra_runner_id: body.runnerId ? String(body.runnerId) : null,
  };

  const existingRows = await sb(
    `/rest/v1/matches?external_id=eq.${encodeURIComponent(eventExternalId)}&deleted_at=is.null&select=id,home_team,away_team,markets,max_protection_cents,used_protection_cents,is_published&limit=1`,
    { token: dbToken }
  );
  const existing = Array.isArray(existingRows) ? existingRows[0] : null;

  if (existing?.id) {
    const markets = Array.isArray(existing.markets) ? existing.markets : [];
    const dup = markets.find((m) => {
      const ext = String(m.external_id || "");
      const runner = String(m.betbra_runner_id || m.runner_id || "");
      // chave nova mercado:runner
      if (ext === betbraSelectionKey) return true;
      // legado: só marketId + mesmo runner
      if (
        body.runnerId &&
        (ext === betbraMarketId ||
          String(m.betbra_market_id || "") === betbraMarketId) &&
        runner === String(body.runnerId)
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

    const patchBody = {
      markets: nextMarkets,
      max_protection_cents: nextMax,
      updated_by: adminId,
      metadata: {
        external_bet_link: body.betbraLink,
        external_bet_name: "BetBra",
        external_bet_logo: "https://betbra.bet.br/favicon.ico",
        market_id: body.marketId,
        runner_id: body.runnerId || null,
        source: "betbra_prelive_catalog",
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
    score_sync_enabled: false,
    has_live_stream: false,
    created_by: adminId,
    updated_by: adminId,
    metadata: {
      external_bet_link: body.betbraLink,
      external_bet_name: "BetBra",
      external_bet_logo: "https://betbra.bet.br/favicon.ico",
      market_id: body.marketId,
      runner_id: body.runnerId || null,
      source: "betbra_prelive_catalog",
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
  const marketsSource =
    marketsIn.length > 0
      ? marketsIn
      : [
          {
            name: "Lay Casa",
            market_type: "LAY",
            odd: 2,
            liquidity_brl: 2000,
          },
        ];

  const markets = marketsSource.map((m, idx) => {
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
  const dbToken = SERVICE_KEY || token;

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
      hide_from_site: Boolean(body.hide_from_site ?? body.hideFromSite),
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
        "Já existe um jogo com este ID externo. Altere o ID da partida ou deixe em branco."
      );
      err2.status = 409;
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

async function listDesafios() {
  if (!SERVICE_KEY) {
    throw new Error("SERVICE_ROLE_KEY ausente no .env da VPS");
  }
  const rows = await sb(
    "/rest/v1/desafios?select=*,desafio_steps(*)&order=updated_at.desc"
  );
  return Array.isArray(rows) ? rows : [];
}

async function nextDesafioNumber() {
  const rows = await sb(
    "/rest/v1/desafios?select=number&order=number.desc&limit=1"
  );
  const cur =
    Array.isArray(rows) && rows[0]?.number != null ? Number(rows[0].number) : 0;
  return (Number.isFinite(cur) ? cur : 0) + 1;
}

function buildDesafioRow(body) {
  const isActive = Boolean(body.is_active);
  return {
    number: body.number != null ? Number(body.number) : undefined,
    title: body.title || "Desafio",
    subtitle: body.subtitle ?? null,
    total_steps: Number(body.total_steps) || (body.steps || []).length || 1,
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
    market_name: stepIn.market_name || stepIn.market_name_casa || null,
    market_name_casa: stepIn.market_name_casa || stepIn.market_name || null,
    market_name_arbishield: stepIn.market_name_arbishield || null,
    home_odd: stepIn.home_odd != null ? Number(stepIn.home_odd) : null,
    away_odd: stepIn.away_odd != null ? Number(stepIn.away_odd) : null,
    arbi_team_name: stepIn.arbi_team_name ?? null,
    arbi_team_logo_url: stepIn.arbi_team_logo_url ?? null,
    arbi_odd: stepIn.arbi_odd != null ? Number(stepIn.arbi_odd) : null,
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

async function createDesafio(body, token) {
  if (!SERVICE_KEY) throw new Error("SERVICE_ROLE_KEY ausente no .env da VPS");
  const auth = token || SERVICE_KEY;
  const stepIn = body.step || (body.steps && body.steps[0]) || {};
  const desafioRow = buildDesafioRow(body);
  if (desafioRow.number == null) {
    desafioRow.number = await nextDesafioNumber();
  }

  const created = await sb("/rest/v1/desafios", {
    method: "POST",
    token: auth,
    body: desafioRow,
  });
  const desafio = Array.isArray(created) ? created[0] : created;
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

async function settleMatchFromBody(body, token) {
  const adminId = await requireAdminToken(token);
  const matchId = String(body?.matchId || body?.id || "").trim();
  if (!matchId) throw new Error("matchId obrigatório");
  let outcome = String(body?.outcome || "").toLowerCase();
  if (outcome !== "arbishield" && outcome !== "exchange") {
    throw new Error("outcome inválido (use arbishield ou exchange)");
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

  // PATCH partida (sem status_v2 se a coluna não existir)
  const basePatch = {
    final_score: String(finalScore),
    settled_at: now,
    status: "settled",
    markets,
    updated_at: now,
  };
  try {
    await sb(`/rest/v1/matches?id=eq.${encodeURIComponent(matchId)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: { ...basePatch, status_v2: "settled" },
    });
  } catch {
    await sb(`/rest/v1/matches?id=eq.${encodeURIComponent(matchId)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: basePatch,
    });
  }

  const openFilter = "active,pending,review_odd";
  const [lays, backs] = await Promise.all([
    sb(
      `/rest/v1/protections?match_id=eq.${encodeURIComponent(matchId)}&status=in.(${openFilter})&select=*&limit=2000`,
      { token: SERVICE_KEY }
    ).catch(() => []),
    sb(
      `/rest/v1/back_protections?match_id=eq.${encodeURIComponent(matchId)}&status=in.(${openFilter})&select=*&limit=2000`,
      { token: SERVICE_KEY }
    ).catch(() => []),
  ]);

  const all = [
    ...(Array.isArray(lays) ? lays : []).map((r) => ({
      ...r,
      _table: "protections",
    })),
    ...(Array.isArray(backs) ? backs : []).map((r) => ({
      ...r,
      _table: "back_protections",
    })),
  ];

  let settledCount = 0;
  let refundedCents = 0;
  const wonArbi = outcome === "arbishield";
  const status = wonArbi ? "won_platform" : "won_exchange";

  for (const row of all) {
    const amount = nCents(row.responsibility_cents || row.amount_cents);
    if (row.user_id && amount > 0) {
      try {
        const prof = await sb(
          `/rest/v1/profiles?select=balance_cents,locked_balance_cents&id=eq.${encodeURIComponent(row.user_id)}&limit=1`,
          { token: SERVICE_KEY }
        );
        const p = Array.isArray(prof) ? prof[0] : null;
        if (p) {
          const locked = Math.max(0, nCents(p.locked_balance_cents) - amount);
          const balance = wonArbi
            ? nCents(p.balance_cents) + amount
            : nCents(p.balance_cents);
          await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(row.user_id)}`, {
            method: "PATCH",
            token: SERVICE_KEY,
            body: {
              balance_cents: balance,
              locked_balance_cents: locked,
              updated_at: now,
            },
          });
          if (wonArbi) refundedCents += amount;
        }
      } catch {
        /* saldo best-effort */
      }
    }

    const protBody = {
      status,
      settled_at: now,
      updated_at: now,
    };
    // campos opcionais — tenta com settled_outcome; se falhar, só status
    try {
      await sb(`/rest/v1/${row._table}?id=eq.${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        token: SERVICE_KEY,
        body: {
          ...protBody,
          settled_outcome: outcome,
          result: status,
        },
      });
    } catch {
      await sb(`/rest/v1/${row._table}?id=eq.${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        token: SERVICE_KEY,
        body: protBody,
      });
    }
    settledCount += 1;
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
        details: { outcome, finalScore, settledCount, refundedCents },
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

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

/** LAY: amount = responsabilidade (espelha SPA SQe) */
function calcLay(amountCents, odd, lockRatio = 0.9073) {
  const responsibilityCents =
    Number.isFinite(amountCents) && amountCents > 0 ? Math.floor(amountCents) : 0;
  const o = Number.isFinite(odd) && odd > 1.01 ? odd : 1.01;
  const ratio =
    Number.isFinite(lockRatio) && lockRatio >= 0 && lockRatio <= 1
      ? lockRatio
      : 0.9073;
  const stakeRealCents = Math.round(responsibilityCents / (o - 1));
  const lockedDeductionCents = Math.round(stakeRealCents * ratio);
  const exchangeProfitGrossCents = stakeRealCents;
  const exchangeFeeCents = Math.round(exchangeProfitGrossCents * 0.045);
  const exchangeProfitNetCents = exchangeProfitGrossCents - exchangeFeeCents;
  const userProfitCents = Math.round(responsibilityCents * 0.015);
  const arbiShieldDeductionCents = exchangeProfitNetCents - userProfitCents;
  return {
    responsibilityCents,
    odd: o,
    stakeRealCents,
    lockedDeductionCents,
    exchangeFeeCents,
    exchangeProfitNetCents,
    userProfitCents,
    arbiShieldDeductionCents,
  };
}

/** BACK: amount = cobertura (espelha SPA _Qe) */
function calcBack(amountCents, odd) {
  const coverage =
    Number.isFinite(amountCents) && amountCents > 0 ? Math.floor(amountCents) : 0;
  const o = Number.isFinite(odd) && odd >= 1.01 ? odd : 1.01;
  const grossReturnCents = Math.round(coverage * o);
  const grossProfitCents = Math.max(0, grossReturnCents - coverage);
  const exchangeFeeCents = Math.round(grossProfitCents * 0.045);
  const netProfitExchangeCents = grossProfitCents - exchangeFeeCents;
  const userProfitCents = Math.round(coverage * 0.015);
  const arbiShieldDeductionCents = netProfitExchangeCents - userProfitCents;
  return {
    coverageCents: coverage,
    odd: o,
    grossReturnCents,
    grossProfitCents,
    exchangeFeeCents,
    netProfitExchangeCents,
    userProfitCents,
    arbiShieldDeductionCents,
  };
}

async function createProtection(body, userToken) {
  if (!SERVICE_KEY) throw new Error("SERVICE_ROLE_KEY ausente no .env da VPS");
  const payload = decodeJwtPayload(userToken);
  const userId = payload?.sub;
  if (!userId) {
    const err = new Error("Não autorizado");
    err.status = 401;
    throw err;
  }

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
  if (match.starts_at && new Date(match.starts_at).getTime() <= Date.now()) {
    const err = new Error(
      "Jogo já iniciado. Não é possível criar novas proteções."
    );
    err.status = 400;
    throw err;
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

  const profileRows = await sb(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,balance_cents,reusable_balance_cents,demo_balance_cents,investor_balance_cents,account_status,locked_balance_cents&limit=1`,
    { token: SERVICE_KEY }
  );
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

  let available = 0;
  if (balanceType === "DEMO") available = n(profile.demo_balance_cents);
  else if (balanceType === "INVESTOR")
    available = n(profile.investor_balance_cents);
  else
    available = n(profile.balance_cents) + n(profile.reusable_balance_cents);

  if (amountCents > available) {
    const err = new Error("Saldo insuficiente");
    err.status = 400;
    throw err;
  }

  const balanceBefore = available;
  const patch = {
    locked_balance_cents: n(profile.locked_balance_cents) + amountCents,
    updated_at: new Date().toISOString(),
  };
  let balanceAfter = 0;

  if (balanceType === "DEMO") {
    patch.demo_balance_cents = n(profile.demo_balance_cents) - amountCents;
    balanceAfter = patch.demo_balance_cents;
  } else if (balanceType === "INVESTOR") {
    patch.investor_balance_cents =
      n(profile.investor_balance_cents) - amountCents;
    balanceAfter = patch.investor_balance_cents;
  } else {
    const bal = n(profile.balance_cents);
    const reusable = n(profile.reusable_balance_cents);
    if (bal >= amountCents) {
      patch.balance_cents = bal - amountCents;
      balanceAfter = bal - amountCents + reusable;
    } else {
      patch.balance_cents = 0;
      patch.reusable_balance_cents = reusable - (amountCents - bal);
      balanceAfter = patch.reusable_balance_cents;
    }
  }

  await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH",
    token: SERVICE_KEY,
    body: patch,
  });

  // Trigger de integridade exige wallet_transactions (débito) ANTES do INSERT
  // da proteção — UUID pré-gerado liga ledger ↔ proteção.
  const protectionId = randomUUID();
  let walletTxId = null;

  const restoreProfile = async () => {
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
  };

  const deleteWalletTx = async () => {
    if (!walletTxId) return;
    await sb(
      `/rest/v1/wallet_transactions?id=eq.${encodeURIComponent(walletTxId)}`,
      { method: "DELETE", token: SERVICE_KEY }
    ).catch(() => {});
  };

  try {
    const walletInserted = await sb("/rest/v1/wallet_transactions", {
      method: "POST",
      token: SERVICE_KEY,
      body: {
        user_id: userId,
        type: "protection_lock",
        // Débito no ledger (centavos negativos) — mesmo padrão de transferências
        amount_cents: -amountCents,
        balance_before_cents: balanceBefore,
        balance_after_cents: balanceAfter,
        ref: protectionId,
        metadata: {
          protection_id: protectionId,
          match_id: matchId,
          market_type: marketType,
          balance_type: balanceType,
        },
      },
    });
    walletTxId = Array.isArray(walletInserted)
      ? walletInserted[0]?.id
      : walletInserted?.id;
    if (!walletTxId) throw new Error("Falha ao registrar débito no saldo");
  } catch (err) {
    await restoreProfile();
    throw err;
  }

  const meta = {
    ...(body.metadata && typeof body.metadata === "object" ? body.metadata : {}),
    market_id: market?.id || marketId || null,
    market_name: market?.name || null,
    market_type: marketType,
    market_odd: market?.odd ?? odd,
    source: "v2_create_protection",
  };

  try {
    if (marketType === "BACK") {
      const c = calcBack(amountCents, odd);
      await sb("/rest/v1/back_protections", {
        method: "POST",
        token: SERVICE_KEY,
        body: {
          id: protectionId,
          user_id: userId,
          match_id: matchId,
          odd: c.odd,
          status: "active",
          amount_cents: c.coverageCents,
          user_profit_cents: c.userProfitCents,
          platform_deduction_cents: c.arbiShieldDeductionCents,
          balance_before_cents: balanceBefore,
          balance_after_cents: balanceAfter,
          metadata: {
            ...meta,
            exchange_fee_cents: c.exchangeFeeCents,
            calculations: c,
            balance_type: balanceType,
          },
        },
      });
    } else {
      const c = calcLay(amountCents, odd);
      await sb("/rest/v1/protections", {
        method: "POST",
        token: SERVICE_KEY,
        body: {
          id: protectionId,
          user_id: userId,
          match_id: matchId,
          side,
          odd: c.odd,
          status: "active",
          amount_cents: c.responsibilityCents,
          responsibility_cents: c.responsibilityCents,
          user_profit_cents: c.userProfitCents,
          platform_deduction_cents: c.arbiShieldDeductionCents,
          platform_profit_cents: c.arbiShieldDeductionCents,
          locked_deduction_cents: c.lockedDeductionCents,
          exchange_fee_cents: c.exchangeFeeCents,
          exchange_profit_net_cents: c.exchangeProfitNetCents,
          balance_before_cents: balanceBefore,
          balance_after_cents: balanceAfter,
          metadata: {
            ...meta,
            balance_type: balanceType,
          },
        },
      });
    }
  } catch (err) {
    await deleteWalletTx();
    await restoreProfile();
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

  try {
    await sb(`/rest/v1/matches?id=eq.${encodeURIComponent(matchId)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: {
        markets,
        used_protection_cents: usedMatch + amountCents,
        updated_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    // Proteção + ledger já gravados; falha no match não deve orfanar saldo.
    console.warn("[createProtection] match update:", err.message || err);
  }

  return {
    ok: true,
    protectionId,
    marketType,
    amountCents,
    balanceAfterCents: balanceAfter,
  };
}

async function handleApi(req, res) {
  if (req.method === "OPTIONS") return sendJson(res, 204, {});

  const url = new URL(req.url, "http://127.0.0.1");

  if (url.pathname === "/health") {
    return sendJson(res, 200, { ok: true, service: "prelive-events" });
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
    console.log(`prelive-events on http://${host}:${port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
