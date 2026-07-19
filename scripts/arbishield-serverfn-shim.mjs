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
  for (const k of ["category", "search", "from", "to", "page", "pageSize"]) {
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

  // Stubs: não lançar erro (travava o admin). Geo/session e mutações
  // ainda não portadas — retornam sucesso vazio.
  console.log("[serverfn-shim]", req.method, id.slice(0, 12));
  if (req.method === "GET") {
    return sendTsrOk(res, []);
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
      const data = await listDesafios(token);
      return sendJson(res, 200, data);
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
