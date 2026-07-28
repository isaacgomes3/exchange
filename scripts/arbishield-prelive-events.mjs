#!/usr/bin/env node
/**
 * Serviço ArbiShield (VPS): matches manuais, settle e proteções.
 * Catálogo/API BetBra removidos — lançamento só via modo manual.
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

function isTerminalProtectionStatus(st) {
  const s = String(st || "").toLowerCase();
  return (
    !s ||
    s === "cancelled" ||
    s === "settled" ||
    s === "closed" ||
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

function settlementDeductionCents(row) {
  const raw =
    row.platform_deduction_cents != null
      ? row.platform_deduction_cents
      : row.locked_deduction_cents;
  return Math.max(0, nCents(raw));
}

function settlementCreditCents(row, outcome) {
  const amount = nCents(row.responsibility_cents || row.amount_cents);
  if (amount <= 0) return 0;
  const wonArbi = String(outcome).toLowerCase() === "arbishield";
  // Legado:
  // - ArbiShield: devolve stake inteiro (cobertura)
  // - Exchange: devolve stake − taxa/dedução da plataforma
  if (wonArbi) return amount;
  const fee = Math.min(settlementDeductionCents(row), amount);
  return Math.max(0, amount - fee);
}

function settlementStatusForOutcome(outcome) {
  // lost_exchange = cobertura ArbiShield (UI: "ArbiShield", capital reutilizável)
  // won_exchange = bateu na casa externa (UI: "Exchange")
  return String(outcome).toLowerCase() === "arbishield"
    ? "lost_exchange"
    : "won_exchange";
}

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
  const credit = settlementCreditCents(row, outcome);
  const wonArbi = String(outcome).toLowerCase() === "arbishield";
  if (!row.user_id || amount <= 0) {
    return { refunded: 0, credited: 0, skipped: true };
  }
  if (await protectionAlreadyCredited(row.id)) {
    return { refunded: 0, credited: 0, alreadyCredited: true };
  }

  const prof = await sb(
    `/rest/v1/profiles?select=balance_cents,reusable_balance_cents,locked_balance_cents&id=eq.${encodeURIComponent(row.user_id)}&limit=1`,
    { token: SERVICE_KEY }
  );
  const p = Array.isArray(prof) ? prof[0] : null;
  if (!p) throw new Error(`Perfil ${row.user_id} não encontrado para crédito`);

  const locked = Math.max(0, nCents(p.locked_balance_cents) - amount);
  // Sempre saldo real (balance_cents): ArbiShield devolve stake integral;
  // Exchange devolve stake − taxa. Antes ArbiShield ia para reusable e o
  // cliente não via reembolso imediato no saldo Apostador/carteira.
  const patch = {
    locked_balance_cents: locked,
    balance_cents: nCents(p.balance_cents) + credit,
  };

  let creditedOk = false;
  let lastErr = null;
  for (const body of [{ ...patch, updated_at: now }, patch]) {
    try {
      await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(row.user_id)}`, {
        method: "PATCH",
        token: SERVICE_KEY,
        body,
      });
      creditedOk = true;
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
          stake_cents: amount,
          fee_cents: wonArbi ? 0 : settlementDeductionCents(row),
          bucket: "balance_cents",
          fix: "settle-arbishield-saldo-real-v1",
        },
      },
    });
  } catch (e) {
    console.warn(
      "[settle] wallet_transactions:",
      e instanceof Error ? e.message : e
    );
  }

  return { refunded: credit, credited: credit };
}

async function settleOneProtectionRow(row, outcome, now) {
  const wonArbi = String(outcome).toLowerCase() === "arbishield";
  const status = settlementStatusForOutcome(outcome);
  const amount = nCents(row.responsibility_cents || row.amount_cents);

  // Crédito OBRIGATÓRIO antes de marcar a proteção (não engolir erro de saldo)
  const creditResult = await creditWalletForSettlement(row, outcome, now);
  const refunded = creditResult.refunded || 0;

  // Schema VPS: protections NÃO tem updated_at — nunca incluir no PATCH.
  // NÃO usar fallback status:"settled" (UI cliente mostra como EXCHANGE).
  const attempts = [
    { status, settled_at: now, settled_outcome: outcome, result: status },
    { status, settled_at: now, settled_outcome: outcome },
    { status, settled_at: now, result: status },
    { status, settled_at: now },
  ];
  if (wonArbi) {
    // fallback se lost_exchange não existir no enum do banco
    attempts.push(
      {
        status: "won_platform",
        settled_at: now,
        settled_outcome: outcome,
        result: "lost_exchange",
      },
      { status: "won_platform", settled_at: now, settled_outcome: outcome }
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

  // Só agora marca a partida (evita o trigger de proteções ativas)
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await sb(`/rest/v1/matches?id=eq.${encodeURIComponent(matchId)}`, {
        method: "PATCH",
        token: SERVICE_KEY,
        body: basePatch,
      });
    } catch (err2) {
      const msg2 = err2 instanceof Error ? err2.message : String(err2);
      if (/bloqueado|ativas|liquidação oficial|liquidacao oficial/i.test(msg2 + msg)) {
        const again = await countOpenProtections(matchId);
        throw Object.assign(
          new Error(
            `Encerramento ainda bloqueado pelo banco (${again.lay} LAY / ${again.back} BACK). Proteções liquidadas nesta rodada: ${settledCount}.`
          ),
          { status: 409 }
        );
      }
      throw err2;
    }
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
          fix: "sem-betbra-api-v1",
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
    fix: "sem-betbra-api-v1",
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
    (marketId && markets.find((m) => String(m.id) === marketId)) || null;

  const marketType =
    body.marketType === "BACK" || body.marketType === "LAY"
      ? body.marketType
      : String(market?.market_type || "").toUpperCase() === "BACK"
        ? "BACK"
        : "LAY";

  if (!market) {
    market =
      markets.find(
        (m) => String(m.market_type || "").toUpperCase() === marketType
      ) || null;
  }

  // back-market-id-v1: BACK exige market_id NOT NULL — garante id e persiste se faltava
  // Não use um mercado de outro tipo como fallback: isso vincularia uma BACK
  // ao market_id de uma LAY.
  if (marketType === "BACK" && market && !market.id) {
    market.id = randomUUID();
    const idx = markets.findIndex(
      (m) =>
        m === market ||
        (m.name === market.name &&
          String(m.market_type || "").toUpperCase() ===
            String(market.market_type || "").toUpperCase())
    );
    if (idx >= 0) markets[idx] = { ...markets[idx], id: market.id };
    try {
      await sb(`/rest/v1/matches?id=eq.${encodeURIComponent(matchId)}`, {
        method: "PATCH",
        token: SERVICE_KEY,
        body: { markets, updated_at: new Date().toISOString() },
      });
    } catch (e) {
      console.warn("[createProtection] patch market id:", e.message || e);
    }
  }

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
    // Política: sem carteira reutilizável — consolida e debita só balance_cents
    const bal = n(profile.balance_cents) + n(profile.reusable_balance_cents);
    patch.balance_cents = bal - amountCents;
    patch.reusable_balance_cents = 0;
    balanceAfter = bal - amountCents;
  }

  await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH",
    token: SERVICE_KEY,
    body: patch,
  });

  const meta = {
    ...(body.metadata && typeof body.metadata === "object" ? body.metadata : {}),
    market_id: market?.id || marketId || null,
    market_name: market?.name || null,
    market_type: marketType,
    market_odd: market?.odd ?? odd,
    source: "v2_create_protection",
  };

  let protectionId = "";
  try {
    if (marketType === "BACK") {
      const c = calcBack(amountCents, odd);
      const resolvedMarketId = market?.id || marketId || null;
      if (!resolvedMarketId) {
        const err = new Error(
          "Mercado BACK sem id. Relance o jogo com o mercado ou atualize o match."
        );
        err.status = 400;
        throw err;
      }
      const inserted = await sb("/rest/v1/back_protections", {
        method: "POST",
        token: SERVICE_KEY,
        body: {
          user_id: userId,
          match_id: matchId,
          market_id: resolvedMarketId,
          odd: c.odd,
          status: "active",
          amount_cents: c.coverageCents,
          user_profit_cents: c.userProfitCents,
          platform_deduction_cents: c.arbiShieldDeductionCents,
          balance_before_cents: balanceBefore,
          balance_after_cents: balanceAfter,
          metadata: {
            ...meta,
            market_id: resolvedMarketId,
            exchange_fee_cents: c.exchangeFeeCents,
            calculations: c,
            balance_type: balanceType,
          },
        },
      });
      protectionId = Array.isArray(inserted) ? inserted[0]?.id : inserted?.id;
    } else {
      const c = calcLay(amountCents, odd);
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
      type: marketType === "BACK" ? "protection_lock" : "anchor_lock",
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
  }).catch((e) => {
    console.warn("[createProtection] wallet_transactions:", e.message || e);
  });

  return {
    ok: true,
    protectionId,
    marketType,
    amountCents,
    balanceAfterCents: balanceAfter,
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

/** Estorno integral + status cancelled (service role) — IDEMPOTENTE. */
async function refundAndCancelProtection(table, row, audit = {}) {
  const protectionId = row.id;
  const amount = n(row.responsibility_cents || row.amount_cents);
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
  prevMeta.auto_cancel = {
    reason: audit.reason || null,
    cancelled_at: new Date().toISOString(),
    cancelled_by: audit.cancelled_by || null,
    auto: true,
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

  // 2) Credita só quem ganhou o claim
  if (userId && amount > 0) {
    const prof = await sb(
      `/rest/v1/profiles?select=balance_cents,locked_balance_cents&id=eq.${encodeURIComponent(userId)}&limit=1`,
      { token: SERVICE_KEY }
    );
    const p = Array.isArray(prof) ? prof[0] : null;
    if (p) {
      const patchFull = {
        balance_cents: n(p.balance_cents) + amount,
        locked_balance_cents: Math.max(0, n(p.locked_balance_cents) - amount),
        updated_at: new Date().toISOString(),
      };
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
  await restoreMatchLiquidity(row.match_id, amount, marketId);

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

async function handleApi(req, res) {
  if (req.method === "OPTIONS") return sendJson(res, 204, {});

  const url = new URL(req.url, "http://127.0.0.1");

  if (url.pathname === "/health") {
    return sendJson(res, 200, {
      ok: true,
      service: "arbishield-matches",
      fix: "sem-betbra-api-v1",
    });
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

  if (url.pathname === "/api/arbishield/prelive-events") {
    return sendJson(res, 410, {
      ok: false,
      error: "Catálogo BetBra removido. Use lançamento manual (mode=manual).",
    });
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
      if (!manual) {
        return sendJson(res, 410, {
          ok: false,
          error: "Lançamento via API BetBra removido. Use mode=manual.",
        });
      }
      const result = await createManualMatch(body, token);
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
    console.error("Use --serve (catálogo BetBra CLI removido).");
    process.exit(2);
  }

  const [host, portStr] = LISTEN.split(":");
  const port = Number(portStr || 3098);
  const server = createServer((req, res) => {
    handleApi(req, res).catch((err) => {
      sendJson(res, 500, { ok: false, error: String(err) });
    });
  });
  server.listen(port, host, () => {
    console.log(`arbishield-matches on http://${host}:${port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
