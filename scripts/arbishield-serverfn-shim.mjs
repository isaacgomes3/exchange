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

/** Contas permanentemente bloqueadas (login/API). */
const BLOCKED_EMAILS = new Set([
  "jefferson@arbishield.com",
  "jefferson@arbishield",
  "jeffersonboulevard@gmail.com",
  "jeffersojeffersonboulevard@gmail.com",
]);

/** Só estes e-mails acessam APIs da área Financeiro. */
const FINANCE_ADMIN_EMAILS = new Set([
  "isaacgomes3@gmail.com",
  "financeiro@arbishield.com",
]);

function isBlockedEmail(email) {
  const e = String(email || "")
    .trim()
    .toLowerCase();
  return !!e && BLOCKED_EMAILS.has(e);
}

function tokenEmail(token) {
  const payload = decodeJwtPayload(token);
  return String(
    payload?.email ||
      payload?.user_metadata?.email ||
      payload?.app_metadata?.email ||
      ""
  )
    .trim()
    .toLowerCase();
}

function canAccessFinance(email) {
  const e = String(email || "")
    .trim()
    .toLowerCase();
  return !!e && FINANCE_ADMIN_EMAILS.has(e);
}

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
  /** banners.functions — público + admin CRUD */
  BANNERS_PUBLIC_LIST:
    "cb53fc03069486f35e46a97afc68d768074eaa2682e6703751b5b4346f64d44d",
  BANNERS_ADMIN_LIST:
    "1ba88b9010fce03e0ff3c3c5c51fa278db819ebf4bd77b99867e3064c86e091d",
  BANNERS_UPSERT:
    "e5068c82295243a913a4850dfd5bd1c64c5a4166ae501581a3a459960e630a87",
  BANNERS_DELETE:
    "198b78c34f17e6663dd0b2aee49a4b143a2d04f70a88a721d7a7b7992040a0f5",
  BANNERS_REORDER:
    "6bb5b94ad984dfda9b3f6d2310eceb0106f341515295fa988444b412c57367ca",
  /** App carteira — transferência banca → desafio (máx. 50%) */
  TRANSFER_TO_DESAFIO:
    "f0610601d4285267b31d611e5eb632c530485702882605895d90b39b8be5922c",
  /** App afiliados */
  AFFILIATE_ENSURE_CODE:
    "fbc95c35a41b7d1f4cbff94481e4cc717dd5380d319f9c14ff638a68fe355a1c",
  AFFILIATE_WITHDRAW:
    "fe464d9378f5852cb8f2f20c8e6b6ee390d83b070e7008ed29ccfbf7ac320d89",
  /** Monitor proteções — cancelar/estornar + encerrar sem estorno (SPA) */
  PROTECTION_CANCEL_REFUND:
    "7389baaef3c2b584c409c59fc824e6b8438e2b36b31962f19de0f1815c6e443a",
  PROTECTION_CLOSE_NO_REFUND:
    "85ba18adcbc268610fb2ac76551978abee821260d93161e23aca41bd5d531e21",
  /** Admin Jogos — liquidar partida / mercado (SPA admin.matches) */
  MATCH_SETTLE_SINGLE:
    "c18778cffbba4cac38b3df54b2a50b3179a999b1c9908c2adbddd929ada5932f",
  MATCH_SETTLE_MARKET:
    "21c595c85ce2650c9c69d344a653ac759200afa18939bed530bb7448f7f8ffe0",
  MATCH_SETTLE_MULTI:
    "b70f19e71ec3ab8c40e0717abe92ab2082c7eedd832da71ab87cea2f2d95e286",
  /** Desafio — participação / settle (SPA surebet-validation) */
  DESAFIO_LIST_ACTIVE:
    "3d73b89476f54f1c738f12aa01a568e18829e0f8072936120346589e89b7b310",
  DESAFIO_BY_ID:
    "20c2d3787c1a5c9b929ff144f57f21ab03d16c29ef5059b233b1ef95797f0295",
  DESAFIO_REGISTER_ENTRY:
    "3c34027d8a2eb09861f6b73d3cde7533042d7ef97309fd62a78f46357c4e51d6",
  DESAFIO_CANCEL:
    "0ef0734039213d3b2c32371fe86cfa0486ad08ee0f364097c303347064f174c9",
  DESAFIO_LIST_PARTICIPATIONS:
    "75cfd1c4229fc49205ac01e4118352ced7608cca40417a415c1dd71561117355",
  DESAFIO_SETTLE:
    "357c98074708d437f1c98549857e29b1a5881358a44f70db45ed256f3bfb1b12",
  /** Provedor — distribuição admin (SPA) */
  PARTNER_ACTIVE_ROUNDS:
    "af661e4af08de0c265f682210b9bdb864049caf7d61b314c5b8c2ebefde48adc",
  PARTNER_DISTRIBUTE:
    "120795c23c4b588b868e5a2e18a3cd3839de0a1730c6c4022530fbb85c461dbc",
  PARTNER_DIST_HISTORY:
    "c3e505ca39c3e3d9e93ec2ee1e58a3168d6f34877d6de9caef17fd5d18dafd5d",
  PARTNER_MONTHLY_STATS:
    "5e62a59e14e7576ff86b0083e6e9ff57c75984e58b0904bf604e8cd041487fc8",
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
    home_logo_url: stepIn.home_logo_url || stepIn.home_logo || null,
    away_logo_url: stepIn.away_logo_url || stepIn.away_logo || null,
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
  if (!(await currentUserIsAdmin(token))) throw new Error("Acesso negado");
  const id = String(body?.id || body?.desafioId || body?.desafio_id || "").trim();
  if (!id) throw new Error("id obrigatório");

  const pending = await listPendingDesafioParticipations(id);
  if (pending.length > 0) {
    const err = new Error(
      `Há ${pending.length} cliente(s) com entrada ativa. Use Cancelar para devolver o saldo à carteira Desafio.`
    );
    err.status = 409;
    throw err;
  }

  await sb(`/rest/v1/desafios?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    token: SERVICE_KEY,
    body: {
      deleted_at: new Date().toISOString(),
      is_active: false,
      status: "deleted",
      updated_at: new Date().toISOString(),
    },
  });
  return { ok: true, deleted: true, id };
}

async function listPendingDesafioParticipations(desafioId) {
  const rows = await sb(
    `/rest/v1/desafio_participations?select=id,user_id,step_id,desafio_id,amount_cents,result,side&desafio_id=eq.${encodeURIComponent(desafioId)}&or=(result.eq.pending,result.is.null)&limit=2000`,
    { token: SERVICE_KEY }
  ).catch(() => []);
  return (Array.isArray(rows) ? rows : []).filter((p) => {
    const r = String(p.result || "pending").toLowerCase();
    return r === "pending" || r === "" || r === "null";
  });
}

async function cancelDesafio(token, body) {
  if (!(await currentUserIsAdmin(token))) throw new Error("Acesso negado");
  const id = String(body?.id || body?.desafioId || body?.desafio_id || "").trim();
  if (!id) throw new Error("id obrigatório");

  const desafioRows = await sb(
    `/rest/v1/desafios?select=id,title,status,is_active,deleted_at&id=eq.${encodeURIComponent(id)}&limit=1`,
    { token: SERVICE_KEY }
  );
  const desafio = Array.isArray(desafioRows) ? desafioRows[0] : null;
  if (!desafio?.id) {
    const err = new Error("Desafio não encontrado");
    err.status = 404;
    throw err;
  }
  if (desafio.deleted_at) {
    throw new Error("Desafio já excluído");
  }
  if (String(desafio.status) === "cancelled") {
    throw new Error("Desafio já cancelado");
  }

  const pending = await listPendingDesafioParticipations(id);
  if (!pending.length) {
    const err = new Error(
      "Nenhum cliente ativo neste desafio. Use Excluir."
    );
    err.status = 409;
    throw err;
  }

  let refundedCents = 0;
  let refundedCount = 0;
  const stepDelta = new Map();

  for (const p of pending) {
    const amount = Math.max(0, n(p.amount_cents));
    const userId = String(p.user_id || "").trim();
    if (!userId || !(amount > 0)) {
      await sb(
        `/rest/v1/desafio_participations?id=eq.${encodeURIComponent(p.id)}`,
        {
          method: "PATCH",
          token: SERVICE_KEY,
          body: {
            result: "cancelled",
            profit_cents: 0,
            updated_at: new Date().toISOString(),
          },
        }
      ).catch(() => null);
      continue;
    }

    const prof = await sb(
      `/rest/v1/profiles?select=desafio_balance_cents&id=eq.${encodeURIComponent(userId)}&limit=1`,
      { token: SERVICE_KEY }
    );
    const profile = Array.isArray(prof) ? prof[0] : null;
    const bal = n(profile?.desafio_balance_cents);

    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: {
        desafio_balance_cents: bal + amount,
        updated_at: new Date().toISOString(),
      },
    });

    await sb(
      `/rest/v1/desafio_participations?id=eq.${encodeURIComponent(p.id)}`,
      {
        method: "PATCH",
        token: SERVICE_KEY,
        body: {
          result: "cancelled",
          profit_cents: 0,
          updated_at: new Date().toISOString(),
        },
      }
    );

    try {
      await sb("/rest/v1/wallet_transactions", {
        method: "POST",
        token: SERVICE_KEY,
        body: {
          user_id: userId,
          type: "desafio_cancel_refund",
          amount_cents: amount,
          meta: {
            desafio_id: id,
            participation_id: p.id,
            step_id: p.step_id || null,
          },
        },
      });
    } catch {
      /* extrato opcional */
    }

    if (p.step_id) {
      stepDelta.set(p.step_id, (stepDelta.get(p.step_id) || 0) + amount);
    }
    refundedCents += amount;
    refundedCount += 1;
  }

  for (const [stepId, delta] of stepDelta.entries()) {
    try {
      const stepRows = await sb(
        `/rest/v1/desafio_steps?select=id,used_liquidity_cents&id=eq.${encodeURIComponent(stepId)}&limit=1`,
        { token: SERVICE_KEY }
      );
      const step = Array.isArray(stepRows) ? stepRows[0] : null;
      if (!step) continue;
      await sb(`/rest/v1/desafio_steps?id=eq.${encodeURIComponent(stepId)}`, {
        method: "PATCH",
        token: SERVICE_KEY,
        body: {
          used_liquidity_cents: Math.max(0, n(step.used_liquidity_cents) - delta),
          updated_at: new Date().toISOString(),
        },
      });
    } catch {
      /* */
    }
  }

  await sb(`/rest/v1/desafios?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    token: SERVICE_KEY,
    body: {
      status: "cancelled",
      is_active: false,
      updated_at: new Date().toISOString(),
    },
  });

  return {
    ok: true,
    cancelled: true,
    id,
    refundedCount,
    refundedCents,
  };
}

