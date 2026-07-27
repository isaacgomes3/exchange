#!/usr/bin/env node
/**
 * FORCE reparo Carlos — stake do último jogo não voltou.
 *
 * Sempre deixa:
 *   Apostador = R$ 8.976,41  (8.067,52 + 1.000 − 91,11)
 *   Congelado = R$ 0,00
 *   Reembolso = R$ 0,00 (Exchange)
 *
 * Fingerprint do print: Desafio R$ 2.272,11
 *
 * Na VPS:
 *   node scripts/vps-force-carlos-897641.mjs
 *   FIX=1 node scripts/vps-force-carlos-897641.mjs
 *   USER_ID=... FIX=1 node scripts/vps-force-carlos-897641.mjs
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const USER_ID_ENV = String(process.env.USER_ID || "").trim();
const NAME = String(process.env.NAME || "Carlos Roberto").trim();
const TARGET = Math.trunc(Number(process.env.TARGET_BALANCE_CENTS || 897_641));
const DESAFIO_HINT = Math.trunc(Number(process.env.DESAFIO_CENTS || 227_211));
const TAG = "force-carlos-897641-v9c";

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return false;
  let n = 0;
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
    if (!(key in process.env) || process.env[key] === "") {
      process.env[key] = val;
      n++;
    }
  }
  console.log("  env:", file, `(${n} keys)`);
  return true;
}

console.log("==> FORCE Carlos →", (TARGET / 100).toFixed(2), FIX ? "FIX=1" : "dry-run");
let envOk = false;
for (const f of [
  process.env.ENV_FILE,
  "/opt/arbishield/deploy/vps-supabase/.env",
  "/opt/arbishield/.env",
  "/opt/arbishield/scripts/.env",
  "/root/.arbishield.env",
  path.resolve("deploy/vps-supabase/.env"),
  path.resolve(".env"),
].filter(Boolean)) {
  if (loadEnvFile(f)) envOk = true;
}
if (!envOk) console.warn("  AVISO: nenhum .env");

const SERVICE_KEY =
  process.env.ARBISHIELD_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "";
const SUPABASE_URL = (
  process.env.ARBISHIELD_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  process.env.API_EXTERNAL_URL ||
  "http://127.0.0.1:8000"
).replace(/\/$/, "");

console.log("  URL:", SUPABASE_URL);
console.log("  KEY:", SERVICE_KEY ? `${SERVICE_KEY.slice(0, 8)}…` : "AUSENTE");
if (!SERVICE_KEY) {
  console.error("ERRO: SERVICE_ROLE_KEY ausente");
  process.exit(1);
}

function money(c) {
  return (Number(c || 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? Math.trunc(x) : 0;
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
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${res.status} ${p}\n${String(text).slice(0, 800)}`);
  return data;
}

const SEL =
  "id,full_name,balance_cents,locked_balance_cents,deduction_balance_cents,reusable_balance_cents,desafio_balance_cents,updated_at";

async function loadAllCandidates() {
  const seen = new Set();
  const out = [];
  async function add(label, path) {
    try {
      const rows = await sb(path);
      let c = 0;
      for (const p of Array.isArray(rows) ? rows : []) {
        if (!p?.id || seen.has(p.id)) continue;
        seen.add(p.id);
        out.push(p);
        c++;
      }
      console.log(`  +${c} via ${label}`);
    } catch (e) {
      console.warn("  skip", label, e.message || e);
    }
  }

  if (USER_ID_ENV) {
    await add("USER_ID", `/rest/v1/profiles?id=eq.${encodeURIComponent(USER_ID_ENV)}&select=${SEL}`);
  }
  await add(
    "nome",
    `/rest/v1/profiles?full_name=ilike.*${encodeURIComponent(NAME)}*&select=${SEL}&limit=50`
  );
  await add(
    "Carlos*",
    `/rest/v1/profiles?full_name=ilike.*Carlos*&select=${SEL}&order=locked_balance_cents.desc&limit=50`
  );
  await add(
    "desafio=227211",
    `/rest/v1/profiles?desafio_balance_cents=eq.${DESAFIO_HINT}&select=${SEL}&limit=20`
  );
  await add(
    "locked>0",
    `/rest/v1/profiles?locked_balance_cents=gt.0&select=${SEL}&order=locked_balance_cents.desc&limit=30`
  );
  await add(
    "bal=806752",
    `/rest/v1/profiles?balance_cents=eq.806752&select=${SEL}&limit=20`
  );
  await add(
    "bal=897141",
    `/rest/v1/profiles?balance_cents=eq.897141&select=${SEL}&limit=10`
  );
  await add(
    "bal=898252",
    `/rest/v1/profiles?balance_cents=eq.898252&select=${SEL}&limit=10`
  );
  await add(
    "bal=897641",
    `/rest/v1/profiles?balance_cents=eq.897641&select=${SEL}&limit=10`
  );
  return out;
}

function score(p) {
  const name = String(p.full_name || "").toLowerCase();
  let s = 0;
  if (name.includes("carlos")) s += 20;
  if (name.includes("roberto")) s += 20;
  if (n(p.desafio_balance_cents) === DESAFIO_HINT) s += 100;
  if (n(p.locked_balance_cents) > 0) s += 40;
  if (n(p.locked_balance_cents) === 100_000) s += 30;
  const bal = n(p.balance_cents);
  if ([806_752, 897_141, 898_252, 897_641].includes(bal)) s += 25;
  if (USER_ID_ENV && p.id === USER_ID_ENV) s += 1000;
  return s;
}

async function dumpProts(userId) {
  const sel =
    "id,status,settled_outcome,amount_cents,responsibility_cents,platform_deduction_cents,odd,created_at,updated_at";
  const lay = await sb(
    `/rest/v1/protections?user_id=eq.${encodeURIComponent(userId)}&select=${sel}&order=updated_at.desc&limit=8`
  ).catch(() => []);
  const back = await sb(
    `/rest/v1/back_protections?user_id=eq.${encodeURIComponent(userId)}&select=${sel}&order=updated_at.desc&limit=8`
  ).catch(() => []);
  const all = [
    ...(Array.isArray(lay) ? lay.map((r) => ({ ...r, t: "protections" })) : []),
    ...(Array.isArray(back) ? back.map((r) => ({ ...r, t: "back_protections" })) : []),
  ].sort(
    (a, b) =>
      new Date(b.updated_at || 0) - new Date(a.updated_at || 0)
  );
  console.log("  proteções:");
  for (const p of all.slice(0, 6)) {
    console.log(
      "   ",
      p.t,
      p.id.slice(0, 8),
      p.status,
      p.settled_outcome || "-",
      money(p.responsibility_cents || p.amount_cents),
      "fee",
      money(p.platform_deduction_cents)
    );
  }
  return all;
}

async function main() {
  const cands = await loadAllCandidates();
  if (!cands.length) {
    console.error("ERRO: nenhum candidato encontrado");
    process.exit(1);
  }

  const ranked = cands
    .map((p) => ({ p, s: score(p) }))
    .sort((a, b) => b.s - a.s);

  console.log("\n==> Candidatos (top 10):");
  for (const { p, s } of ranked.slice(0, 10)) {
    console.log(
      `  [${s}] ${p.id} | ${p.full_name || "-"} | Real ${money(p.balance_cents)} | Cong ${money(p.locked_balance_cents)} | Reemb ${money(p.deduction_balance_cents)} | Desafio ${money(p.desafio_balance_cents)}`
    );
  }

  const best = ranked[0];
  if (!best || best.s < 20) {
    console.error("ERRO: score baixo — passe USER_ID= do Carlos");
    process.exit(2);
  }
  const user = best.p;
  console.log("\n==> ESCOLHIDO:", user.id, user.full_name, "score", best.s);
  await dumpProts(user.id);

  const before = {
    bal: n(user.balance_cents),
    locked: n(user.locked_balance_cents),
    reemb: n(user.deduction_balance_cents),
  };
  console.log("\n==> ANTES");
  console.log("  Apostador", money(before.bal));
  console.log("  Congelado", money(before.locked));
  console.log("  Reembolso", money(before.reemb));
  console.log("  ALVO     ", money(TARGET), "+ Congelado 0");

  if (before.bal === TARGET && before.locked === 0) {
    console.log("\nOK — já está no alvo. Se a tela mostra outro valor: hard refresh / limpar cache.");
    return;
  }

  const delta = TARGET - before.bal;
  console.log("\n==> PLANO PATCH");
  console.log("  balance_cents:", before.bal, "→", TARGET, `(delta ${money(delta)})`);
  console.log("  locked_balance_cents:", before.locked, "→ 0");

  if (!FIX) {
    console.log("\nDry-run. Para aplicar:");
    console.log("  FIX=1 node scripts/vps-force-carlos-897641.mjs");
    if (!USER_ID_ENV) console.log("  USER_ID=" + user.id + " FIX=1 node scripts/vps-force-carlos-897641.mjs");
    return;
  }

  // PATCH agressivo (2 tentativas)
  for (let i = 1; i <= 2; i++) {
    console.log(`\n  PATCH #${i}...`);
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      body: {
        balance_cents: TARGET,
        locked_balance_cents: 0,
        reusable_balance_cents: 0,
        updated_at: new Date().toISOString(),
      },
    });
    const check = await sb(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=${SEL}&limit=1`
    );
    const row = Array.isArray(check) ? check[0] : null;
    console.log(
      "  agora: Real",
      money(row?.balance_cents),
      "Cong",
      money(row?.locked_balance_cents)
    );
    if (n(row?.balance_cents) === TARGET && n(row?.locked_balance_cents) === 0) {
      try {
        await sb(`/rest/v1/wallet_transactions`, {
          method: "POST",
          body: {
            user_id: user.id,
            amount_cents: delta,
            type: delta >= 0 ? "credit" : "debit",
            description:
              "FORCE: devolve stake último jogo Exchange + cobra só R$91,11 → Apostador R$8.976,41",
            metadata: {
              repair_tag: TAG,
              tag: TAG,
              before_balance_cents: before.bal,
              before_locked_cents: before.locked,
              target_cents: TARGET,
              delta_cents: delta,
            },
          },
        });
      } catch (e) {
        console.warn("  tx skip:", e.message || e);
      }

      console.log("\n========== VERIFY ==========");
      console.log("  Apostador :", money(row.balance_cents), "← deve ser R$ 8.976,41");
      console.log("  Congelado :", money(row.locked_balance_cents), "← deve ser R$ 0,00");
      console.log("  Reembolso :", money(row.deduction_balance_cents), "← Exchange = R$ 0");
      console.log("  user_id   :", user.id);
      console.log("============================");
      console.log("OK — hard refresh (Ctrl+Shift+R) no Financeiro / Espelho.");
      return;
    }
  }

  console.error("FALHA: PATCH não fixou o saldo. Cole a saída acima.");
  process.exit(1);
}

main().catch((e) => {
  console.error("ERRO:", e.message || e);
  process.exit(1);
});
