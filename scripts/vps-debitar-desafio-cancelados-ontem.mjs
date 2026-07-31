#!/usr/bin/env node
/**
 * Debita da carteira Desafio os valores reembolsados nos cancelamentos de ontem
 * (ajuste operacional pedido pelo admin).
 *
 * Relatório (dry-run):
 *   node scripts/vps-debitar-desafio-cancelados-ontem.mjs
 * Aplicar:
 *   FIX=1 node scripts/vps-debitar-desafio-cancelados-ontem.mjs
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const REASON = String(
  process.env.REASON ||
    "estorno reembolso desafios cancelados 30/07/2026 (ajuste admin)"
).trim();

/** Alvos: e-mail + prefixo id (da relação de cancelados) + valor a debitar */
const TARGETS = [
  {
    name: "William Oliveira",
    email: "williamoliveira02@outlook.com",
    idPrefix: "e01e074e",
    amount_cents: 30000, // R$ 300,00
  },
  {
    name: "JOÃO PAULO LEITE DE SOUZA RODRIGUES",
    email: "joaoplsrodrigues@gmail.com",
    idPrefix: "aba4de06",
    amount_cents: 28500, // R$ 285,00
  },
  {
    name: "Senilvo acri carvalho",
    email: "izypolzebets@gmail.com",
    idPrefix: "0008cd5a",
    amount_cents: 1000, // R$ 10,00
  },
  {
    name: "Gabriel Rocha",
    email: "xxmask11@gmail.com",
    idPrefix: "0a17461d",
    amount_cents: 1295, // R$ 12,95
  },
  {
    name: "JOSÉ HELENO DE SENA",
    email: "senabeto29@gmail.com",
    idPrefix: "2ce00ccd",
    amount_cents: 2000, // R$ 20,00
  },
];

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
  "/opt/arbishield/scripts/.env",
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

async function sb(p, { method = "GET", body, okNull = false } = {}) {
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
  if (!res.ok) {
    if (okNull) return null;
    throw new Error(`${res.status} ${p}: ${String(text).slice(0, 280)}`);
  }
  return data;
}

async function resolveUser(target) {
  // 1) Auth por e-mail
  let authUser = null;
  try {
    const q = encodeURIComponent(`email.eq.${target.email}`);
    const r = await sb(`/auth/v1/admin/users?${q}`, { okNull: true });
    const users = Array.isArray(r?.users) ? r.users : Array.isArray(r) ? r : [];
    authUser =
      users.find(
        (u) => String(u.email || "").toLowerCase() === target.email.toLowerCase()
      ) || null;
  } catch {
    /* */
  }

  // 2) Fallback: listagem + filtro (algumas builds do GoTrue não aceitam filter)
  if (!authUser) {
    for (let page = 1; page <= 20 && !authUser; page++) {
      const r = await sb(
        `/auth/v1/admin/users?page=${page}&per_page=200`,
        { okNull: true }
      );
      const users = Array.isArray(r?.users) ? r.users : [];
      if (!users.length) break;
      authUser =
        users.find(
          (u) =>
            String(u.email || "").toLowerCase() === target.email.toLowerCase()
        ) || null;
    }
  }

  let userId = authUser?.id || null;
  if (userId && target.idPrefix) {
    if (!String(userId).toLowerCase().startsWith(target.idPrefix.toLowerCase())) {
      console.warn(
        `  AVISO: id ${userId} não começa com ${target.idPrefix} (e-mail bateu) — seguindo pelo e-mail`
      );
    }
  }

  // 3) Fallback por prefixo no profiles
  if (!userId && target.idPrefix) {
    const rows = await sb(
      `/rest/v1/profiles?select=id,full_name,desafio_balance_cents,account_status&order=created_at.desc&limit=5000`
    ).catch(() => []);
    const pref = target.idPrefix.toLowerCase();
    const list = (Array.isArray(rows) ? rows : []).filter((r) =>
      String(r.id || "").toLowerCase().startsWith(pref)
    );
    if (list.length === 1) userId = list[0].id;
    else if (list.length > 1) {
      throw new Error(
        `vários profiles com prefixo ${target.idPrefix}: ${list.map((x) => x.id).join(", ")}`
      );
    }
  }

  if (!userId) {
    throw new Error(`usuário não encontrado: ${target.name} <${target.email}>`);
  }

  const profRows = await sb(
    `/rest/v1/profiles?select=id,full_name,desafio_balance_cents,balance_cents,account_status,updated_at&id=eq.${encodeURIComponent(userId)}&limit=1`
  );
  const profile = Array.isArray(profRows) ? profRows[0] : null;
  if (!profile) throw new Error(`profile ausente para ${userId}`);

  return {
    userId,
    email: authUser?.email || target.email,
    profile,
  };
}