async function listDesafioPendingCounts(token, body) {
  if (!(await currentUserIsAdmin(token))) throw new Error("Acesso negado");
  const ids = Array.isArray(body?.desafioIds || body?.ids)
    ? (body.desafioIds || body.ids).map((x) => String(x).trim()).filter(Boolean)
    : [];
  const counts = {};
  if (!ids.length) return { counts };
  for (const id of ids) counts[id] = 0;

  // PostgREST in.() — lotes de 80
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    const inList = chunk.map((id) => encodeURIComponent(id)).join(",");
    const rows = await sb(
      `/rest/v1/desafio_participations?select=desafio_id,result&desafio_id=in.(${chunk.join(",")})&or=(result.eq.pending,result.is.null)&limit=5000`,
      { token: SERVICE_KEY }
    ).catch(() => []);
    for (const p of Array.isArray(rows) ? rows : []) {
      const did = String(p.desafio_id || "");
      if (!did || !(did in counts)) continue;
      const r = String(p.result || "pending").toLowerCase();
      if (r === "pending" || r === "" || r === "null") counts[did] += 1;
    }
  }
  return { counts };
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
    const d = parsed.data;
    if (
      !("t" in d) ||
      d.page != null ||
      d.from != null ||
      d.id != null ||
      d.title != null ||
      d.steps != null ||
      d.stepId != null ||
      d.winningSide != null ||
      d.percentage != null ||
      d.side != null ||
      d.amountCents != null ||
      d.protectionId != null ||
      d.reason != null
    ) {
      return d;
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
    "step_id",
    "winningSide",
    "winning_side",
    "side",
    "amountCents",
    "amount_cents",
    "percentage",
    "description",
    "homeScore",
    "awayScore",
    "protectionId",
    "marketType",
    "market_category",
    "reason",
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
  const maxPages = Number(process.env.ADMIN_AUTH_USERS_MAX_PAGES || 5);
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
    if (page > maxPages) break;
  }
  return users;
}

