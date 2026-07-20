#!/usr/bin/env node
/**
 * Shim local para /_serverFn/* da ArbiShield na VPS (frontend estático).
 * Sem isso o nginx devolve index.html e a Gestão de Desafios fica no spinner.
 *
 * Env: ARBISHIELD_SUPABASE_URL, SERVICE_ROLE_KEY (ou ANON_KEY + Authorization do browser)
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let toJSON;
try {
  ({ toJSON } = require("seroval"));
} catch {
  toJSON = null;
}

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

const LISTEN = process.env.SERVERFN_LISTEN || "127.0.0.1:3101";
const SUPABASE_URL = (
  process.env.ARBISHIELD_SUPABASE_URL ||
  process.env.API_EXTERNAL_URL ||
  process.env.SUPABASE_PUBLIC_URL ||
  "http://127.0.0.1:8000"
).replace(/\/$/, "");
const SERVICE_KEY =
  process.env.ARBISHIELD_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.ANON_KEY || process.env.SUPABASE_ANON_KEY;

/** Hashes usados pelo frontend estático na VPS */
const FN = {
  LIST_DESAFIOS:
    "1bb9f049aba8148a459a513d34c0dfe014f33de5cd8cab3e3f6ec006f6f9e510",
  DASHBOARD_STATS:
    "8867aca1da470aaa83906b6b13bb7e7018c9dea355ae3cff430f0f97ddbb4a62",
  ADMIN_TX_FEED:
    "b8e5956ab4d19dcac2cf2318fe933b86f3eba19702cdd8ffb947c5b0bb1a3c68",
  /** admin.users: Promise.all([listUsers, isSuperAdmin]) */
  ADMIN_LIST_USERS:
    "fb16933f5d8f0788db13c8b74f3c53149e2989eeae483bd064ab7a9a15432c7a",
  ADMIN_IS_SUPER:
    "7522f63695242dffa7a9bd8ff11c911129bae721fcfbe52bc99240398508d149",
  /** App usuário — useDashboardData / useMyProfile / notifications */
  USER_MY_PROFILE:
    "0b9cedaa2cd8cfbb349649b17fbb90b7787010fd34877267a0cc05b0344fe963",
  USER_DASH_CRITICAL:
    "ab071cfb2fe9b23085f40d59daf5a3ae60da0b5bff9b5c52014742fc892fd3d7",
  USER_DASH_SECONDARY:
    "b8374a52968db3ecab37d916b7b4d5690cdd213df514104e2d8285786240cd29",
  USER_NOTIFICATIONS:
    "a7dd1971020b4c9784307d27a0d0453a2ab0c88a98414b556ad61ef25e275a50",
  USER_GEO_LOG:
    "2536c7837adaa096529fad853f0b0284e9e9ee6f8a90557a96d0ff98cede975d",
  UPSERT_DESAFIO:
    "ab2bcac276202b9ac1d2f136884f8c3a1f072f457032e6d2062cdfce05358fd1",
  DELETE_DESAFIO:
    "1c8b336e8819e53d0326cf2fe66ad5c1b03a3c3cbb7235ae67de5d8ab739a4c3",
};

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, apikey, x-tsr-serverFn, accept"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function sendJson(res, status, body) {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/** Codifica valores no formato Seroval/TSR que o client TanStack Start espera. */
function encVal(value, ids) {
  if (value === null || value === undefined) return { t: 2, s: 1 };
  if (typeof value === "string") return { t: 1, s: value };
  if (typeof value === "boolean") return { t: 3, s: value ? 1 : 0 };
  if (typeof value === "number") return { t: 0, s: value };
  if (Array.isArray(value)) {
    const i = ids.n++;
    return {
      t: 9,
      i,
      a: value.map((x) => encVal(x, ids)),
      o: 0,
    };
  }
  if (typeof value === "object") {
    const i = ids.n++;
    const k = Object.keys(value);
    return {
      t: 10,
      i,
      p: { k, v: k.map((key) => encVal(value[key], ids)) },
      o: 0,
    };
  }
  return { t: 1, s: String(value) };
}

/** Resposta de sucesso no protocolo TSR (sem isso o SPA trata data como undefined). */
function sendTsrOk(res, data) {
  cors(res);
  const payload = { result: data, error: null, context: {} };
  let body;
  if (typeof toJSON === "function") {
    // Client fromJSON espera o nó; toJSON envolve em { t, f, m }.
    const encoded = toJSON(payload);
    body = encoded && encoded.t ? encoded.t : encoded;
  } else {
    const ids = { n: 1 };
    const resultNode = encVal(data, ids);
    const contextNode = { t: 10, i: ids.n++, p: { k: [], v: [] }, o: 0 };
    body = {
      t: 10,
      i: 0,
      p: {
        k: ["result", "error", "context"],
        v: [resultNode, { t: 2, s: 1 }, contextNode],
      },
      o: 0,
    };
  }
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "x-tss-serialized": "true",
  });
  res.end(JSON.stringify(body));
}