async function main() {
  console.log("═".repeat(72));
  console.log("DÉBITO carteira DESAFIO · estorno reembolsos cancelamento 30/07");
  console.log("FIX:", FIX ? "SIM (aplica)" : "não (só simulação)");
  console.log("motivo:", REASON);
  console.log("═".repeat(72));

  const results = [];
  let totalDebit = 0;

  for (const t of TARGETS) {
    console.log(`\n▶ ${t.name}  ·  debitar ${money(t.amount_cents)}`);
    const { userId, email, profile } = await resolveUser(t);
    const before = n(profile.desafio_balance_cents);
    const take = Math.min(before, t.amount_cents);
    const after = Math.max(0, before - t.amount_cents);
    const shortfall = t.amount_cents - take;

    console.log(`  id: ${userId}`);
    console.log(`  e-mail: ${email}`);
    console.log(`  nome profile: ${profile.full_name || "—"}`);
    console.log(
      `  Desafio: ${money(before)} → ${money(after)}` +
        (shortfall > 0
          ? `  ⚠ saldo insuficiente (faltam ${money(shortfall)}; debitará ${money(take)})`
          : "")
    );

    if (FIX) {
      // Se saldo insuficiente, zera (não deixa negativo)
      const applied = Math.min(before, t.amount_cents);
      const newBal = before - applied;

      try {
        await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
          method: "PATCH",
          body: {
            desafio_balance_cents: newBal,
            updated_at: new Date().toISOString(),
          },
        });
      } catch {
        await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
          method: "PATCH",
          body: { desafio_balance_cents: newBal },
        });
      }

      try {
        await sb("/rest/v1/wallet_transactions", {
          method: "POST",
          body: {
            user_id: userId,
            type: "admin_adjustment_debit",
            amount_cents: -applied,
            metadata: {
              reason: REASON,
              wallet: "desafio",
              requested_cents: t.amount_cents,
              applied_cents: applied,
              shortfall_cents: Math.max(0, t.amount_cents - applied),
              desafio_before_cents: before,
              desafio_after_cents: newBal,
              source: "vps-debitar-desafio-cancelados-ontem",
              target_name: t.name,
              target_email: t.email,
            },
          },
        });
      } catch (e) {
        // fallback sem campos extras
        await sb("/rest/v1/wallet_transactions", {
          method: "POST",
          body: {
            user_id: userId,
            type: "admin_adjustment",
            amount_cents: -applied,
            metadata: {
              reason: REASON,
              wallet: "desafio",
              applied_cents: applied,
              desafio_before_cents: before,
              desafio_after_cents: newBal,
              source: "vps-debitar-desafio-cancelados-ontem",
            },
          },
        }).catch((e2) => {
          console.warn("  AVISO wallet_transactions:", e2.message || e2);
        });
        if (e) console.warn("  AVISO tx tipo debit:", e.message || e);
      }

      // releitura
      const again = await sb(
        `/rest/v1/profiles?select=desafio_balance_cents&id=eq.${encodeURIComponent(userId)}&limit=1`
      );
      const confirmed = n(Array.isArray(again) ? again[0]?.desafio_balance_cents : newBal);
      console.log(`  OK debitado ${money(applied)} → Desafio agora ${money(confirmed)}`);
      results.push({
        name: t.name,
        email,
        user_id: userId,
        requested_cents: t.amount_cents,
        applied_cents: applied,
        before_cents: before,
        after_cents: confirmed,
      });
      totalDebit += applied;
    } else {
      results.push({
        name: t.name,
        email,
        user_id: userId,
        requested_cents: t.amount_cents,
        applied_cents: take,
        before_cents: before,
        after_cents: after,
      });
      totalDebit += take;
    }
  }

  console.log("\n" + "═".repeat(72));
  console.log("LISTA ATUALIZADA · carteira Desafio");
  console.log("─".repeat(72));
  for (const r of results) {
    console.log(
      `${r.name.padEnd(36).slice(0, 36)}  debitar ${money(r.requested_cents).padStart(12)}  ` +
        `${money(r.before_cents)} → ${money(r.after_cents)}`
    );
    console.log(`  ${r.email}  ·  ${r.user_id.slice(0, 8)}…`);
  }
  console.log("─".repeat(72));
  console.log(
    `Total a debitar/debitado: ${money(totalDebit)}  ·  ${results.length} cliente(s)`
  );
  if (!FIX) {
    console.log("\nPara aplicar de verdade:");
    console.log(
      "  FIX=1 node /opt/arbishield/scripts/vps-debitar-desafio-cancelados-ontem.mjs"
    );
  }
  console.log("OK");
}

main().catch((e) => {
  console.error("ERRO:", e instanceof Error ? e.message : e);
  process.exit(1);
});