async function listAdminUsers() {
  // Limite defensivo: lista completa + auth admin paginado congelava o SPA.
  const MAX_PROFILES = Number(process.env.ADMIN_USERS_MAX || 800);
  const [profiles, roles, authUsers] = await Promise.all([
    sb(
      `/rest/v1/profiles?select=id,full_name,cpf,phone,pix_key,location,account_status,balance_cents,demo_balance_cents,demo_balance_provider_cents,investor_balance_cents,reusable_balance_cents,debited_balance_cents,locked_balance_cents,total_profit_cents,is_super_admin,is_affiliate,onboarding_completed,created_at,updated_at&order=created_at.desc&limit=${MAX_PROFILES}`
    ),
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
  assertNotBlocked(token);
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

async function currentUserIsAdmin(token) {
  assertNotBlocked(token);
  if (await currentUserIsSuperAdmin(token)) return true;
  const payload = decodeJwtPayload(token);
  const uid = payload?.sub;
  if (!uid) return false;
  const roles = await sb(
    `/rest/v1/user_roles?select=role&user_id=eq.${encodeURIComponent(uid)}`,
    { token: SERVICE_KEY }
  );
  return (Array.isArray(roles) ? roles : []).some(
    (r) => r.role === "admin" || r.role === "master_admin"
  );
}

async function currentUserCanFinance(token) {
  if (!(await currentUserIsAdmin(token))) return false;
  return canAccessFinance(tokenEmail(token));
}

async function requireFinanceAdmin(token) {
  if (!(await currentUserCanFinance(token))) {
    const err = new Error("Sem permissão para a área Financeiro");
    err.status = 403;
    throw err;
  }
}

function assertNotBlocked(token) {
  const payload = decodeJwtPayload(token);
  const email =
    payload?.email ||
    payload?.user_metadata?.email ||
    payload?.app_metadata?.email ||
    "";
  if (isBlockedEmail(email)) {
    const err = new Error("Esta conta está bloqueada. Contate o suporte.");
    err.status = 403;
    throw err;
  }
}

function normalizeBannerRow(body = {}) {
  const variant = String(body.variant || "custom").toLowerCase();
  const allowed = new Set(["custom", "affiliate", "match", "desafio"]);
  return {
    title: String(body.title || "").trim() || "Banner",
    subtitle: body.subtitle != null ? String(body.subtitle) : null,
    description: body.description != null ? String(body.description) : null,
    cta_label: body.cta_label != null ? String(body.cta_label) : null,
    cta_url: body.cta_url != null ? String(body.cta_url) : null,
    image_url: String(body.image_url || "").trim(),
    badge: body.badge != null ? String(body.badge) : null,
    variant: allowed.has(variant) ? variant : "custom",
    active: body.active !== false && body.active !== "false",
    sort_order:
      body.sort_order != null && Number.isFinite(Number(body.sort_order))
        ? Number(body.sort_order)
        : 0,
    updated_at: new Date().toISOString(),
  };
}

async function listBannersPublic() {
  const rows = await sb(
    "/rest/v1/banners?select=*&active=eq.true&order=sort_order.asc,created_at.desc",
    { token: SERVICE_KEY }
  );
  return Array.isArray(rows) ? rows : [];
}

async function listBannersAdmin(token) {
  if (!(await currentUserIsAdmin(token))) throw new Error("Sem permissão admin");
  const rows = await sb(
    "/rest/v1/banners?select=*&order=sort_order.asc,created_at.desc",
    { token: SERVICE_KEY }
  );
  return Array.isArray(rows) ? rows : [];
}

async function upsertBanner(token, body) {
  if (!(await currentUserIsAdmin(token))) throw new Error("Sem permissão admin");
  const row = normalizeBannerRow(body);
  if (!row.image_url) throw new Error("Imagem do banner obrigatória");

  if (body.id) {
    const updated = await sb(
      `/rest/v1/banners?id=eq.${encodeURIComponent(String(body.id))}`,
      { method: "PATCH", token: SERVICE_KEY, body: row }
    );
    return Array.isArray(updated) ? updated[0] : updated;
  }

  const created = await sb("/rest/v1/banners", {
    method: "POST",
    token: SERVICE_KEY,
    body: { ...row, created_at: new Date().toISOString() },
  });
  return Array.isArray(created) ? created[0] : created;
}

async function deleteBanner(token, body) {
  if (!(await currentUserIsAdmin(token))) throw new Error("Sem permissão admin");
  const id = body?.id;
  if (!id) throw new Error("id obrigatório");
  await sb(`/rest/v1/banners?id=eq.${encodeURIComponent(String(id))}`, {
    method: "DELETE",
    token: SERVICE_KEY,
  });
  return { ok: true };
}

async function reorderBanners(token, body) {
  if (!(await currentUserIsAdmin(token))) throw new Error("Sem permissão admin");
  const ids = Array.isArray(body?.ids)
    ? body.ids
    : Array.isArray(body?.order)
      ? body.order
      : [];
  if (!ids.length) return { ok: true };
  await Promise.all(
    ids.map((id, index) =>
      sb(`/rest/v1/banners?id=eq.${encodeURIComponent(String(id))}`, {
        method: "PATCH",
        token: SERVICE_KEY,
        body: { sort_order: index, updated_at: new Date().toISOString() },
      })
    )
  );
  return { ok: true };
}

function requireUserId(token) {
  assertNotBlocked(token);
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

function randomReferralCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

async function ensureAffiliateReferralCode(token) {
  const userId = requireUserId(token);
  const rows = await sb(
    `/rest/v1/profiles?select=id,referral_code&id=eq.${userId}&limit=1`,
    { token: SERVICE_KEY }
  );
  const p = Array.isArray(rows) ? rows[0] : null;
  if (!p) throw new Error("Perfil não encontrado");
  if (p.referral_code) {
    return { ok: true, referral_code: p.referral_code, code: p.referral_code };
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = randomReferralCode();
    try {
      await sb(`/rest/v1/profiles?id=eq.${userId}`, {
        method: "PATCH",
        token: SERVICE_KEY,
        body: { referral_code: code, updated_at: new Date().toISOString() },
      });
      return { ok: true, referral_code: code, code };
    } catch {
      /* retry on unique collision */
    }
  }
  throw new Error("Não foi possível gerar o código de indicação");
}

async function requestAffiliateWithdrawal(token, body) {
  const userId = requireUserId(token);
  const amountCents = Math.round(
    Number(body?.amountCents ?? body?.amount_cents ?? 0)
  );
  const pixKey = String(body?.pix_key ?? body?.pixKey ?? "").trim();
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error("Valor inválido");
  }
  if (!pixKey) throw new Error("Informe a chave Pix");

  const day = new Date().getDate();
  if (day !== 15 && day !== 30) {
    throw new Error("Saques de afiliado só nos dias 15 e 30");
  }

  const open = await sb(
    `/rest/v1/withdrawals?select=id,status,metadata&user_id=eq.${userId}&status=in.(pending,approved,processing)&order=created_at.desc&limit=20`,
    { token: SERVICE_KEY }
  ).catch(() => []);
  const hasOpen = (Array.isArray(open) ? open : []).some((w) => {
    const meta = w?.metadata || {};
    const origin = String(meta.origin || meta.request_type || meta.type || "").toUpperCase();
    return (
      origin === "AFFILIATE_WITHDRAWAL" ||
      origin === "AFFILIATE_COMMISSION_WITHDRAWAL" ||
      origin === "AFFILIATE_PAYOUT_REQUEST"
    );
  });
  if (hasOpen) {
    throw new Error("Você já possui uma solicitação de saque em análise.");
  }

  const commissions = await sb(
    `/rest/v1/affiliate_commissions?select=amount_cents,status&affiliate_id=eq.${userId}`,
    { token: SERVICE_KEY }
  ).catch(() => []);
  const okStatus = new Set(["approved", "available", "pending_payout", "paid"]);
  const earned = (Array.isArray(commissions) ? commissions : [])
    .filter((c) => okStatus.has(String(c.status || "").toLowerCase()))
    .reduce((a, c) => a + n(c.amount_cents), 0);

  const wds = await sb(
    `/rest/v1/withdrawals?select=amount_cents,status,metadata&user_id=eq.${userId}`,
    { token: SERVICE_KEY }
  ).catch(() => []);
  const openStatuses = new Set(["pending", "approved", "paid", "processing"]);
  const alreadyOut = (Array.isArray(wds) ? wds : [])
    .filter((w) => {
      const meta = w?.metadata || {};
      const origin = String(meta.origin || meta.request_type || meta.type || "").toUpperCase();
      const isAff =
        origin === "AFFILIATE_WITHDRAWAL" ||
        origin === "AFFILIATE_COMMISSION_WITHDRAWAL" ||
        origin === "AFFILIATE_PAYOUT_REQUEST";
      return isAff && openStatuses.has(String(w.status || "").toLowerCase());
    })
    .reduce((a, w) => a + n(w.amount_cents), 0);

  const available = Math.max(0, earned - alreadyOut);
  if (amountCents > available) {
    throw new Error(
      `Saldo insuficiente (disponível ${(available / 100).toFixed(2)})`
    );
  }

  const created = await sb("/rest/v1/withdrawals", {
    method: "POST",
    token: SERVICE_KEY,
    body: {
      user_id: userId,
      amount_cents: amountCents,
      pix_key: pixKey,
      status: "pending",
      metadata: { origin: "AFFILIATE_WITHDRAWAL" },
    },
  });
  const row = Array.isArray(created) ? created[0] : created;
  return { ok: true, withdrawal: row, amountCents };
}

async function transferRealToDesafio(token, body) {
  const userId = requireUserId(token);
  const amountCents = Math.round(Number(body?.amountCents ?? body?.amount_cents ?? 0));
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error("Valor inválido");
  }
  const rows = await sb(
    `/rest/v1/profiles?select=balance_cents,reusable_balance_cents,desafio_balance_cents&id=eq.${userId}&limit=1`,
    { token: SERVICE_KEY }
  );
  const p = Array.isArray(rows) ? rows[0] : null;
  if (!p) throw new Error("Perfil não encontrado");
  const balance = n(p.balance_cents);
  const reusable = n(p.reusable_balance_cents);
  const desafio = n(p.desafio_balance_cents);
  const banca = balance + reusable;
  const maxTransfer = Math.floor(banca / 2);
  if (amountCents > maxTransfer) {
    throw new Error(
      `Valor acima do limite de 50% do saldo da banca (máx. ${(maxTransfer / 100).toFixed(2)})`
    );
  }
  if (amountCents > banca) throw new Error("Saldo insuficiente");

  let nextBalance = balance;
  let nextReusable = reusable;
  let left = amountCents;
  if (nextBalance >= left) {
    nextBalance -= left;
    left = 0;
  } else {
    left -= nextBalance;
    nextBalance = 0;
    nextReusable = Math.max(0, nextReusable - left);
    left = 0;
  }

  await sb(`/rest/v1/profiles?id=eq.${userId}`, {
    method: "PATCH",
    token: SERVICE_KEY,
    body: {
      balance_cents: nextBalance,
      reusable_balance_cents: nextReusable,
      desafio_balance_cents: desafio + amountCents,
      updated_at: new Date().toISOString(),
    },
  });

  try {
    await sb("/rest/v1/wallet_transactions", {
      method: "POST",
      token: SERVICE_KEY,
      body: {
        user_id: userId,
        type: "transfer_to_desafio",
        amount_cents: -amountCents,
        balance_after_cents: nextBalance + nextReusable,
        meta: { destino: "desafio", amount_cents: amountCents },
      },
    });
  } catch {
    /* extrato opcional */
  }

  return {
    ok: true,
    amountCents,
    balance_cents: nextBalance,
    reusable_balance_cents: nextReusable,
    desafio_balance_cents: desafio + amountCents,
  };
}

/** Admin: lista depósitos Desafio (USDT + transferências banca→desafio) */
async function listDesafioDeposits(token) {
  await requireFinanceAdmin(token);

  let manuals = [];
  try {
    manuals = await sb(
      "/rest/v1/manual_deposits?select=id,user_id,amount_cents,status,network,proof_url,admin_notes,created_at,updated_at,deposit_type&deposit_type=eq.desafio&order=created_at.desc&limit=400",
      { token: SERVICE_KEY }
    );
  } catch {
    // schema sem deposit_type: tenta todos e filtra depois se possível
    try {
      const all = await sb(
        "/rest/v1/manual_deposits?select=id,user_id,amount_cents,status,network,proof_url,admin_notes,created_at,updated_at,deposit_type&order=created_at.desc&limit=400",
        { token: SERVICE_KEY }
      );
      manuals = (Array.isArray(all) ? all : []).filter(
        (r) => String(r.deposit_type || "").toLowerCase() === "desafio"
      );
    } catch {
      manuals = [];
    }
  }
  manuals = Array.isArray(manuals) ? manuals : [];

  let transfers = [];
  try {
    transfers = await sb(
      "/rest/v1/wallet_transactions?select=id,user_id,type,amount_cents,meta,created_at&type=eq.transfer_to_desafio&order=created_at.desc&limit=400",
      { token: SERVICE_KEY }
    );
  } catch {
    transfers = [];
  }
  transfers = Array.isArray(transfers) ? transfers : [];

  const userIds = [
    ...new Set(
      [...manuals, ...transfers]
        .map((r) => r.user_id)
        .filter(Boolean)
        .map(String)
    ),
  ];
  const profileMap = {};
  if (userIds.length) {
    // PostgREST: id=in.(...)
    const chunk = userIds.slice(0, 200);
    try {
      const profiles = await sb(
        `/rest/v1/profiles?select=id,full_name,phone&id=in.(${chunk.join(
          ","
        )})`,
        { token: SERVICE_KEY }
      );
      for (const p of Array.isArray(profiles) ? profiles : []) {
        profileMap[String(p.id)] = p;
      }
    } catch {
      /* ignore */
    }
  }

  function clientLabel(uid) {
    const p = profileMap[String(uid)] || {};
    return (
      String(p.full_name || "").trim() ||
      String(p.phone || "").trim() ||
      String(uid || "").slice(0, 8) ||
      "Cliente"
    );
  }

  const items = [];

  for (const m of manuals) {
    const st = String(m.status || "").toUpperCase();
    let description = "Depósito Desafio (USDT)";
    if (st === "PENDING") description = "Depósito Desafio — pendente de ativação";
    else if (st === "AWAITING_PROOF")
      description = "Depósito Desafio — aguardando comprovante";
    else if (st === "APPROVED") description = "Depósito Desafio — ativado";
    else if (st === "REJECTED") description = "Depósito Desafio — rejeitado";
    if (m.network) description += ` · ${m.network}`;

    items.push({
      id: m.id,
      source: "manual",
      user_id: m.user_id,
      client_name: clientLabel(m.user_id),
      description,
      amount_cents: Math.max(0, n(m.amount_cents)),
      status: st || "PENDING",
      network: m.network || null,
      proof_url: m.proof_url || null,
      admin_notes: m.admin_notes || null,
      created_at: m.created_at,
      updated_at: m.updated_at || null,
      can_activate: st === "PENDING" || st === "AWAITING_PROOF",
    });
  }

  for (const t of transfers) {
    const meta =
      t.meta && typeof t.meta === "object"
        ? t.meta
        : (() => {
            try {
              return JSON.parse(t.meta || "{}");
            } catch {
              return {};
            }
          })();
    const amt = Math.max(
      0,
      n(meta.amount_cents) || Math.abs(n(t.amount_cents))
    );
    items.push({
      id: t.id,
      source: "transfer",
      user_id: t.user_id,
      client_name: clientLabel(t.user_id),
      description: "Transferência banca → saldo Desafio",
      amount_cents: amt,
      status: "COMPLETED",
      network: null,
      proof_url: null,
      admin_notes: null,
      created_at: t.created_at,
      updated_at: null,
      can_activate: false,
    });
  }

  items.sort((a, b) => {
    const ta = new Date(a.created_at || 0).getTime();
    const tb = new Date(b.created_at || 0).getTime();
    return tb - ta;
  });

  let acumulado = 0;
  let feitosCount = 0;
  let pendentes = 0;
  let pendentesCount = 0;
  for (const it of items) {
    if (it.status === "APPROVED" || it.status === "COMPLETED") {
      acumulado += it.amount_cents;
      feitosCount += 1;
    } else if (it.status === "PENDING" || it.status === "AWAITING_PROOF") {
      pendentes += it.amount_cents;
      pendentesCount += 1;
    }
  }

  return {
    items,
    summary: {
      acumulado_cents: acumulado,
      feitos_count: feitosCount,
      pendentes_cents: pendentes,
      pendentes_count: pendentesCount,
      total_count: items.length,
    },
  };
}

async function approveDesafioDeposit(token, body) {
  await requireFinanceAdmin(token);
  const id = String(body?.id || "").trim();
  if (!id) throw new Error("id obrigatório");

  const rows = await sb(
    `/rest/v1/manual_deposits?select=*&id=eq.${encodeURIComponent(id)}&limit=1`,
    { token: SERVICE_KEY }
  );
  const dep = Array.isArray(rows) ? rows[0] : null;
  if (!dep) throw new Error("Depósito não encontrado");
  if (String(dep.deposit_type || "").toLowerCase() !== "desafio") {
    throw new Error("Depósito não é do tipo Desafio");
  }
  const st = String(dep.status || "").toUpperCase();
  if (st === "APPROVED") return { ok: true, already: true, deposit: dep };
  if (st === "REJECTED") throw new Error("Depósito já foi rejeitado");

  const amount = Math.max(0, n(dep.amount_cents));
  const userId = dep.user_id;
  if (!userId || !(amount > 0)) throw new Error("Depósito inválido");

  const profiles = await sb(
    `/rest/v1/profiles?select=desafio_balance_cents&id=eq.${encodeURIComponent(userId)}&limit=1`,
    { token: SERVICE_KEY }
  );
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  if (!profile) throw new Error("Cliente não encontrado");
  const nextBal = n(profile.desafio_balance_cents) + amount;

  await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH",
    token: SERVICE_KEY,
    body: {
      desafio_balance_cents: nextBal,
      updated_at: new Date().toISOString(),
    },
  });

  const updated = await sb(
    `/rest/v1/manual_deposits?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      token: SERVICE_KEY,
      body: {
        status: "APPROVED",
        updated_at: new Date().toISOString(),
      },
    }
  );

  try {
    await sb("/rest/v1/wallet_transactions", {
      method: "POST",
      token: SERVICE_KEY,
      body: {
        user_id: userId,
        type: "deposit_desafio",
        amount_cents: amount,
        balance_after_cents: nextBal,
        meta: {
          destino: "desafio",
          manual_deposit_id: id,
          amount_cents: amount,
        },
      },
    });
  } catch {
    /* extrato opcional */
  }

  return {
    ok: true,
    deposit: Array.isArray(updated) ? updated[0] : updated,
    desafio_balance_cents: nextBal,
  };
}

async function rejectDesafioDeposit(token, body) {
  await requireFinanceAdmin(token);
  const id = String(body?.id || "").trim();
  if (!id) throw new Error("id obrigatório");
  const reason = String(body?.reason || body?.admin_notes || "").trim();

  const rows = await sb(
    `/rest/v1/manual_deposits?select=*&id=eq.${encodeURIComponent(id)}&limit=1`,
    { token: SERVICE_KEY }
  );
  const dep = Array.isArray(rows) ? rows[0] : null;
  if (!dep) throw new Error("Depósito não encontrado");
  if (String(dep.deposit_type || "").toLowerCase() !== "desafio") {
    throw new Error("Depósito não é do tipo Desafio");
  }
  const st = String(dep.status || "").toUpperCase();
  if (st === "APPROVED")
    throw new Error("Depósito já ativado — não pode rejeitar");
  if (st === "REJECTED") return { ok: true, already: true, deposit: dep };

  const updated = await sb(
    `/rest/v1/manual_deposits?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      token: SERVICE_KEY,
      body: {
        status: "REJECTED",
        admin_notes: reason || dep.admin_notes || "Rejeitado pelo admin",
        updated_at: new Date().toISOString(),
      },
    }
  );
  return { ok: true, deposit: Array.isArray(updated) ? updated[0] : updated };
}

