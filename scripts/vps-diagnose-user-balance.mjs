#!/usr/bin/env node
/**
 * Diagnóstico de saldo de um usuário (VPS, com SERVICE_ROLE).
 *
 *   EMAIL=user@email.com node scripts/vps-diagnose-user-balance.mjs
 *   USER_ID=b6eb155d-... node scripts/vps-diagnose-user-balance.mjs
 *   NAME="LUIZ PAULO" node scripts/vps-diagnose-user-balance.mjs
 *   ID_PREFIX=b6eb155d node scripts/vps-diagnose-user-balance.mjs
 *
 *   FIX_OVERCREDIT=1 EMAIL=... node scripts/vps-diagnose-user-balance.mjs
 */
import fs from "node:fs";
import path from "node:path";

const EMAIL = String(process.env.EMAIL || "").trim().toLowerCase();
const USER_ID = String(process.env.USER_ID || process.env.ID || "").trim();
const ID_PREFIX = String(process.env.ID_PREFIX || "").trim().toLowerCase();
const NAME = String(process.env.NAME || process.env.FULL_NAME || "").trim();
const FIX_OVERCREDIT =
  process.env.FIX_OVERCREDIT === "1" || process.env.FIX_OVERCREDIT === "true";

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env) || process.env[key] === "") process.env[key] = val;
  }
}

for (const f of [
  process.env.ENV_FILE,
  "/opt/arbishield/deploy/vps-supabase/.env",
  "/opt/arbishield/.env",
  path.resolve("deploy/vps-supabase/.env"),
  path.resolve(".env"),
].filter(Boolean)) {
  loadEnvFile(f);
}

const SERVICE_KEY =
  process.env.ARBISHIELD_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = (
  process.env.ARBISHIELD_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  process.env.API_EXTERNAL_URL ||
  "http://127.0.0.1:8000"
).replace(/\/$/, "");

if (!SERVICE_KEY) {
  console.error("ERRO: SERVICE_ROLE_KEY ausente");
  process.exit(1);
}
if (!EMAIL && !USER_ID && !ID_PREFIX && !NAME) {
  console.error(
    "Informe EMAIL=... ou USER_ID=... ou ID_PREFIX=... ou NAME=..."
  );
  process.exit(1);
}