function sendTsrError(res, message) {
  cors(res);
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "x-tss-serialized": "true",
  });
  res.end(
    JSON.stringify({
      t: 10,
      i: 0,
      p: {
        k: ["result", "error", "context"],
        v: [
          { t: 2, s: 1 },
          {
            t: 25,
            i: 1,
            s: { message: { t: 1, s: message } },
            c: "$TSR/Error",
          },
          { t: 10, i: 2, p: { k: [], v: [] }, o: 0 },
        ],
      },
      o: 0,
    })
  );
}

function bearerFromReq(req) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || null;
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function startOfDaySaoPaulo(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return new Date(
    `${get("year")}-${get("month")}-${get("day")}T00:00:00-03:00`
  );
}

async function sb(path, { token, method = "GET", body } = {}) {
  const key = token || SERVICE_KEY || ANON_KEY;
  if (!key) throw new Error("Sem chave Supabase configurada");
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
      text.slice(0, 200) ||
      res.statusText;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function listDesafios(token) {
  const rows = await sb(
    "/rest/v1/desafios?select=*,desafio_steps(*)&order=updated_at.desc",
    { token: token || SERVICE_KEY }
  );
  return Array.isArray(rows) ? rows : [];
}

async function nextDesafioNumber(token) {
  const rows = await sb(
    "/rest/v1/desafios?select=number&order=number.desc&limit=1",
    { token: token || SERVICE_KEY }
  );
  const n =
    Array.isArray(rows) && rows[0]?.number != null ? Number(rows[0].number) : 0;
  return (Number.isFinite(n) ? n : 0) + 1;
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

async function createDesafio(token, body) {
  const auth = token || SERVICE_KEY;
  const stepIn = body.step || (body.steps && body.steps[0]) || {};
  const desafioRow = buildDesafioRow(body);
  if (desafioRow.number == null) {
    desafioRow.number = await nextDesafioNumber(auth);
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

async function upsertDesafio(token, body) {
  const auth = token || SERVICE_KEY;
  if (!body?.id) return createDesafio(auth, body);

  const desafioRow = buildDesafioRow(body);
  delete desafioRow.number;
  await sb(`/rest/v1/desafios?id=eq.${encodeURIComponent(body.id)}`, {
    method: "PATCH",
    token: auth,
    body: desafioRow,
  });

  const stepsOut = [];
  for (const step of body.steps || []) {
    const stepRow = buildStepRow(body.id, step, desafioRow.is_active);
    if (step.id) {
      const { desafio_id: _d, ...patch } = stepRow;
      const updated = await sb(
        `/rest/v1/desafio_steps?id=eq.${encodeURIComponent(step.id)}`,
        { method: "PATCH", token: auth, body: patch }
      );
      stepsOut.push(Array.isArray(updated) ? updated[0] : updated);
    } else {
      const inserted = await sb("/rest/v1/desafio_steps", {
        method: "POST",
        token: auth,
        body: stepRow,
      });
      stepsOut.push(Array.isArray(inserted) ? inserted[0] : inserted);
    }
  }

  const rows = await sb(
    `/rest/v1/desafios?select=*,desafio_steps(*)&id=eq.${encodeURIComponent(body.id)}&limit=1`,
    { token: auth }
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : { id: body.id, desafio_steps: stepsOut };
}

async function deleteDesafio(token, body) {
  const auth = token || SERVICE_KEY;
  const id = body?.id;
  if (!id) throw new Error("id obrigatório");
  await sb(`/rest/v1/desafios?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    token: auth,
    body: { deleted_at: new Date().toISOString() },
  });
  return { ok: true };
}

function extractServerFnData(rawBody) {
  if (!rawBody) return {};
  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};
  if (parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data)) {
    // seroval às vezes embute; se vier plano, ok
    if (!("t" in parsed.data) || parsed.data.page != null || parsed.data.from != null) {
      return parsed.data;
    }
  }
  // fallback: procurar campos conhecidos na raiz
  const out = {};
  for (const k of [
    "category",
    "search",
    "from",
    "to",
    "page",
    "pageSize",
    "id",
    "number",
    "title",
    "subtitle",
    "total_steps",
    "initial_balance_cents",
    "is_active",
    "steps",
    "stepId",
    "winningSide",
  ]) {
    if (parsed[k] !== undefined) out[k] = parsed[k];
  }
  return out;
}

async function getDashboardStats() {
  const dayStart = startOfDaySaoPaulo();
  const dayIso = dayStart.toISOString();

  const [
    profiles,
    treasury,
    activeProtections,
    refunds,
    expensesAll,
    depositsTodayWallet,
    depositsTodayManual,
    depositsTodayAsaas,
    refundsToday,
    expensesToday,
    profits,
  ] = await Promise.all([
    sb(
      "/rest/v1/profiles?select=id,balance_cents,locked_balance_cents,investor_balance_cents"
    ),
    sb("/rest/v1/platform_treasury?select=operational_balance_cents,reserve_balance_cents,locked_balance_cents&limit=1"),
    sb(
      "/rest/v1/protections?select=amount_cents,platform_profit_cents,exchange_profit_net_cents,exchange_fee_cents&status=eq.active"
    ),
    sb("/rest/v1/refund_requests?select=amount_cents,status"),
    sb("/rest/v1/admin_expenses?select=amount_cents"),
    sb(
      `/rest/v1/wallet_transactions?select=amount_cents&type=eq.deposit&created_at=gte.${dayIso}`
    ),
    sb(
      `/rest/v1/manual_deposits?select=amount_cents&status=eq.APPROVED&created_at=gte.${dayIso}`
    ),
    sb(
      `/rest/v1/asaas_payments?select=amount_cents,confirmed_amount_cents,status&created_at=gte.${dayIso}`
    ),
    sb(`/rest/v1/refund_requests?select=amount_cents,status&updated_at=gte.${dayIso}`),
    sb(
      `/rest/v1/admin_expenses?select=amount_cents&expense_date=eq.${dayIso.slice(0, 10)}`
    ),
    sb(
      "/rest/v1/protections?select=platform_profit_cents,exchange_profit_net_cents,exchange_fee_cents"
    ),
  ]);

  const profileRows = Array.isArray(profiles) ? profiles : [];
  const totalUserBalance = profileRows.reduce((a, r) => a + n(r.balance_cents), 0);
  const totalUsers = profileRows.length;
  const totalInvestorBalance = profileRows.reduce(
    (a, r) => a + n(r.investor_balance_cents),
    0
  );
  const lockedFromProfiles = profileRows.reduce(
    (a, r) => a + n(r.locked_balance_cents),
    0
  );
  const activeRows = Array.isArray(activeProtections) ? activeProtections : [];
  const totalBlocked = activeRows.reduce((a, r) => a + n(r.amount_cents), 0) || lockedFromProfiles;

  const refundRows = Array.isArray(refunds) ? refunds : [];
  const paidStatuses = new Set([
    "CONCLUÍDO",
    "concluido",
    "CONCLUIDO",
    "paid",
    "PAID",
    "completed",
    "COMPLETED",
    "PIX ENVIADO",
  ]);
  const pendingStatuses = new Set([
    "EM ANÁLISE",
    "pending",
    "PENDING",
    "open",
    "OPEN",
    "processing",
    "PROCESSING",
  ]);
  const totalRefunded = refundRows
    .filter((r) => paidStatuses.has(String(r.status || "")))
    .reduce((a, r) => a + n(r.amount_cents), 0);
  const pendingRefunds = refundRows.filter((r) =>
    pendingStatuses.has(String(r.status || ""))
  ).length;

  const expenseTotal = (Array.isArray(expensesAll) ? expensesAll : []).reduce(
    (a, r) => a + n(r.amount_cents),
    0
  );
  const profitRows = Array.isArray(profits) ? profits : [];
  const platformProfit = profitRows.reduce(
    (a, r) =>
      a +
      n(r.platform_profit_cents) +
      n(r.exchange_profit_net_cents) +
      n(r.exchange_fee_cents),
    0
  );
  const realNetProfit = platformProfit - expenseTotal;
  const treasuryRow = Array.isArray(treasury) ? treasury[0] : null;
  const cashBalance =
    n(treasuryRow?.operational_balance_cents) ||
    Math.max(0, totalUserBalance + totalBlocked - totalRefunded);

  const asaasRows = Array.isArray(depositsTodayAsaas) ? depositsTodayAsaas : [];
  const asaasOk = new Set(["CONFIRMED", "RECEIVED", "confirmed", "received", "PAID", "paid"]);
  const todayAsaas = asaasRows
    .filter((r) => asaasOk.has(String(r.status || "")))
    .reduce((a, r) => a + n(r.confirmed_amount_cents || r.amount_cents), 0);
  const todayWallet = (Array.isArray(depositsTodayWallet) ? depositsTodayWallet : []).reduce(
    (a, r) => a + n(r.amount_cents),
    0
  );
  const todayManual = (Array.isArray(depositsTodayManual) ? depositsTodayManual : []).reduce(
    (a, r) => a + n(r.amount_cents),
    0
  );
  // wallet já inclui créditos de depósitos manuais aprovados — preferir o maior sinal
  const todayEarnings = Math.max(todayWallet, todayManual + todayAsaas);

  const todayRefundsOut = (Array.isArray(refundsToday) ? refundsToday : [])
    .filter((r) => paidStatuses.has(String(r.status || "")))
    .reduce((a, r) => a + n(r.amount_cents), 0);
  const todayExpenses = (Array.isArray(expensesToday) ? expensesToday : []).reduce(
    (a, r) => a + n(r.amount_cents),
    0
  );
  const todayNetRevenue = todayEarnings - todayRefundsOut;
  const todayRealProfit = todayNetRevenue - todayExpenses;
  // margem sobre a banca sob gestão (usuários + bloqueado)
  const marginBase = totalUserBalance + totalBlocked;
  const profitMargin =
    marginBase > 0 ? (realNetProfit / marginBase) * 100 : 0;

  return {
    totalUserBalance,
    totalUsers,
    totalInvestorBalance,
    realNetProfit,
    profitMargin: Number(profitMargin.toFixed(1)),
    totalBlocked,
    totalRefunded,
    pendingRefunds,
    cashBalance,
    todayEarnings,
    todayNetRevenue,
    todayRefundsOut,
    todayExpenses,
    todayRealProfit,
  };
}

function decodeJwtPayload(token) {
  try {
    const part = String(token || "").split(".")[1];
    if (!part) return null;
    const json = Buffer.from(
      part.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function listAuthUsersAdmin() {
  const key = SERVICE_KEY;
  if (!key) throw new Error("SERVICE_ROLE_KEY necessária para listar auth.users");
  const users = [];
  let page = 1;
  const perPage = 200;
  for (;;) {
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=${perPage}`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
      }
    );
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const msg =
        (data && data.message) || text.slice(0, 200) || res.statusText;
      throw new Error(msg);
    }
    const batch = Array.isArray(data?.users)
      ? data.users
      : Array.isArray(data)
        ? data
        : [];
    users.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
    if (page > 50) break;
  }
  return users;
}

async function listAdminUsers() {
  const [profiles, roles, authUsers] = await Promise.all([
    sb("/rest/v1/profiles?select=*&order=created_at.desc"),
    sb("/rest/v1/user_roles?select=user_id,role"),
    listAuthUsersAdmin(),
  ]);

  const profileRows = Array.isArray(profiles) ? profiles : [];
  const roleRows = Array.isArray(roles) ? roles : [];
  const rolesByUser = new Map();
  for (const r of roleRows) {
    if (!r?.user_id) continue;
    const list = rolesByUser.get(r.user_id) || [];
    list.push(r.role);
    rolesByUser.set(r.user_id, list);
  }

  const authById = new Map();
  for (const u of authUsers) {
    if (u?.id) authById.set(u.id, u);
  }

  return profileRows.map((p) => {
    const auth = authById.get(p.id) || {};
    const userRoles = rolesByUser.get(p.id) || [];
    const providerCents = n(p.demo_balance_provider_cents);
    return {
      ...p,
      email: auth.email || null,
      phone: p.phone || auth.phone || null,
      last_sign_in_at: auth.last_sign_in_at || null,
      // auth.created_at pode diferir do profile; UI usa profile.created_at
      roles: userRoles.length ? userRoles : ["user"],
      is_provider: providerCents > 0,
      balance_cents: n(p.balance_cents),
      demo_balance_cents: n(p.demo_balance_cents),
      demo_balance_provider_cents: providerCents,
      investor_balance_cents: n(p.investor_balance_cents),
      reusable_balance_cents: n(p.reusable_balance_cents),
      debited_balance_cents: n(p.debited_balance_cents),
      locked_balance_cents: n(p.locked_balance_cents),
      total_profit_cents: n(p.total_profit_cents),
      is_super_admin: !!p.is_super_admin,
      is_affiliate: !!p.is_affiliate,
      onboarding_completed: !!p.onboarding_completed,
    };
  });
}

async function currentUserIsSuperAdmin(token) {
  const payload = decodeJwtPayload(token);
  const uid = payload?.sub;
  if (!uid) return false;
  const rows = await sb(
    `/rest/v1/profiles?select=is_super_admin&id=eq.${uid}&limit=1`,
    { token: SERVICE_KEY }
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  return !!row?.is_super_admin;
}

function requireUserId(token) {
  const payload = decodeJwtPayload(token);
  const uid = payload?.sub;
  if (!uid) throw new Error("Não autorizado");
  return uid;
}

async function getUserProfileBundle(userId) {
  const dayIso = startOfDaySaoPaulo().toISOString();
  const [profiles, aff, protectedToday] = await Promise.all([
    sb(
      `/rest/v1/profiles?select=*&id=eq.${userId}&limit=1`,
      { token: SERVICE_KEY }
    ),
    sb(
      `/rest/v1/affiliate_stats?select=*&profile_id=eq.${userId}&limit=1`,
      { token: SERVICE_KEY }
    ).catch(() => []),
    sb(
      `/rest/v1/protections?select=amount_cents&user_id=eq.${userId}&created_at=gte.${dayIso}`,
      { token: SERVICE_KEY }
    ).catch(() => []),
  ]);
  const profile = Array.isArray(profiles) ? profiles[0] || null : null;
  const affiliateStats = Array.isArray(aff) ? aff[0] || null : null;
  const protectedTodayCents = (Array.isArray(protectedToday) ? protectedToday : []).reduce(
    (a, r) => a + n(r.amount_cents),
    0
  );
  return { profile, protectedTodayCents, affiliateStats };
}

async function getUserDashboardMetrics(userId) {
  const dayIso = startOfDaySaoPaulo().toISOString();
  const [active, settledToday] = await Promise.all([
    sb(
      `/rest/v1/protections?select=amount_cents&user_id=eq.${userId}&status=eq.active`,
      { token: SERVICE_KEY }
    ).catch(() => []),
    sb(
      `/rest/v1/protections?select=user_profit_cents,settled_at,status&user_id=eq.${userId}&settled_at=gte.${dayIso}`,
      { token: SERVICE_KEY }
    ).catch(() => []),
  ]);
  const activeProtectionCents = (Array.isArray(active) ? active : []).reduce(
    (a, r) => a + n(r.amount_cents),
    0
  );
  const todayEarningsCents = (Array.isArray(settledToday) ? settledToday : []).reduce(
    (a, r) => a + n(r.user_profit_cents),
    0
  );
  return { todayEarningsCents, activeProtectionCents };
}

async function getUserDashboardCritical(token) {
  const userId = requireUserId(token);
  const [profileBundle, metrics] = await Promise.all([
    getUserProfileBundle(userId),
    getUserDashboardMetrics(userId),
  ]);
  return { profile: profileBundle, metrics };
}

async function getUserDashboardSecondary(token) {
  const userId = requireUserId(token);
  const [protections, openMatches] = await Promise.all([
    sb(
      `/rest/v1/protections?select=*&user_id=eq.${userId}&order=created_at.desc&limit=200`,
      { token: SERVICE_KEY }
    ).catch(() => []),
    sb(`/rest/v1/matches?select=id&status=eq.open`, { token: SERVICE_KEY }).catch(
      () => []
    ),
  ]);
  const list = Array.isArray(protections) ? protections : [];
  const openCount = Array.isArray(openMatches) ? openMatches.length : 0;

  // pontos semanais (Seg–Dom) a partir de user_profit_cents settled
  const labels = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  const now = new Date();
  const weekStart = new Date(now);
  const day = weekStart.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  weekStart.setDate(weekStart.getDate() + diff);
  weekStart.setHours(0, 0, 0, 0);
  const points = [];
  for (let i = 0; i < 7; i++) {
    const start = new Date(weekStart);
    start.setDate(weekStart.getDate() + i);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    const value =
      list
        .filter((p) => {
          if (!p.settled_at) return false;
          const d = new Date(p.settled_at);
          return d >= start && d <= end;
        })
        .reduce((a, p) => a + n(p.user_profit_cents), 0) / 100;
    points.push({ name: labels[i], value });
  }
  const hasData = list.some((p) => p.settled_at);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  let monthProfit = 0;
  for (const p of list) {
    if (!p.settled_at) continue;
    if (!["lost_platform", "won_exchange", "settled"].includes(String(p.status || ""))) {
      continue;
    }
    if (new Date(p.settled_at) >= monthStart) monthProfit += n(p.user_profit_cents);
  }

  return {
    protections: list,
    newMarkets: { count: openCount },
    bankPerformance: {
      points,
      variationPct: hasData ? Number(((monthProfit / 100) || 0).toFixed(2)) : null,
      hasData,
    },
  };
}

async function getUserNotifications(token) {
  const userId = requireUserId(token);
  const rows = await sb(
    `/rest/v1/notifications?select=*&user_id=eq.${userId}&order=created_at.desc&limit=50`,
    { token: SERVICE_KEY }
  );
  return Array.isArray(rows) ? rows : [];
}

async function getProfileMap(userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;
  // PostgREST: in.(uuid,uuid)
  const chunkSize = 80;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const q = encodeURIComponent(`in.(${chunk.join(",")})`);
    const rows = await sb(`/rest/v1/profiles?select=id,full_name&id=${q}`);
    for (const r of Array.isArray(rows) ? rows : []) {
      map.set(r.id, r.full_name || null);
    }
  }
  return map;
}

async function getAdminTxFeed(params = {}) {
  const page = Math.max(1, n(params.page) || 1);
  const pageSize = Math.min(100, Math.max(1, n(params.pageSize) || 50));
  const from = params.from ? new Date(params.from) : startOfDaySaoPaulo();
  const to = params.to ? new Date(params.to) : new Date();
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const category = params.category || null;
  const search = (params.search || "").toString().trim().toLowerCase();

  const want = (cat) => !category || category === cat;

  const tasks = [];
  if (want("deposit") || !category) {
    tasks.push(
      sb(
        `/rest/v1/wallet_transactions?select=id,user_id,type,amount_cents,created_at,balance_after_cents,balance_before_cents,metadata,ref&type=eq.deposit&created_at=gte.${fromIso}&created_at=lte.${toIso}&order=created_at.desc&limit=200`
      ).then((rows) =>
        (Array.isArray(rows) ? rows : []).map((r) => ({
          id: `wt-${r.id}`,
          created_at: r.created_at,
          category: "deposit",
          type: r.type,
          user_id: r.user_id,
          amount_cents: Math.abs(n(r.amount_cents)),
          cash_flow: 1,
          status: "completed",
          balance_after_cents: r.balance_after_cents,
          balance_before_cents: r.balance_before_cents,
          description: r.ref || "Depósito",
          match_label: null,
        }))
      )
    );
    tasks.push(
      sb(
        `/rest/v1/manual_deposits?select=id,user_id,amount_cents,status,created_at,admin_notes&created_at=gte.${fromIso}&created_at=lte.${toIso}&order=created_at.desc&limit=200`
      ).then((rows) =>
        (Array.isArray(rows) ? rows : []).map((r) => ({
          id: `md-${r.id}`,
          created_at: r.created_at,
          category: "deposit",
          type: "manual_deposit",
          user_id: r.user_id,
          amount_cents: Math.abs(n(r.amount_cents)),
          cash_flow: String(r.status).toUpperCase() === "APPROVED" ? 1 : 0,
          status: r.status,
          balance_after_cents: null,
          balance_before_cents: null,
          description: r.admin_notes || "Depósito manual",
          match_label: null,
        }))
      )
    );
  }
  if (want("refund") || !category) {
    tasks.push(
      sb(
        `/rest/v1/refund_requests?select=id,user_id,amount_cents,status,created_at,admin_notes&created_at=gte.${fromIso}&created_at=lte.${toIso}&order=created_at.desc&limit=200`
      ).then((rows) =>
        (Array.isArray(rows) ? rows : []).map((r) => ({
          id: `rr-${r.id}`,
          created_at: r.created_at,
          category: "refund",
          type: "refund",
          user_id: r.user_id,
          amount_cents: Math.abs(n(r.amount_cents)),
          cash_flow: -1,
          status: r.status,
          balance_after_cents: null,
          balance_before_cents: null,
          description: r.admin_notes || "Reembolso",
          match_label: null,
        }))
      )
    );
  }
  if (want("expense") || !category) {
    tasks.push(
      sb(
        `/rest/v1/admin_expenses?select=id,amount_cents,category,description,expense_date,created_at&expense_date=gte.${fromIso.slice(0, 10)}&expense_date=lte.${toIso.slice(0, 10)}&order=expense_date.desc&limit=200`
      ).then((rows) =>
        (Array.isArray(rows) ? rows : []).map((r) => ({
          id: `ex-${r.id}`,
          created_at: r.created_at || `${r.expense_date}T12:00:00.000Z`,
          category: "expense",
          type: r.category || "expense",
          user_id: null,
          amount_cents: Math.abs(n(r.amount_cents)),
          cash_flow: -1,
          status: "completed",
          balance_after_cents: null,
          balance_before_cents: null,
          description: r.description || "Despesa",
          match_label: null,
        }))
      )
    );
  }
  if (want("wallet") || !category) {
    tasks.push(
      sb(
        `/rest/v1/protections?select=id,user_id,amount_cents,status,created_at,settled_at,platform_profit_cents,exchange_profit_net_cents,settled_outcome,balance_before_cents,balance_after_cents,match_id,side&created_at=gte.${fromIso}&created_at=lte.${toIso}&order=created_at.desc&limit=200`
      ).then((rows) =>
        (Array.isArray(rows) ? rows : []).map((r) => ({
          id: `pr-${r.id}`,
          created_at: r.settled_at || r.created_at,
          category: "wallet",
          type: "protection",
          user_id: r.user_id,
          amount_cents: Math.abs(n(r.amount_cents)),
          cash_flow: 0,
          status: r.status,
          balance_after_cents: r.balance_after_cents,
          balance_before_cents: r.balance_before_cents,
          description: `Proteção ${r.side || ""}`.trim(),
          match_label: r.match_id ? String(r.match_id).slice(0, 8) : null,
          platform_profit_cents: n(r.platform_profit_cents || r.exchange_profit_net_cents),
          settled_outcome: r.settled_outcome,
          is_exchange_settlement: n(r.exchange_profit_net_cents) > 0,
          gross_entry_cents: n(r.amount_cents),
        }))
      )
    );
  }
  if (want("withdraw") || !category) {
    tasks.push(
      sb(
        `/rest/v1/withdrawals?select=id,user_id,amount_cents,status,created_at&created_at=gte.${fromIso}&created_at=lte.${toIso}&order=created_at.desc&limit=200`
      )
        .then((rows) =>
          (Array.isArray(rows) ? rows : []).map((r) => ({
            id: `wd-${r.id}`,
            created_at: r.created_at,
            category: "withdraw",
            type: "withdraw",
            user_id: r.user_id,
            amount_cents: Math.abs(n(r.amount_cents)),
            cash_flow: -1,
            status: r.status,
            balance_after_cents: null,
            balance_before_cents: null,
            description: "Saque",
            match_label: null,
          }))
        )
        .catch(() => [])
    );
  }

  const chunks = await Promise.all(tasks);
  let items = chunks.flat();

  const profiles = await getProfileMap(items.map((i) => i.user_id));
  for (const it of items) {
    it.user_name = it.user_id ? profiles.get(it.user_id) || null : null;
    it.user_email = null;
  }

  if (search) {
    items = items.filter(
      (it) =>
        String(it.user_name || "")
          .toLowerCase()
          .includes(search) ||
        String(it.user_id || "")
          .toLowerCase()
          .includes(search) ||
        String(it.description || "")
          .toLowerCase()
          .includes(search) ||
        String(it.id || "")
          .toLowerCase()
          .includes(search)
    );
  }

  items.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const totalIn = items
    .filter((i) => i.cash_flow === 1)
    .reduce((a, i) => a + n(i.amount_cents), 0);
  const totalOut = items
    .filter((i) => i.cash_flow === -1)
    .reduce((a, i) => a + n(i.amount_cents), 0);
  const total = items.length;
  const start = (page - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  return {
    items: pageItems,
    total,
    kpis: {
      totalTransactions: total,
      totalIn,
      totalOut,
      net: totalIn - totalOut,
    },
  };
}

async function handleServerFn(req, res, id, rawBody = "") {
  const token = bearerFromReq(req);

  if (id === FN.LIST_DESAFIOS) {
    console.log("[serverfn-shim] LIST_DESAFIOS");
    try {
      const data = await listDesafios(token);
      return sendTsrOk(res, data);
    } catch (err) {
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.UPSERT_DESAFIO && req.method === "POST") {
    console.log("[serverfn-shim] UPSERT_DESAFIO");
    try {
      const params = extractServerFnData(rawBody);
      const data = await upsertDesafio(token, params);
      return sendTsrOk(res, data);
    } catch (err) {
      console.error("[serverfn-shim] UPSERT_DESAFIO error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.DELETE_DESAFIO && req.method === "POST") {
    console.log("[serverfn-shim] DELETE_DESAFIO");
    try {
      const params = extractServerFnData(rawBody);
      const data = await deleteDesafio(token, params);
      return sendTsrOk(res, data);
    } catch (err) {
      console.error("[serverfn-shim] DELETE_DESAFIO error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.DASHBOARD_STATS) {
    console.log("[serverfn-shim] DASHBOARD_STATS");
    try {
      // agregações com service role (RLS bloqueia anon)
      const data = await getDashboardStats();
      return sendTsrOk(res, data);
    } catch (err) {
      console.error("[serverfn-shim] DASHBOARD_STATS error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.ADMIN_TX_FEED) {
    console.log("[serverfn-shim] ADMIN_TX_FEED");
    try {
      const params = extractServerFnData(rawBody);
      const data = await getAdminTxFeed(params);
      return sendTsrOk(res, data);
    } catch (err) {
      console.error("[serverfn-shim] ADMIN_TX_FEED error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.ADMIN_LIST_USERS) {
    console.log("[serverfn-shim] ADMIN_LIST_USERS");
    try {
      const data = await listAdminUsers();
      return sendTsrOk(res, data);
    } catch (err) {
      console.error("[serverfn-shim] ADMIN_LIST_USERS error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.ADMIN_IS_SUPER) {
    console.log("[serverfn-shim] ADMIN_IS_SUPER");
    try {
      const data = await currentUserIsSuperAdmin(token);
      return sendTsrOk(res, data);
    } catch (err) {
      console.error("[serverfn-shim] ADMIN_IS_SUPER error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.USER_MY_PROFILE) {
    console.log("[serverfn-shim] USER_MY_PROFILE");
    try {
      const userId = requireUserId(token);
      const data = await getUserProfileBundle(userId);
      return sendTsrOk(res, data);
    } catch (err) {
      console.error("[serverfn-shim] USER_MY_PROFILE error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.USER_DASH_CRITICAL) {
    console.log("[serverfn-shim] USER_DASH_CRITICAL");
    try {
      const data = await getUserDashboardCritical(token);
      return sendTsrOk(res, data);
    } catch (err) {
      console.error("[serverfn-shim] USER_DASH_CRITICAL error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.USER_DASH_SECONDARY) {
    console.log("[serverfn-shim] USER_DASH_SECONDARY");
    try {
      const data = await getUserDashboardSecondary(token);
      return sendTsrOk(res, data);
    } catch (err) {
      console.error("[serverfn-shim] USER_DASH_SECONDARY error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.USER_NOTIFICATIONS) {
    console.log("[serverfn-shim] USER_NOTIFICATIONS");
    try {
      const data = await getUserNotifications(token);
      return sendTsrOk(res, data);
    } catch (err) {
      console.error("[serverfn-shim] USER_NOTIFICATIONS error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.USER_GEO_LOG) {
    console.log("[serverfn-shim] USER_GEO_LOG");
    // Aceita o log de geo sem persistir (evita retry infinito no SecurityMonitor)
    return sendTsrOk(res, { ok: true });
  }

  // Stubs: não lançar erro (travava o admin). Geo/session e mutações
  // ainda não portadas — retornam sucesso vazio.
  // IMPORTANTE: GET default = null (não []). [] corrompe cache do dashboard
  // (dash:critical / dash:secondary) porque [] é truthy e sem .profile.
  console.log("[serverfn-shim]", req.method, id.slice(0, 12));
  if (req.method === "GET") {
    return sendTsrOk(res, null);
  }
  return sendTsrOk(res, null);
}

function parseBody(req) {
  return new Promise((resolvePromise) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 2e6) req.destroy();
    });
    req.on("end", () => resolvePromise(data));
  });
}

const server = createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (url.pathname === "/api/arbishield/desafios") {
    try {
      const token = bearerFromReq(req);
      if (req.method === "GET") {
        const data = await listDesafios(token);
        return sendJson(res, 200, data);
      }
      if (req.method === "POST") {
        const raw = await parseBody(req);
        let body = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          return sendJson(res, 400, { error: "JSON inválido" });
        }
        const created = await createDesafio(token, body);
        return sendJson(res, 201, { ok: true, desafio: created });
      }
      return sendJson(res, 405, { error: "method_not_allowed" });
    } catch (err) {
      return sendJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/dashboard-stats") {
    try {
      const data = await getDashboardStats();
      return sendJson(res, 200, data);
    } catch (err) {
      return sendJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/health") {
    return sendJson(res, 200, { ok: true, service: "serverfn-shim" });
  }

  const m = url.pathname.match(/^\/_serverFn\/([a-f0-9]+)/i);
  if (!m) {
    res.writeHead(404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "not_found" }));
  }

  let rawBody = "";
  if (req.method === "POST") rawBody = await parseBody(req);

  try {
    await handleServerFn(req, res, m[1].toLowerCase(), rawBody);
  } catch (err) {
    sendTsrError(res, err instanceof Error ? err.message : String(err));
  }
});

const [host, portStr] = LISTEN.split(":");
server.listen(Number(portStr || 3101), host, () => {
  console.log(`serverfn-shim on http://${host}:${portStr || 3101}`);
});