/** Lucro surebet aproximado (lado vencedor). */
function desafioProfitCents(amountCents, odd, commissionPct) {
  const stake = Math.max(0, Math.round(Number(amountCents) || 0));
  const o = Number(odd);
  if (!(stake > 0) || !(o > 1)) return 0;
  const fee = Math.max(0, Math.min(100, Number(commissionPct) || 0)) / 100;
  return Math.round(stake * (o - 1) * (1 - fee));
}

/**
 * Etapa 2+: lucro = stake + (stake × target_profit_pct%)
 * ex. R$100 + 5% = R$5 + R$100 stake → R$105 (equiv. odd 2,05).
 */
function desafioCompoundProfitCents(amountCents, profitPct, commissionPct) {
  const stake = Math.max(0, Math.round(Number(amountCents) || 0));
  const pct = Number(profitPct);
  if (!(stake > 0) || !Number.isFinite(pct) || pct < 0) return 0;
  const fee = Math.max(0, Math.min(100, Number(commissionPct) || 0)) / 100;
  const pctGain = Math.round((stake * pct) / 100);
  const lucro = stake + pctGain;
  return Math.round(lucro * (1 - fee));
}

async function listDesafioParticipations(token, body) {
  if (!(await currentUserIsAdmin(token))) throw new Error("Acesso negado");
  const stepId = String(body?.stepId || body?.step_id || "").trim();
  if (!stepId) throw new Error("stepId obrigatório");
  const rows = await sb(
    `/rest/v1/desafio_participations?select=*,profiles(full_name,avatar_url)&step_id=eq.${encodeURIComponent(stepId)}&order=created_at.desc&limit=500`,
    { token: SERVICE_KEY }
  ).catch(() => []);
  const list = Array.isArray(rows) ? rows : [];
  const totals = {
    total: list.length,
    arbishield: 0,
    casa: 0,
    amount_arbishield_cents: 0,
    amount_casa_cents: 0,
  };
  for (const r of list) {
    const side = String(r.side || "").toLowerCase();
    const amt = n(r.amount_cents);
    if (side === "casa") {
      totals.casa += 1;
      totals.amount_casa_cents += amt;
    } else {
      totals.arbishield += 1;
      totals.amount_arbishield_cents += amt;
    }
  }
  return { rows: list, totals };
}

/**
 * Distribui valor confiscado do circuito Desafio para provedores ativos
 * (proporcional ao invested_amount das partner_rounds).
 */
