#!/usr/bin/env node
/**
 * FORCE Apostador Carlos → R$ 9.051,71 (bilhete Sport×Cuiabá LAY@32)
 *
 * Print atual (errado): Apostador R$ 8.976,41 · Congelado 0 · Reembolso 0
 * Correto:             Apostador R$ 9.051,71 · Congelado 0 · Reembolso 0
 *
 *   8.067,52 + 1.000 − 15,81 = 9.051,71
 *   (NÃO usar 91,11 / 8.976,41 — isso era odd 10)
 *
 * Delta: +R$ 75,30 (= 91,11 − 15,81 cobrado a mais)
 *
 * Na VPS:
 *   node scripts/vps-force-carlos-905171.mjs
 *   FIX=1 node scripts/vps-force-carlos-905171.mjs
 *   USER_ID=... FIX=1 node scripts/vps-force-carlos-905171.mjs
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const USER_ID_ENV = String(process.env.USER_ID || "").trim();
const NAME = String(process.env.NAME || "Carlos Roberto").trim();
const TARGET = Math.trunc(Number(process.env.TARGET_BALANCE_CENTS || 905_171));
const WRONG_ODD10 = 897_641;
const DESAFIO_HINT = Math.trunc(Number(process.env.DESAFIO_CENTS || 227_211));
const PROT_ID =
  String(process.env.PROTECTION_ID || "33bd22c8-87c3-4d3f-90ad-b1c5b4894dec").trim();
const TAG = "force-carlos-905171-sport-odd32-v1";

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
console.log("    Sport×Cuiabá LAY@32 · fee R$15,81 · NÃO 8.976,41");
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
  if (!res.ok) throw new Error(`${res.status} ${p}\n${String(text).slice(0, 700)}`);
  return data;
}

const SEL =
  "id,full_name,balance_cents,locked_balance_cents,deduction_balance_cents,reusable_balance_cents,desafio_balance_cents,updated_at";

async function findUser() {
  if (USER_ID_ENV) {
    const rows = await sb(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(USER_ID_ENV)}&select=${SEL}&limit=1`
    );
    if (Array.isArray(rows) && rows[0]) return rows[0];
    throw new Error(`USER_ID não encontrado: ${USER_ID_ENV}`);
  }

  // 1) proteção Sport → user_id
  for (const table of ["protections", "back_protections"]) {
    const rows = await sb(
      `/rest/v1/${table}?id=eq.${encodeURIComponent(PROT_ID)}&select=id,user_id,status,responsibility_cents,amount_cents&limit=1`
    ).catch(() => null);
    if (Array.isArray(rows) && rows[0]?.user_id) {
      const u = await sb(
        `/rest/v1/profiles?id=eq.${encodeURIComponent(rows[0].user_id)}&select=${SEL}&limit=1`
      );
      if (Array.isArray(u) && u[0]) {
        console.log("  via proteção", PROT_ID, "status", rows[0].status);
        return u[0];
      }
    }
  }

  // 2) fingerprint print: Apostador 8.976,41 + Desafio 2.272,11
  const byWrong = await sb(
    `/rest/v1/profiles?balance_cents=eq.${WRONG_ODD10}&desafio_balance_cents=eq.${DESAFIO_HINT}&select=${SEL}&limit=10`
  ).catch(() => []);
  if (Array.isArray(byWrong) && byWrong.length === 1) {
    console.log("  via fingerprint 897641+desafio227211");
    return byWrong[0];
  }
  if (Array.isArray(byWrong) && byWrong.length > 1) {
    console.log("  vários com 897641+desafio — filtro nome");
  }

  // 3) nome
  const byName = await sb(
    `/rest/v1/profiles?full_name=ilike.*${encodeURIComponent(NAME.split(" ")[0])}*&select=${SEL}&limit=30`
  ).catch(() => []);
  const list = Array.isArray(byName) ? byName : [];
  const scored = list
    .map((p) => {
      const nm = String(p.full_name || "").toLowerCase();
      let s = 0;
      if (nm.includes("carlos") && nm.includes("roberto")) s += 10;
      if (n(p.balance_cents) === WRONG_ODD10) s += 5;
      if (n(p.desafio_balance_cents) === DESAFIO_HINT) s += 5;
      if (n(p.balance_cents) === TARGET) s += 2;
      return { p, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);
  if (scored[0]) {
    console.log("  via nome score", scored[0].s, scored[0].p.full_name);
    return scored[0].p;
  }
  throw new Error("Carlos não encontrado — passe USER_ID=...");
}

async function main() {
  const user = await findUser();
  const bal = n(user.balance_cents);
  const locked = n(user.locked_balance_cents);
  const ded = n(user.deduction_balance_cents);
  const delta = TARGET - bal;

  console.log("\nANTES");
  console.log("  user     ", user.full_name, user.id);
  console.log("  Apostador", money(bal));
  console.log("  Congelado", money(locked));
  console.log("  Reembolso", money(ded));
  console.log("  Desafio  ", money(user.desafio_balance_cents));

  console.log("\nPLANO");
  console.log("  Apostador", money(bal), "→", money(TARGET));
  console.log("  Congelado", money(locked), "→", money(0));
  console.log("  delta    ", money(delta), delta === 7530 ? "(corrige overcharge odd10→odd32)" : "");

  if (bal === TARGET && locked === 0) {
    console.log("\nOK — já está em R$ 9.051,71 · Congelado 0. Nada a fazer.");
    return;
  }

  if (!FIX) {
    console.log("\nDry-run. Rode:");
    console.log("  FIX=1 node scripts/vps-force-carlos-905171.mjs");
    console.log("  USER_ID=" + user.id + " FIX=1 node scripts/vps-force-carlos-905171.mjs");
    return;
  }

  await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
    method: "PATCH",
    body: {
      balance_cents: TARGET,
      locked_balance_cents: 0,
      reusable_balance_cents: 0,
      updated_at: new Date().toISOString(),
    },
  });

  let after = await sb(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=${SEL}&limit=1`
  );
  after = Array.isArray(after) ? after[0] : null;
  if (!after || n(after.balance_cents) !== TARGET || n(after.locked_balance_cents) !== 0) {
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      body: { balance_cents: TARGET, locked_balance_cents: 0, reusable_balance_cents: 0 },
    });
    after = (
      await sb(
        `/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=${SEL}&limit=1`
      )
    )[0];
  }

  try {
    await sb(`/rest/v1/wallet_transactions`, {
      method: "POST",
      body: {
        user_id: user.id,
        ref: PROT_ID,
        amount_cents: delta,
        type: delta >= 0 ? "credit" : "debit",
        description:
          "FORCE Sport×Cuiabá odd32: corrige 8.976,41→9.051,71 (+75,30; fee 15,81 não 91,11)",
        metadata: {
          repair_tag: TAG,
          tag: TAG,
          protection_id: PROT_ID,
          from_cents: bal,
          to_cents: TARGET,
          fee_correct_cents: 1581,
          fee_wrong_odd10_cents: 9111,
          unlocked_locked: true,
          exchange_no_credit: true,
        },
      },
    });
  } catch (e) {
    console.warn("  tx skip:", e.message || e);
  }

  console.log("\n========== VERIFY ==========");
  console.log("  Apostador:", money(after.balance_cents), "(alvo R$ 9.051,71)");
  console.log("  Congelado:", money(after.locked_balance_cents), "(alvo R$ 0,00)");
  console.log("  Reembolso:", money(after.deduction_balance_cents), "(Exchange = R$ 0)");
  console.log("  Desafio  :", money(after.desafio_balance_cents));
  console.log("============================");

  if (n(after.balance_cents) !== TARGET || n(after.locked_balance_cents) !== 0) {
    console.error("FALHA: saldo não bateu o alvo");
    process.exit(1);
  }
  console.log("OK — hard refresh (Ctrl+Shift+R) no Financeiro / Espelho.");
}

main().catch((e) => {
  console.error("ERRO:", e.message || e);
  process.exit(1);
});
