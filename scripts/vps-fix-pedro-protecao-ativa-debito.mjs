#!/usr/bin/env node
/**
 * Pedro Iuri — proteção ativa sem débito/lock no saldo.
 *
 * Relatório:
 *   node scripts/vps-fix-pedro-protecao-ativa-debito.mjs
 * Aplicar débito faltante + locked (sempre debita gap locked < ativo):
 *   FIX=1 node scripts/vps-fix-pedro-protecao-ativa-debito.mjs
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const ID_PREFIX = String(process.env.ID_PREFIX || "24037bdf").trim().toLowerCase();
const NAME = String(
  process.env.NAME || "PEDRO IURI TEIXEIRA DOS SANTOS"
).trim();

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
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

function money(cents) {
  return (Number(cents || 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
function n(v) {
  return Number(v || 0);
}

async function sb(p, { method = "GET", body } = {}) {
  const res = await fetch(`${SUPABASE_URL}${p}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
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
  if (!res.ok) throw new Error(`${res.status} ${p}: ${String(text).slice(0, 300)}`);
  return data;
}

function isActive(st) {
  return ["active", "pending", "review_odd"].includes(String(st || "").toLowerCase());
}

async function main() {
  console.log("==> Pedro — proteção ativa vs débito/lock");
  console.log("    FIX:", FIX ? "SIM" : "não (só relatório)");

  const all = await sb(
    `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,locked_balance_cents,demo_balance_cents&order=created_at.desc&limit=5000`
  );
  let user = (Array.isArray(all) ? all : []).find((r) =>
    String(r.id || "").toLowerCase().startsWith(ID_PREFIX)
  );
  if (!user) {
    const q = encodeURIComponent("%" + NAME + "%");
    const byName = await sb(
      `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,locked_balance_cents,demo_balance_cents&full_name=ilike.${q}&limit=5`
    );
    user = Array.isArray(byName) ? byName[0] : null;
  }
  if (!user) throw new Error("Pedro não encontrado");

  const bal = n(user.balance_cents);
  const reusable = n(user.reusable_balance_cents);
  const locked = n(user.locked_balance_cents);
  const apostador = bal + reusable + n(user.demo_balance_cents);

  console.log("\n  user:", user.id);
  console.log("  nome:", user.full_name);
  console.log("  real:", money(bal));
  console.log("  reutil:", money(reusable));
  console.log("  locked:", money(locked));
  console.log("  Apostador (chip):", money(apostador));

  const lays = await sb(
    `/rest/v1/protections?select=id,match_id,status,odd,amount_cents,responsibility_cents,created_at,settled_at,settled_outcome&user_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=100`
  );
  const backs = await sb(
    `/rest/v1/back_protections?select=id,match_id,status,odd,amount_cents,responsibility_cents,created_at,settled_at,settled_outcome&user_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=100`
  ).catch(() => []);

  const rows = []
    .concat((Array.isArray(lays) ? lays : []).map((r) => ({ ...r, _side: "LAY" })))
    .concat((Array.isArray(backs) ? backs : []).map((r) => ({ ...r, _side: "BACK" })));

  const active = rows.filter((r) => isActive(r.status));
  console.log(`\n==> Proteções ativas: ${active.length}`);

  let needDebit = 0;
  const missingLockTx = [];

  for (const row of active) {
    const stake = n(row.responsibility_cents || row.amount_cents);
    const matchRows = await sb(
      `/rest/v1/matches?select=id,home_team,away_team,starts_at,status,final_score&id=eq.${encodeURIComponent(row.match_id || "")}&limit=1`
    ).catch(() => []);
    const m = Array.isArray(matchRows) ? matchRows[0] : null;
    const jogo = m
      ? `${m.home_team || "?"} × ${m.away_team || "?"}`
      : row.match_id || "?";

    const txs = await sb(
      `/rest/v1/wallet_transactions?select=id,type,amount_cents,created_at,metadata,ref&user_id=eq.${encodeURIComponent(user.id)}&or=(ref.eq.${encodeURIComponent(row.id)},metadata->>protection_id.eq.${encodeURIComponent(row.id)})&order=created_at.asc&limit=30`
    ).catch(async () => {
      const allTx = await sb(
        `/rest/v1/wallet_transactions?select=id,type,amount_cents,created_at,metadata,ref&user_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=400`
      );
      return (Array.isArray(allTx) ? allTx : []).filter(
        (t) =>
          String(t.ref || "") === String(row.id) ||
          (t.metadata && String(t.metadata.protection_id || "") === String(row.id))
      );
    });

    const tlist = Array.isArray(txs) ? txs : [];
    const hasLock = tlist.some((t) =>
      ["protection_lock", "anchor_lock"].includes(String(t.type || ""))
    );

    console.log("\n—", row.id);
    console.log(`  ${row._side}  ${jogo}  odd=${row.odd}  stake=${money(stake)}  status=${row.status}`);
    console.log(`  created=${row.created_at}`);
    console.log(`  lock_tx=${hasLock ? "SIM" : "NÃO"}`);
    for (const t of tlist) {
      console.log(`    ${t.created_at}  ${t.type}  ${money(t.amount_cents)}`);
    }

    if (!hasLock) {
      needDebit += stake;
      missingLockTx.push({ row, stake, jogo });
      console.log("  ⚠ ativa SEM protection_lock no ledger");
    }
  }

  const activeStake = active.reduce(
    (s, r) => s + n(r.responsibility_cents || r.amount_cents),
    0
  );

  console.log("\n========== RESUMO ==========");
  console.log("  stake ativo total:", money(activeStake));
  console.log("  locked no profile:", money(locked));
  console.log("  gap locked:", money(Math.max(0, activeStake - locked)));
  console.log("  ativos sem lock_tx:", missingLockTx.length, money(needDebit));
  console.log(
    "  Apostador deveria ser ~",
    money(Math.max(0, apostador - Math.max(0, activeStake - locked)))
  );

  // Se locked < stake ativo, o dinheiro voltou pro real (ex.: clawback) —
  // SEMPRE debitar o gap do balance e alinhar locked. Não basta só subir locked.
  const lockGap = Math.max(0, activeStake - locked);
  const debitCents = Math.max(needDebit, lockGap);

  if (debitCents <= 0) {
    console.log("\n  Nada a corrigir (débito/lock ok).");
    console.log("OK");
    return;
  }

  if (!FIX) {
    console.log("\n  Para debitar", money(debitCents), "do real e locked →", money(activeStake));
    console.log(
      "  FIX=1 ID_PREFIX=24037bdf node scripts/vps-fix-pedro-protecao-ativa-debito.mjs"
    );
    console.log("OK");
    return;
  }

  let nextBal = bal;
  let nextLocked = locked;

  if (nextBal < debitCents) {
    throw new Error(
      `Saldo real ${money(nextBal)} < débito ${money(debitCents)} — abortado`
    );
  }
  nextBal -= debitCents;
  nextLocked = activeStake;
  console.log(
    "\n==> Debitando",
    money(debitCents),
    "do real → Apostador",
    money(nextBal + reusable + n(user.demo_balance_cents)),
    "| locked",
    money(nextLocked)
  );

  try {
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      body: {
        balance_cents: nextBal,
        locked_balance_cents: nextLocked,
        updated_at: new Date().toISOString(),
      },
    });
  } catch {
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      body: {
        balance_cents: nextBal,
        locked_balance_cents: nextLocked,
      },
    });
  }

  await sb("/rest/v1/wallet_transactions", {
    method: "POST",
    body: {
      user_id: user.id,
      type: "admin_adjustment",
      amount_cents: -debitCents,
      metadata: {
        reason: "débito proteção ativa (saldo tinha voltado sem locked)",
        active_stake_cents: activeStake,
        lock_gap_cents: lockGap,
        before_real_cents: bal,
        after_real_cents: nextBal,
        fix: "vps-fix-pedro-protecao-ativa-debito-v2",
      },
    },
  });

  for (const item of missingLockTx) {
    await sb("/rest/v1/wallet_transactions", {
      method: "POST",
      body: {
        user_id: user.id,
        type: item.row._side === "BACK" ? "protection_lock" : "anchor_lock",
        amount_cents: -Math.abs(item.stake),
        ref: item.row.id,
        metadata: {
          protection_id: item.row.id,
          match_id: item.row.match_id || null,
          reason: "clawback_debito_protecao_ativa_faltante",
          fix: "vps-fix-pedro-protecao-ativa-debito-v2",
          jogo: item.jogo,
        },
      },
    });
    console.log("  lock_tx", item.row.id.slice(0, 8), money(item.stake));
  }

  const refreshed = await sb(
    `/rest/v1/profiles?select=balance_cents,reusable_balance_cents,locked_balance_cents,demo_balance_cents&id=eq.${encodeURIComponent(user.id)}&limit=1`
  );
  const p2 = Array.isArray(refreshed) ? refreshed[0] : null;
  console.log("\n==> Saldo final");
  console.log("  real:", money(p2?.balance_cents));
  console.log("  reutil:", money(p2?.reusable_balance_cents));
  console.log("  locked:", money(p2?.locked_balance_cents));
  console.log(
    "  Apostador:",
    money(n(p2?.balance_cents) + n(p2?.reusable_balance_cents) + n(p2?.demo_balance_cents))
  );
  console.log("OK");
}

main().catch((e) => {
  console.error("FALHA:", e.message || e);
  process.exit(1);
});