async function distributeToActiveProviders(amountCents, description) {
  const total = Math.max(0, Math.round(Number(amountCents) || 0));
  if (!(total > 0)) return { count: 0, totalDistributed: 0 };
  const rounds = await sb(
    `/rest/v1/partner_rounds?select=id,user_id,invested_amount,accumulated_amount,status&status=eq.active&invested_amount=gt.0&limit=2000`,
    { token: SERVICE_KEY }
  ).catch(() => []);
  const list = Array.isArray(rounds) ? rounds : [];
  if (!list.length) return { count: 0, totalDistributed: 0 };
  const pool = list.reduce((a, r) => a + n(r.invested_amount), 0);
  if (!(pool > 0)) return { count: 0, totalDistributed: 0 };

  let distributed = 0;
  let count = 0;
  for (const r of list) {
    const share = Math.floor((total * n(r.invested_amount)) / pool);
    if (share <= 0) continue;
    await sb("/rest/v1/partner_distributions", {
      method: "POST",
      token: SERVICE_KEY,
      body: {
        round_id: r.id,
        user_id: r.user_id,
        partner_id: r.user_id,
        distribution_amount: share,
        contribution_amount: n(r.invested_amount),
        description:
          description || "Liquidez Desafio — circuito sem vitória na casa",
      },
    });
    const nextAcc = n(r.accumulated_amount) + share;
    await sb(`/rest/v1/partner_rounds?id=eq.${encodeURIComponent(r.id)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: {
        accumulated_amount: nextAcc,
        updated_at: new Date().toISOString(),
      },
    }).catch(() => null);
    try {
      const prof = await sb(
        `/rest/v1/profiles?select=investor_balance_cents&id=eq.${encodeURIComponent(r.user_id)}&limit=1`,
        { token: SERVICE_KEY }
      );
      const cur = Array.isArray(prof) ? prof[0] : null;
      if (cur) {
        await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(r.user_id)}`, {
          method: "PATCH",
          token: SERVICE_KEY,
          body: {
            investor_balance_cents: n(cur.investor_balance_cents) + share,
            updated_at: new Date().toISOString(),
          },
        });
      }
    } catch {
      /* saldo provedor opcional */
    }
    distributed += share;
    count += 1;
  }
  return { count, totalDistributed: distributed };
}

async function maybeForfeitCircuitToProviders(desafioId, userId) {
  const desafioRows = await sb(
    `/rest/v1/desafios?select=id,total_steps,initial_balance_cents&id=eq.${encodeURIComponent(desafioId)}&limit=1`,
    { token: SERVICE_KEY }
  );
  const desafio = Array.isArray(desafioRows) ? desafioRows[0] : null;
  if (!desafio) return null;

  const steps = await sb(
    `/rest/v1/desafio_steps?select=id,status,result,step_index&desafio_id=eq.${encodeURIComponent(desafioId)}&order=step_index.asc`,
    { token: SERVICE_KEY }
  ).catch(() => []);
  const stepList = Array.isArray(steps) ? steps : [];
  const totalSteps = Math.max(
    n(desafio.total_steps) || stepList.length || 5,
    1
  );
  const done = stepList.filter((s) => String(s.status) === "done");
  if (done.length < totalSteps) return null;

  const stepIds = stepList.map((s) => s.id).filter(Boolean);
  if (!stepIds.length) return null;
  const parts = await sb(
    `/rest/v1/desafio_participations?select=id,user_id,step_id,side,result,amount_cents,profit_cents&user_id=eq.${encodeURIComponent(userId)}&step_id=in.(${stepIds.join(",")})`,
    { token: SERVICE_KEY }
  ).catch(() => []);
  const userParts = Array.isArray(parts) ? parts : [];
  if (!userParts.length) return null;

  const wonCasa = userParts.some(
    (p) =>
      String(p.side).toLowerCase() === "casa" &&
      String(p.result).toLowerCase() === "won"
  );
  if (wonCasa) return { forfeited: false, reason: "objetivo_casa_atingido" };

  const arbiWins = userParts.filter(
    (p) =>
      String(p.side).toLowerCase() === "arbishield" &&
      String(p.result).toLowerCase() === "won"
  );
  const wonAmount = arbiWins.reduce(
    (a, p) => a + n(p.profit_cents) + n(p.amount_cents),
    0
  );
  if (!(wonAmount > 0)) return { forfeited: false, reason: "sem_ganhos" };

  const prof = await sb(
    `/rest/v1/profiles?select=desafio_balance_cents&id=eq.${encodeURIComponent(userId)}&limit=1`,
    { token: SERVICE_KEY }
  );
  const profile = Array.isArray(prof) ? prof[0] : null;
  const bal = n(profile?.desafio_balance_cents);
  const take = Math.min(bal, wonAmount);
  if (take > 0) {
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: {
        desafio_balance_cents: Math.max(0, bal - take),
        updated_at: new Date().toISOString(),
      },
    });
  }
  const dist = await distributeToActiveProviders(
    take > 0 ? take : wonAmount,
    `Circuito Desafio ${desafioId.slice(0, 8)} — sem vitória na casa`
  );
  try {
    await sb("/rest/v1/wallet_transactions", {
      method: "POST",
      token: SERVICE_KEY,
      body: {
        user_id: userId,
        type: "desafio_forfeit_to_provider",
        amount_cents: -(take || wonAmount),
        meta: {
          desafio_id: desafioId,
          providers: dist.count,
          totalDistributed: dist.totalDistributed,
        },
      },
    });
  } catch {
    /* opcional */
  }
  return {
    forfeited: true,
    amountCents: take || wonAmount,
    providers: dist,
  };
}