function money(cents) {
  return (Number(cents || 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
function n(v) {
  return Number(v || 0);
}

async function sb(p, { okNull = false, method = "GET", body } = {}) {
  const res = await fetch(`${SUPABASE_URL}${p}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      ...(body
        ? { "Content-Type": "application/json", Prefer: "return=representation" }
        : {}),
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
    if (okNull) return null;
    throw new Error(`${res.status} ${p}: ${text.slice(0, 240)}`);
  }
  return data;
}

async function sbTry(paths) {
  let last = null;
  for (const p of paths) {
    try {
      return await sb(p);
    } catch (e) {
      last = e;
    }
  }
  if (last) throw last;
  return null;
}

async function findAuthUserByEmail(email) {
  for (let page = 1; page <= 40; page++) {
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=200`,
      {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
      }
    );
    const data = await res.json();
    const users = data?.users || data || [];
    if (!Array.isArray(users) || !users.length) break;
    const hit = users.find(
      (u) => String(u.email || "").toLowerCase() === email
    );
    if (hit) return hit;
    if (users.length < 200) break;
  }
  return null;
}

async function findAuthUserById(id) {
  const res = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(id)}`,
    {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
    }
  );
  if (!res.ok) return null;
  return res.json();
}

async function resolveProfile() {
  if (USER_ID) {
    const rows = await sb(
      `/rest/v1/profiles?select=*&id=eq.${encodeURIComponent(USER_ID)}&limit=1`
    );
    const p = Array.isArray(rows) ? rows[0] : null;
    if (!p) throw new Error(`profiles sem id=${USER_ID}`);
    return p;
  }

  if (ID_PREFIX) {
    // uuid não aceita ilike no PostgREST — busca amostra e filtra no JS
    const rows = await sb(
      `/rest/v1/profiles?select=id,full_name,account_status,balance_cents,reusable_balance_cents,demo_balance_cents,investor_balance_cents,demo_balance_provider_cents,desafio_balance_cents,locked_balance_cents,debited_balance_cents,total_profit_cents,updated_at,created_at&order=created_at.desc&limit=5000`
    );
    const list = (Array.isArray(rows) ? rows : []).filter((r) =>
      String(r.id || "").toLowerCase().startsWith(ID_PREFIX)
    );
    if (!list.length) {
      throw new Error(`nenhum profile com id começando em ${ID_PREFIX}`);
    }
    if (list.length > 1) {
      console.log("Vários matches por ID_PREFIX — usando o mais recente:");
      for (const r of list) {
        console.log(
          `  ${r.id}  ${r.full_name || "—"}  ${money(r.balance_cents)}`
        );
      }
    }
    const full = await sb(
      `/rest/v1/profiles?select=*&id=eq.${encodeURIComponent(list[0].id)}&limit=1`
    );
    return Array.isArray(full) ? full[0] : list[0];
  }

  if (NAME) {
    const q = encodeURIComponent("%" + NAME + "%");
    const rows = await sb(
      `/rest/v1/profiles?select=*&full_name=ilike.${q}&order=created_at.desc&limit=20`
    );
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) throw new Error(`nenhum profile com nome ~ ${NAME}`);
    if (list.length > 1) {
      console.log(
        `Vários matches por NAME="${NAME}" — usando o 1º (mais recente):`
      );
      for (const r of list) {
        console.log(
          `  ${r.id}  ${r.full_name || "—"}  status=${r.account_status || "—"}  balance=${money(r.balance_cents)}`
        );
      }
    }
    return list[0];
  }

  const auth = await findAuthUserByEmail(EMAIL);
  if (!auth) throw new Error(`Auth sem email=${EMAIL}`);
  const rows = await sb(
    `/rest/v1/profiles?select=*&id=eq.${encodeURIComponent(auth.id)}&limit=1`
  );
  const p = Array.isArray(rows) ? rows[0] : null;
  if (!p) throw new Error(`Sem profiles para ${EMAIL} (${auth.id})`);
  p.__auth = auth;
  return p;
}

async function main() {
  console.log("==> Diagnóstico saldo");
  console.log("    SUPABASE_URL:", SUPABASE_URL);
  console.log(
    "    lookup:",
    USER_ID
      ? `USER_ID=${USER_ID}`
      : ID_PREFIX
        ? `ID_PREFIX=${ID_PREFIX}`
        : NAME
          ? `NAME=${NAME}`
          : `EMAIL=${EMAIL}`
  );

  const p = await resolveProfile();
  const id = p.id;
  console.log("    profile.id:", id);
  console.log("    full_name:", p.full_name || "—");
  console.log("    account_status:", p.account_status || "—");

  let auth = p.__auth || null;
  if (!auth) auth = await findAuthUserById(id);
  if (auth) {
    console.log("    email:", auth.email || "—");
    console.log("    confirmed:", !!auth.email_confirmed_at);
    console.log("    last_sign_in:", auth.last_sign_in_at || "—");
  } else {
    console.log("    email: (auth não encontrado)");
  }

  const real = n(p.balance_cents) + n(p.reusable_balance_cents);
  const apostador = real + n(p.demo_balance_cents);
  const provedor =
    n(p.investor_balance_cents) + n(p.demo_balance_provider_cents);

  console.log("\n==> Buckets profiles");
  for (const k of [
    "full_name",
    "balance_cents",
    "reusable_balance_cents",
    "demo_balance_cents",
    "investor_balance_cents",
    "demo_balance_provider_cents",
    "desafio_balance_cents",
    "locked_balance_cents",
    "debited_balance_cents",
    "total_profit_cents",
    "updated_at",
    "created_at",
  ]) {
    const v = p[k];
    if (String(k).endsWith("_cents")) {
      console.log(`  ${k}: ${v} (${money(v)})`);
    } else {
      console.log(`  ${k}: ${v}`);
    }
  }

  console.log("\n==> Como a UI soma");
  console.log(
    `  ADM Usuários (só balance_cents): ${money(p.balance_cents)}  ← o que aparece na lista`
  );
  console.log(`  Saldo Real (balance+reusable): ${money(real)}`);
  console.log(`  Chip Apostador (real+demo): ${money(apostador)}`);
  console.log(`  Provedor: ${money(provedor)}`);
  console.log(`  Desafio: ${money(p.desafio_balance_cents)}`);
  console.log(
    `  Soma todos buckets livres: ${money(apostador + provedor + n(p.desafio_balance_cents))}`
  );
  if (n(p.demo_balance_cents) > 0) {
    console.log("  ⚠ demo_balance_cents > 0 — chip Apostador inclui demo");
  }
  if (n(p.reusable_balance_cents) > 0) {
    console.log(
      "  ⚠ reusable_balance_cents > 0 — ADM lista NÃO soma isso; cliente sim"
    );
  }
  if (n(p.desafio_balance_cents) > 0) {
    console.log("  ⚠ Desafio separado — não entra no chip Apostador");
  }

  const prots = await sb(
    `/rest/v1/protections?select=id,status,amount_cents,responsibility_cents,result,created_at,settled_at&user_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=100`
  );
  const protRows = Array.isArray(prots) ? prots : [];
  const active = protRows.filter(
    (r) => String(r.status || "").toLowerCase() === "active"
  );
  const activeLocked = active.reduce(
    (a, r) => a + n(r.responsibility_cents || r.amount_cents),
    0
  );
  console.log("\n==> Proteções");
  console.log(`  total listadas (100): ${protRows.length}`);
  console.log(
    `  ativas: ${active.length} · capital ativo: ${money(activeLocked)}`
  );
  console.log("  últimas 15:");
  for (const r of protRows.slice(0, 15)) {
    console.log(
      `    ${r.created_at}  ${String(r.status).padEnd(14)} ${money(r.amount_cents)}  ${r.result || "—"}  ${String(r.id).slice(0, 8)}`
    );
  }

  const deps = await sb(
    `/rest/v1/manual_deposits?select=id,amount_cents,status,network,deposit_type,admin_notes,created_at&user_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=50`
  );
  console.log("\n==> manual_deposits (até 50)");
  let approvedSum = 0;
  for (const d of Array.isArray(deps) ? deps : []) {
    if (String(d.status || "").toUpperCase() === "APPROVED") {
      approvedSum += n(d.amount_cents);
    }
    console.log(
      `  ${d.created_at}  ${String(d.status).padEnd(14)} ${money(d.amount_cents)}  ${d.network || "—"}  ${d.deposit_type || ""}`
    );
  }
  console.log(`  soma APPROVED (amostra): ${money(approvedSum)}`);

  console.log("\n==> wallet_transactions (até 200)");
  let allTx = [];
  try {
    allTx = await sbTry([
      `/rest/v1/wallet_transactions?select=id,type,amount_cents,metadata,ref,created_at,balance_after_cents&user_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=200`,
      `/rest/v1/wallet_transactions?select=id,type,amount_cents,metadata,ref,created_at&user_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=200`,
      `/rest/v1/wallet_transactions?select=id,type,amount_cents,created_at&user_id=eq.${encodeURIComponent(id)}&order=created_at.desc&limit=200`,
    ]);
    if (!Array.isArray(allTx)) allTx = [];
    const byType = new Map();
    for (const t of allTx) {
      const ty = String(t.type || "?");
      byType.set(ty, (byType.get(ty) || 0) + n(t.amount_cents));
    }
    console.log("  soma por tipo (amostra):");
    for (const [ty, sum] of [...byType.entries()].sort(
      (a, b) => Math.abs(b[1]) - Math.abs(a[1])
    )) {
      console.log(`    ${ty.padEnd(24)} ${money(sum)}`);
    }
    const net = allTx.reduce((a, t) => a + n(t.amount_cents), 0);
    console.log(`  net amostra wallet_tx: ${money(net)}`);
    console.log("  últimas 30:");
    for (const t of allTx.slice(0, 30)) {
      const extra =
        t.metadata != null
          ? JSON.stringify(t.metadata).slice(0, 70)
          : t.ref || "";
      console.log(
        `  ${t.created_at}  ${String(t.type || "").padEnd(22)} ${money(t.amount_cents)}  ${extra}`
      );
    }
    if (allTx.length > 30) console.log(`  … +${allTx.length - 30} mais`);
  } catch (e) {
    console.log("  falhou:", e.message || e);
  }

  console.log("\n==> Auditoria estornos duplicados (bug F5 / contest_list)");
  const refunds = allTx.filter(
    (t) => String(t.type || "").toLowerCase() === "protection_refund"
  );
  const byProt = new Map();
  for (const t of refunds) {
    const pid =
      (t.ref && String(t.ref)) ||
      (t.metadata && String(t.metadata.protection_id || "")) ||
      "";
    const key = pid || `orphan:${t.id}`;
    if (!byProt.has(key)) byProt.set(key, []);
    byProt.get(key).push(t);
  }
  let overcredit = 0;
  const offenders = [];
  for (const [pid, list] of byProt) {
    if (list.length <= 1) continue;
    const sum = list.reduce((a, t) => a + n(t.amount_cents), 0);
    const once = Math.max(...list.map((t) => n(t.amount_cents)));
    const excess = Math.max(0, sum - once);
    if (excess <= 0) continue;
    overcredit += excess;
    offenders.push({ pid, count: list.length, sum, once, excess });
    console.log(
      `  ⚠ proteção ${pid}: ${list.length}x refund · soma ${money(sum)} · legítimo ~${money(once)} · EXCESSO ${money(excess)}`
    );
  }
  if (!offenders.length) {
    console.log("  nenhum estorno duplicado detectado na amostra");
  } else {
    console.log(`  TOTAL OVERCREDIT: ${money(overcredit)}`);
    console.log(
      `  Saldo atual Apostador: ${money(apostador)} → saldo corrigido sugerido: ${money(Math.max(0, apostador - overcredit))}`
    );
  }

  if (FIX_OVERCREDIT && overcredit > 0) {
    const nextBal = Math.max(0, n(p.balance_cents) - overcredit);
    console.log(
      `\n==> FIX_OVERCREDIT=1 — debitando ${money(overcredit)} de balance_cents (${money(p.balance_cents)} → ${money(nextBal)})`
    );
    try {
      await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: {
          balance_cents: nextBal,
          updated_at: new Date().toISOString(),
        },
      });
      console.log("  OK");
    } catch {
      await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: { balance_cents: nextBal },
      });
      console.log("  OK (sem updated_at)");
    }
    try {
      await sb(`/rest/v1/wallet_transactions`, {
        method: "POST",
        body: {
          user_id: id,
          type: "balance_correction",
          amount_cents: -overcredit,
          metadata: {
            reason: "clawback_duplicate_protection_refund_f5",
            offenders,
            email: auth?.email || EMAIL || null,
            name: p.full_name || null,
          },
        },
      });
    } catch {
      /* */
    }
  } else if (overcredit > 0) {
    const key = auth?.email ? `EMAIL=${auth.email}` : `USER_ID=${id}`;
    console.log(
      `\n  Para corrigir o saldo inflado na VPS:\n  FIX_OVERCREDIT=1 ${key} node scripts/vps-diagnose-user-balance.mjs`
    );
  }

  console.log("\nOK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