async function settleDesafioStep(token, body) {
  if (!(await currentUserIsAdmin(token))) throw new Error("Acesso negado");
  const stepId = String(body?.stepId || body?.step_id || "").trim();
  const winningSide = String(body?.winningSide || body?.winning_side || "")
    .toLowerCase()
    .trim();
  if (!stepId) throw new Error("stepId obrigatório");
  if (winningSide !== "arbishield" && winningSide !== "casa") {
    throw new Error("winningSide deve ser arbishield ou casa");
  }

  const stepRows = await sb(
    `/rest/v1/desafio_steps?select=*,desafios(id,target_profit_pct,total_steps)&id=eq.${encodeURIComponent(stepId)}&limit=1`,
    { token: SERVICE_KEY }
  );
  const step = Array.isArray(stepRows) ? stepRows[0] : null;
  if (!step) throw new Error("Etapa não encontrada");
  if (String(step.status) === "done") {
    throw new Error("Etapa já encerrada");
  }

  const stepIndex = Math.max(1, n(step.step_index) || 1);
  const desafioMeta = step.desafios || {};
  const targetProfitPct = Number(
    desafioMeta.target_profit_pct ?? step.target_profit_pct ?? 5
  );

  const parts = await sb(
    `/rest/v1/desafio_participations?select=*&step_id=eq.${encodeURIComponent(stepId)}&limit=2000`,
    { token: SERVICE_KEY }
  ).catch(() => []);
  const list = Array.isArray(parts) ? parts : [];
  const adminId = (() => {
    try {
      return requireUserId(token);
    } catch {
      return null;
    }
  })();

  for (const p of list) {
    const side = String(p.side || "").toLowerCase();
    const won = side === winningSide;
    let profit = 0;
    if (won) {
      if (side === "arbishield") {
        // Etapa 2+: stake + (stake × %) — saldo composto após vitória ArbiShield
        if (stepIndex > 1 && Number.isFinite(targetProfitPct) && targetProfitPct > 0) {
          profit = desafioCompoundProfitCents(
            p.amount_cents,
            targetProfitPct,
            step.arbi_commission_pct
          );
        } else {
          profit = desafioProfitCents(
            p.amount_cents,
            step.arbi_odd ?? step.home_odd,
            step.arbi_commission_pct
          );
        }
      } else {
        profit = desafioProfitCents(
          p.amount_cents,
          step.casa_odd ?? step.away_odd,
          step.casa_commission_pct
        );
      }
    }
    await sb(
      `/rest/v1/desafio_participations?id=eq.${encodeURIComponent(p.id)}`,
      {
        method: "PATCH",
        token: SERVICE_KEY,
        body: {
          result: won ? "won" : "lost",
          profit_cents: won ? profit : 0,
          updated_at: new Date().toISOString(),
        },
      }
    );
    if (won && profit > 0 && p.user_id) {
      try {
        const pr = await sb(
          `/rest/v1/profiles?select=desafio_balance_cents&id=eq.${encodeURIComponent(p.user_id)}&limit=1`,
          { token: SERVICE_KEY }
        );
        const cur = Array.isArray(pr) ? pr[0] : null;
        if (cur) {
          await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(p.user_id)}`, {
            method: "PATCH",
            token: SERVICE_KEY,
            body: {
              desafio_balance_cents: n(cur.desafio_balance_cents) + profit,
              updated_at: new Date().toISOString(),
            },
          });
        }
      } catch {
        /* */
      }
    }
  }

  const result =
    winningSide === "arbishield" ? "zebra_protected" : "win";
  await sb(`/rest/v1/desafio_steps?id=eq.${encodeURIComponent(stepId)}`, {
    method: "PATCH",
    token: SERVICE_KEY,
    body: {
      status: "done",
      result,
      settled_at: new Date().toISOString(),
      settled_by: adminId,
      final_score_home:
        body?.homeScore != null ? Number(body.homeScore) : step.final_score_home,
      final_score_away:
        body?.awayScore != null ? Number(body.awayScore) : step.final_score_away,
      updated_at: new Date().toISOString(),
    },
  });

  const forfeits = [];
  if (winningSide === "arbishield" && step.desafio_id) {
    const userIds = [...new Set(list.map((p) => p.user_id).filter(Boolean))];
    for (const uid of userIds) {
      const f = await maybeForfeitCircuitToProviders(step.desafio_id, uid);
      if (f) forfeits.push({ userId: uid, ...f });
    }
  }

  const retained = list
    .filter((p) => String(p.side || "").toLowerCase() !== winningSide)
    .reduce((a, p) => a + n(p.amount_cents), 0);

  return {
    ok: true,
    stepId,
    winningSide,
    result,
    participants: list.length,
    retainedCents: retained,
    forfeits,
  };
}

async function registerDesafioEntry(token, body) {
  const userId = requireUserId(token);
  const stepId = String(body?.stepId || body?.step_id || "").trim();
  const side = String(body?.side || "")
    .toLowerCase()
    .trim();
  const amountCents = Math.round(
    Number(body?.amountCents ?? body?.amount_cents ?? 0)
  );
  if (!stepId) throw new Error("stepId obrigatório");
  if (side !== "arbishield" && side !== "casa") {
    throw new Error("side inválido");
  }
  if (!(amountCents > 0)) throw new Error("Valor inválido");

  const stepRows = await sb(
    `/rest/v1/desafio_steps?select=*,desafios(id,initial_balance_cents,is_active,status)&id=eq.${encodeURIComponent(stepId)}&limit=1`,
    { token: SERVICE_KEY }
  );
  const step = Array.isArray(stepRows) ? stepRows[0] : null;
  if (!step) throw new Error("Etapa não encontrada");
  if (String(step.status) === "done") throw new Error("Etapa já encerrada");
  if (String(step.status) === "live") {
    throw new Error("Jogo ao vivo — entradas encerradas");
  }

  const existing = await sb(
    `/rest/v1/desafio_participations?select=id&user_id=eq.${userId}&step_id=eq.${encodeURIComponent(stepId)}&side=eq.${side}&limit=1`,
    { token: SERVICE_KEY }
  ).catch(() => []);
  if (Array.isArray(existing) && existing[0]) {
    throw new Error("already registered");
  }

  const prof = await sb(
    `/rest/v1/profiles?select=desafio_balance_cents&id=eq.${userId}&limit=1`,
    { token: SERVICE_KEY }
  );
  const profile = Array.isArray(prof) ? prof[0] : null;
  const bal = n(profile?.desafio_balance_cents);
  if (bal < amountCents) throw new Error("insufficient");

  await sb(`/rest/v1/profiles?id=eq.${userId}`, {
    method: "PATCH",
    token: SERVICE_KEY,
    body: {
      desafio_balance_cents: bal - amountCents,
      updated_at: new Date().toISOString(),
    },
  });

  const created = await sb("/rest/v1/desafio_participations", {
    method: "POST",
    token: SERVICE_KEY,
    body: {
      user_id: userId,
      step_id: stepId,
      desafio_id: step.desafio_id || step.desafios?.id || null,
      side,
      amount_cents: amountCents,
      result: "pending",
      profit_cents: 0,
    },
  });
  const row = Array.isArray(created) ? created[0] : created;

  try {
    await sb(`/rest/v1/desafio_steps?id=eq.${encodeURIComponent(stepId)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: {
        used_liquidity_cents: n(step.used_liquidity_cents) + amountCents,
        updated_at: new Date().toISOString(),
      },
    });
  } catch {
    /* */
  }

  return { ok: true, participation: row };
}

async function listActivePartnerRounds(token) {
  await requireFinanceAdmin(token);
  const rounds = await sb(
    `/rest/v1/partner_rounds?select=*,profiles(full_name,email)&status=eq.active&order=created_at.desc&limit=500`,
    { token: SERVICE_KEY }
  ).catch(() =>
    sb(
      `/rest/v1/partner_rounds?select=*&status=eq.active&order=created_at.desc&limit=500`,
      { token: SERVICE_KEY }
    )
  );
  return Array.isArray(rounds) ? rounds : [];
}

async function distributePartnerYield(token, body) {
  await requireFinanceAdmin(token);
  const percentage = Number(body?.percentage ?? body?.pct ?? 0);
  if (!(percentage > 0) || percentage > 100) {
    throw new Error("Informe um percentual válido.");
  }
  const description =
    String(body?.description || "").trim() ||
    `Rendimento ${percentage.toFixed(2)}%`;

  const rounds = await listActivePartnerRounds(token);
  let totalDistributed = 0;
  let count = 0;
  for (const r of rounds) {
    const invested = n(r.invested_amount);
    if (!(invested > 0)) continue;
    const share = Math.round((invested * percentage) / 100);
    if (share <= 0) continue;
    await sb("/rest/v1/partner_distributions", {
      method: "POST",
      token: SERVICE_KEY,
      body: {
        round_id: r.id,
        user_id: r.user_id,
        partner_id: r.user_id,
        distribution_amount: share,
        contribution_amount: invested,
        description,
      },
    });
    await sb(`/rest/v1/partner_rounds?id=eq.${encodeURIComponent(r.id)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: {
        accumulated_amount: n(r.accumulated_amount) + share,
        updated_at: new Date().toISOString(),
      },
    }).catch(() => null);
    try {
      const prof = await sb(
        `/rest/v1/profiles?select=investor_balance_cents&id=eq.${encodeURIComponent(r.user_id)}&limit=1`,
        { token: SERVICE_KEY }
      );
      const cur = Array.isArray(prof) ? prof[0] : null;
      if (cur) {
        await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(r.user_id)}`, {
          method: "PATCH",
          token: SERVICE_KEY,
          body: {
            investor_balance_cents: n(cur.investor_balance_cents) + share,
            updated_at: new Date().toISOString(),
          },
        });
      }
    } catch {
      /* */
    }
    totalDistributed += share;
    count += 1;
  }
  return { success: true, count, totalDistributed, percentage };
}

async function partnerDistributionHistory(token) {
  await requireFinanceAdmin(token);
  const rows = await sb(
    `/rest/v1/partner_distributions?select=*&order=created_at.desc&limit=200`,
    { token: SERVICE_KEY }
  ).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function partnerMonthlyStats(token) {
  await requireFinanceAdmin(token);
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const rows = await sb(
    `/rest/v1/partner_distributions?select=distribution_amount,contribution_amount,created_at&created_at=gte.${from}&limit=5000`,
    { token: SERVICE_KEY }
  ).catch(() => []);
  const list = Array.isArray(rows) ? rows : [];
  const totalPaid = list.reduce((a, r) => a + n(r.distribution_amount), 0);
  const investedBase = list.reduce((a, r) => a + n(r.contribution_amount), 0);
  const monthPct =
    investedBase > 0 ? Number(((totalPaid / investedBase) * 100).toFixed(2)) : 0;
  return { monthPct, totalPaid, count: list.length };
}

async function loadProtectionRow(protectionId, marketType) {
  const isBack = String(marketType || "").toUpperCase() === "BACK";
  const table = isBack ? "back_protections" : "protections";
  const rows = await sb(
    `/rest/v1/${table}?select=*&id=eq.${encodeURIComponent(protectionId)}&limit=1`,
    { token: SERVICE_KEY }
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) throw new Error("Proteção não encontrada");
  return { table, row, isBack };
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

async function closeProtectionNoRefund(token, body) {
  if (!(await currentUserIsAdmin(token))) throw new Error("Acesso negado");
  const protectionId = String(body?.protectionId || body?.id || "").trim();
  const marketType = String(body?.marketType || body?.market_category || "LAY");
  const reason = String(body?.reason || "").trim();
  if (!protectionId) throw new Error("protectionId obrigatório");
  if (!reason) throw new Error("Motivo é obrigatório para encerrar sem estornar.");

  const { table, row } = await loadProtectionRow(protectionId, marketType);
  const st = String(row.status || "").toLowerCase();
  if (st === "cancelled" || st === "settled" || st === "closed") {
    throw new Error("Proteção já finalizada");
  }
  const amount = n(row.responsibility_cents || row.amount_cents);
  const adminId = requireUserId(token);

  await sb(`/rest/v1/${table}?id=eq.${encodeURIComponent(protectionId)}`, {
    method: "PATCH",
    token: SERVICE_KEY,
    body: {
      status: "settled",
      settled_at: new Date().toISOString(),
      result: "closed_no_refund",
      metadata: {
        ...(row.metadata && typeof row.metadata === "object" ? row.metadata : {}),
        close_reason: reason,
        closed_by: adminId,
        closed_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    },
  });

  if (row.user_id) {
    try {
      const prof = await sb(
        `/rest/v1/profiles?select=locked_balance_cents&id=eq.${encodeURIComponent(row.user_id)}&limit=1`,
        { token: SERVICE_KEY }
      );
      const p = Array.isArray(prof) ? prof[0] : null;
      if (p) {
        await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(row.user_id)}`, {
          method: "PATCH",
          token: SERVICE_KEY,
          body: {
            locked_balance_cents: Math.max(0, n(p.locked_balance_cents) - amount),
            updated_at: new Date().toISOString(),
          },
        });
      }
    } catch {
      /* */
    }
  }

  const marketId =
    row.market_id ||
    (row.metadata && (row.metadata.market_id || row.metadata.marketId)) ||
    null;
  await restoreMatchLiquidity(row.match_id, amount, marketId);

  try {
    await sb("/rest/v1/admin_audit_logs", {
      method: "POST",
      token: SERVICE_KEY,
      body: {
        admin_id: adminId,
        action: "protection_close_no_refund",
        entity_type: table,
        entity_id: protectionId,
        details: { reason, amount_cents: amount, marketType },
      },
    });
  } catch {
    /* */
  }

  return { ok: true, protectionId, status: "settled" };
}

async function cancelProtectionRefund(token, body) {
  if (!(await currentUserIsAdmin(token))) throw new Error("Acesso negado");
  const protectionId = String(body?.protectionId || body?.id || "").trim();
  const marketType = String(body?.marketType || body?.market_category || "LAY");
  if (!protectionId) throw new Error("protectionId obrigatório");

  const { table, row } = await loadProtectionRow(protectionId, marketType);
  const st = String(row.status || "").toLowerCase();
  if (st === "cancelled") throw new Error("Proteção já cancelada");
  if (st === "settled" || st === "closed") {
    throw new Error("Proteção já encerrada — use estorno manual se necessário");
  }
  const amount = n(row.responsibility_cents || row.amount_cents);
  const adminId = requireUserId(token);

  if (row.user_id && amount > 0) {
    const prof = await sb(
      `/rest/v1/profiles?select=balance_cents,reusable_balance_cents,locked_balance_cents&id=eq.${encodeURIComponent(row.user_id)}&limit=1`,
      { token: SERVICE_KEY }
    );
    const p = Array.isArray(prof) ? prof[0] : null;
    if (!p) throw new Error("Perfil do usuário não encontrado");
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(row.user_id)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: {
        balance_cents: n(p.balance_cents) + amount,
        locked_balance_cents: Math.max(0, n(p.locked_balance_cents) - amount),
        updated_at: new Date().toISOString(),
      },
    });
    try {
      await sb("/rest/v1/wallet_transactions", {
        method: "POST",
        token: SERVICE_KEY,
        body: {
          user_id: row.user_id,
          type: "protection_refund",
          amount_cents: amount,
          meta: { protection_id: protectionId, marketType },
        },
      });
    } catch {
      /* */
    }
  }

  await sb(`/rest/v1/${table}?id=eq.${encodeURIComponent(protectionId)}`, {
    method: "PATCH",
    token: SERVICE_KEY,
    body: {
      status: "cancelled",
      settled_at: new Date().toISOString(),
      result: "cancelled_refund",
      updated_at: new Date().toISOString(),
    },
  });

  const marketId =
    row.market_id ||
    (row.metadata && (row.metadata.market_id || row.metadata.marketId)) ||
    null;
  await restoreMatchLiquidity(row.match_id, amount, marketId);

  try {
    await sb("/rest/v1/admin_audit_logs", {
      method: "POST",
      token: SERVICE_KEY,
      body: {
        admin_id: adminId,
        action: "protection_cancel_refund",
        entity_type: table,
        entity_id: protectionId,
        details: { amount_cents: amount, marketType },
      },
    });
  } catch {
    /* */
  }

  return { ok: true, protectionId, status: "cancelled", refundedCents: amount };
}

function openProtectionStatuses() {
  return ["active", "pending", "review_odd"];
}

function isOpenProtectionStatus(st) {
  return openProtectionStatuses().includes(String(st || "").toLowerCase());
}

async function applyProtectionSettlement(row, table, outcome) {
  const amount = n(row.responsibility_cents || row.amount_cents);
  const wonArbi = String(outcome).toLowerCase() === "arbishield";
  const status = wonArbi ? "won_platform" : "won_exchange";
  const now = new Date().toISOString();

  if (row.user_id && amount > 0) {
    try {
      const prof = await sb(
        `/rest/v1/profiles?select=balance_cents,locked_balance_cents&id=eq.${encodeURIComponent(row.user_id)}&limit=1`,
        { token: SERVICE_KEY }
      );
      const p = Array.isArray(prof) ? prof[0] : null;
      if (p) {
        const locked = Math.max(0, n(p.locked_balance_cents) - amount);
        // arbishield: devolve só stake/responsabilidade (sem lucro);
        // exchange: stake fica na plataforma
        const balance = wonArbi
          ? n(p.balance_cents) + amount
          : n(p.balance_cents);
        await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(row.user_id)}`, {
          method: "PATCH",
          token: SERVICE_KEY,
          body: {
            balance_cents: balance,
            locked_balance_cents: locked,
            updated_at: now,
          },
        });
      }
    } catch {
      /* saldo best-effort */
    }
  }

  const protBody = { status, settled_at: now, updated_at: now };
  try {
    await sb(`/rest/v1/${table}?id=eq.${encodeURIComponent(row.id)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: {
        ...protBody,
        settled_outcome: String(outcome).toLowerCase(),
        result: status,
      },
    });
  } catch {
    await sb(`/rest/v1/${table}?id=eq.${encodeURIComponent(row.id)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: protBody,
    });
  }

  return { id: row.id, status, amount };
}

async function settleMatch(token, body) {
  if (!(await currentUserIsAdmin(token))) throw new Error("Acesso negado");
  const matchId = String(body?.matchId || body?.id || "").trim();
  if (!matchId) throw new Error("matchId obrigatório");

  const outcomesMap =
    body?.outcomes && typeof body.outcomes === "object" && !Array.isArray(body.outcomes)
      ? body.outcomes
      : null;
  const marketId = body?.marketId ? String(body.marketId) : null;
  let outcome = String(body?.outcome || "").toLowerCase();
  if (!outcome && outcomesMap) {
    const vals = Object.values(outcomesMap).map((v) => String(v).toLowerCase());
    outcome = vals[0] || "";
  }
  if (outcome && outcome !== "arbishield" && outcome !== "exchange") {
    throw new Error("outcome inválido (use arbishield ou exchange)");
  }

  let finalScore = body?.finalScore || body?.final_score || null;
  if (
    !finalScore &&
    (body?.homeScore != null ||
      body?.awayScore != null ||
      body?.final_score_home != null ||
      body?.final_score_away != null)
  ) {
    finalScore = `${Number(body.homeScore ?? body.final_score_home ?? 0)}-${Number(
      body.awayScore ?? body.final_score_away ?? 0
    )}`;
  }

  const rows = await sb(
    `/rest/v1/matches?id=eq.${encodeURIComponent(matchId)}&select=*&limit=1`,
    { token: SERVICE_KEY }
  );
  const match = Array.isArray(rows) ? rows[0] : null;
  if (!match) throw new Error("Partida não encontrada");

  let markets = Array.isArray(match.markets) ? [...match.markets] : [];
  if (marketId && outcome) {
    markets = markets.map((m) =>
      String(m?.id) === String(marketId)
        ? { ...m, settled_outcome: outcome }
        : m
    );
  } else if (outcomesMap) {
    markets = markets.map((m) => {
      const key = String(m?.id);
      const o = outcomesMap[key] ?? outcomesMap[m?.id];
      return o ? { ...m, settled_outcome: String(o).toLowerCase() } : m;
    });
    if (!outcome) {
      const first = markets.find((m) => m.settled_outcome);
      outcome = String(first?.settled_outcome || "").toLowerCase();
    }
  } else if (outcome) {
    markets = markets.map((m) => ({ ...m, settled_outcome: outcome }));
  }

  if (!outcome && !marketId && !outcomesMap) {
    throw new Error("Informe outcome (arbishield/exchange)");
  }

  const now = new Date().toISOString();
  const patchMatch = {
    markets,
    updated_at: now,
  };
  if (!marketId) {
    if (finalScore) patchMatch.final_score = String(finalScore);
    patchMatch.settled_at = now;
    patchMatch.status = "settled";
  }

  try {
    await sb(`/rest/v1/matches?id=eq.${encodeURIComponent(matchId)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: { ...patchMatch, status_v2: "settled" },
    });
  } catch {
    await sb(`/rest/v1/matches?id=eq.${encodeURIComponent(matchId)}`, {
      method: "PATCH",
      token: SERVICE_KEY,
      body: patchMatch,
    });
  }

  const statusFilter = openProtectionStatuses()
    .map(encodeURIComponent)
    .join(",");
  const [lays, backs] = await Promise.all([
    sb(
      `/rest/v1/protections?match_id=eq.${encodeURIComponent(matchId)}&status=in.(${statusFilter})&select=*&limit=2000`,
      { token: SERVICE_KEY }
    ).catch(() => []),
    sb(
      `/rest/v1/back_protections?match_id=eq.${encodeURIComponent(matchId)}&status=in.(${statusFilter})&select=*&limit=2000`,
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
  ].filter((r) => isOpenProtectionStatus(r.status));

  let settledCount = 0;
  for (const row of all) {
    const rowMarket =
      row.market_id ||
      (row.metadata && (row.metadata.market_id || row.metadata.marketId)) ||
      null;
    let rowOutcome = outcome;
    if (marketId) {
      if (rowMarket && String(rowMarket) !== String(marketId)) continue;
      rowOutcome = outcome;
    } else if (outcomesMap && rowMarket) {
      const o = outcomesMap[String(rowMarket)] ?? outcomesMap[rowMarket];
      if (o) rowOutcome = String(o).toLowerCase();
    }
    if (!rowOutcome) continue;
    await applyProtectionSettlement(row, row._table, rowOutcome);
    settledCount += 1;
  }

  const adminId = requireUserId(token);
  try {
    await sb("/rest/v1/admin_audit_logs", {
      method: "POST",
      token: SERVICE_KEY,
      body: {
        admin_id: adminId,
        action: marketId
          ? "ADMIN_ACTION_SETTLE_MARKET"
          : "ADMIN_ACTION_SETTLE",
        entity_type: "matches",
        entity_id: matchId,
        details: {
          outcome,
          finalScore: finalScore || null,
          marketId: marketId || null,
          outcomes: outcomesMap || null,
          settledCount,
        },
      },
    });
  } catch {
    /* */
  }

  return {
    ok: true,
    matchId,
    outcome: outcome || null,
    finalScore: finalScore || null,
    settledCount,
  };
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

  if (id === FN.BANNERS_PUBLIC_LIST) {
    try {
      return sendTsrOk(res, await listBannersPublic());
    } catch (err) {
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.BANNERS_ADMIN_LIST) {
    try {
      return sendTsrOk(res, await listBannersAdmin(token));
    } catch (err) {
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.BANNERS_UPSERT && req.method === "POST") {
    try {
      const params = extractServerFnData(rawBody);
      return sendTsrOk(res, await upsertBanner(token, params));
    } catch (err) {
      console.error("[serverfn-shim] BANNERS_UPSERT error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.BANNERS_DELETE && req.method === "POST") {
    try {
      const params = extractServerFnData(rawBody);
      return sendTsrOk(res, await deleteBanner(token, params));
    } catch (err) {
      console.error("[serverfn-shim] BANNERS_DELETE error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.TRANSFER_TO_DESAFIO && req.method === "POST") {
    try {
      const params = extractServerFnData(rawBody);
      return sendTsrOk(res, await transferRealToDesafio(token, params));
    } catch (err) {
      console.error("[serverfn-shim] TRANSFER_TO_DESAFIO error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.AFFILIATE_ENSURE_CODE && (req.method === "POST" || req.method === "GET")) {
    try {
      return sendTsrOk(res, await ensureAffiliateReferralCode(token));
    } catch (err) {
      console.error("[serverfn-shim] AFFILIATE_ENSURE_CODE error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.AFFILIATE_WITHDRAW && req.method === "POST") {
    try {
      const params = extractServerFnData(rawBody);
      return sendTsrOk(res, await requestAffiliateWithdrawal(token, params));
    } catch (err) {
      console.error("[serverfn-shim] AFFILIATE_WITHDRAW error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.DESAFIO_REGISTER_ENTRY && req.method === "POST") {
    try {
      return sendTsrOk(
        res,
        await registerDesafioEntry(token, extractServerFnData(rawBody))
      );
    } catch (err) {
      console.error("[serverfn-shim] DESAFIO_REGISTER_ENTRY error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.DESAFIO_LIST_PARTICIPATIONS && req.method === "POST") {
    try {
      return sendTsrOk(
        res,
        await listDesafioParticipations(token, extractServerFnData(rawBody))
      );
    } catch (err) {
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.DESAFIO_SETTLE && req.method === "POST") {
    try {
      return sendTsrOk(
        res,
        await settleDesafioStep(token, extractServerFnData(rawBody))
      );
    } catch (err) {
      console.error("[serverfn-shim] DESAFIO_SETTLE error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.PARTNER_ACTIVE_ROUNDS) {
    try {
      return sendTsrOk(res, await listActivePartnerRounds(token));
    } catch (err) {
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.PARTNER_DISTRIBUTE && req.method === "POST") {
    try {
      return sendTsrOk(
        res,
        await distributePartnerYield(token, extractServerFnData(rawBody))
      );
    } catch (err) {
      console.error("[serverfn-shim] PARTNER_DISTRIBUTE error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.PARTNER_DIST_HISTORY) {
    try {
      return sendTsrOk(res, await partnerDistributionHistory(token));
    } catch (err) {
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.PARTNER_MONTHLY_STATS) {
    try {
      return sendTsrOk(res, await partnerMonthlyStats(token));
    } catch (err) {
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.PROTECTION_CLOSE_NO_REFUND && req.method === "POST") {
    try {
      return sendTsrOk(
        res,
        await closeProtectionNoRefund(token, extractServerFnData(rawBody))
      );
    } catch (err) {
      console.error("[serverfn-shim] PROTECTION_CLOSE_NO_REFUND error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.PROTECTION_CANCEL_REFUND && req.method === "POST") {
    try {
      return sendTsrOk(
        res,
        await cancelProtectionRefund(token, extractServerFnData(rawBody))
      );
    } catch (err) {
      console.error("[serverfn-shim] PROTECTION_CANCEL_REFUND error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (
    (id === FN.MATCH_SETTLE_SINGLE ||
      id === FN.MATCH_SETTLE_MARKET ||
      id === FN.MATCH_SETTLE_MULTI) &&
    req.method === "POST"
  ) {
    try {
      return sendTsrOk(
        res,
        await settleMatch(token, extractServerFnData(rawBody))
      );
    } catch (err) {
      console.error("[serverfn-shim] MATCH_SETTLE error", err);
      return sendTsrError(
        res,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (id === FN.BANNERS_REORDER && req.method === "POST") {
    try {
      const params = extractServerFnData(rawBody);
      return sendTsrOk(res, await reorderBanners(token, params));
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

  if (url.pathname === "/api/arbishield/transfer-desafio" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      const data = await transferRealToDesafio(token, body.data || body);
      return sendJson(res, 200, data);
    } catch (err) {
      return sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/desafio-deposits" && req.method === "GET") {
    try {
      const token = bearerFromReq(req);
      const data = await listDesafioDeposits(token);
      return sendJson(res, 200, data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return sendJson(res, /negado|Acesso/i.test(msg) ? 403 : 400, { error: msg });
    }
  }

  if (url.pathname === "/api/arbishield/desafio-deposit-approve" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      return sendJson(res, 200, await approveDesafioDeposit(token, body.data || body));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return sendJson(res, /negado|Acesso/i.test(msg) ? 403 : 400, { error: msg });
    }
  }

  if (url.pathname === "/api/arbishield/desafio-deposit-reject" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      return sendJson(res, 200, await rejectDesafioDeposit(token, body.data || body));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return sendJson(res, /negado|Acesso/i.test(msg) ? 403 : 400, { error: msg });
    }
  }

  if (url.pathname === "/api/arbishield/affiliate-ensure-code" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      const data = await ensureAffiliateReferralCode(token);
      return sendJson(res, 200, data);
    } catch (err) {
      return sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/affiliate-withdraw" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      const data = await requestAffiliateWithdrawal(token, body.data || body);
      return sendJson(res, 200, data);
    } catch (err) {
      return sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/desafio-register" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      return sendJson(res, 200, await registerDesafioEntry(token, body.data || body));
    } catch (err) {
      return sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/desafio-settle" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      return sendJson(res, 200, await settleDesafioStep(token, body.data || body));
    } catch (err) {
      return sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/desafio-delete" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      return sendJson(res, 200, await deleteDesafio(token, body.data || body));
    } catch (err) {
      const status = Number(err && err.status) || 400;
      return sendJson(res, status, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/desafio-cancel" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      return sendJson(res, 200, await cancelDesafio(token, body.data || body));
    } catch (err) {
      const status = Number(err && err.status) || 400;
      return sendJson(res, status, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (
    url.pathname === "/api/arbishield/desafio-pending-counts" &&
    req.method === "POST"
  ) {
    try {
      const token = bearerFromReq(req);
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      return sendJson(
        res,
        200,
        await listDesafioPendingCounts(token, body.data || body)
      );
    } catch (err) {
      return sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/desafio-participations" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      return sendJson(
        res,
        200,
        await listDesafioParticipations(token, body.data || body)
      );
    } catch (err) {
      return sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/partner-rounds" && req.method === "GET") {
    try {
      const token = bearerFromReq(req);
      return sendJson(res, 200, await listActivePartnerRounds(token));
    } catch (err) {
      return sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/partner-distribute" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      return sendJson(
        res,
        200,
        await distributePartnerYield(token, body.data || body)
      );
    } catch (err) {
      return sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/protection-close" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      return sendJson(
        res,
        200,
        await closeProtectionNoRefund(token, body.data || body)
      );
    } catch (err) {
      return sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/protection-cancel" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      return sendJson(
        res,
        200,
        await cancelProtectionRefund(token, body.data || body)
      );
    } catch (err) {
      return sendJson(res, 400, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (url.pathname === "/api/arbishield/match-settle" && req.method === "POST") {
    try {
      const token = bearerFromReq(req);
      const raw = await parseBody(req);
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = {};
      }
      return sendJson(res, 200, await settleMatch(token, body.data || body));
    } catch (err) {
      return sendJson(res, 400, {
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
