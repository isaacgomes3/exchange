#!/usr/bin/env node
/**
 * Reparo: stake do último jogo do Carlos NÃO voltou após Exchange/PERDEU.
 *
 * Casos cobertos:
 *  A) Congelado > 0  → devolve locked − 91,11 · zera locked
 *  B) Congelado = 0 e Apostador ainda ~8.067,52 → credita 1.000 − 91,11
 *  C) Apostador em 8.971,41 / 8.982,52 → ajusta para 8.976,41
 *  D) Já em 8.976,41 → noop
 *
 * Alvo: 8.067,52 + 1.000 − 91,11 = 8.976,41
 *
 * Na VPS:
 *   node scripts/vps-reparar-carlos-stake-nao-voltou.mjs
 *   FIX=1 node scripts/vps-reparar-carlos-stake-nao-voltou.mjs
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const USER_ID_ENV = String(process.env.USER_ID || "").trim();
const NAME = String(process.env.NAME || "Carlos Roberto").trim();
const FEE = Math.trunc(Number(process.env.FEE_CENTS || 9111)); // R$ 91,11
const STAKE = Math.trunc(Number(process.env.STAKE_CENTS || 100_000));
const BASE_BEFORE = Math.trunc(Number(process.env.BASE_BEFORE_CENTS || 806_752));
const TARGET = Math.trunc(
  Number(process.env.TARGET_BALANCE_CENTS || BASE_BEFORE + STAKE - FEE)
); // 897641
const TAG = "reparar-carlos-stake-nao-voltou-v9";

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return false;
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
  return true;
}

for (const f of [
  process.env.ENV_FILE,
  "/opt/arbishield/deploy/vps-supabase/.env",
  "/opt/arbishield/.env",
  "/opt/arbishield/scripts/.env",
  "/root/.arbishield.env",
  path.resolve("deploy/vps-supabase/.env"),
  path.resolve(".env"),
].filter(Boolean)) {
  loadEnvFile(f);
}

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

async function sb(p, { method = "GET", body, headers } = {}) {
  const res = await fetch(`${SUPABASE_URL}${p}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(headers || {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${res.status} ${p}: ${String(text).slice(0, 600)}`);
  return data;
}

const SEL =
  "id,full_name,balance_cents,locked_balance_cents,deduction_balance_cents,reusable_balance_cents,updated_at";

async function findUser() {
  if (USER_ID_ENV) {
    const rows = await sb(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(USER_ID_ENV)}&select=${SEL}&limit=1`
    );
    const p = Array.isArray(rows) ? rows[0] : null;
    if (!p) throw new Error(`USER_ID não encontrado: ${USER_ID_ENV}`);
    return p;
  }

  // profiles-sem-coluna-email-v1
  const byName = await sb(
    `/rest/v1/profiles?full_name=ilike.*${encodeURIComponent(NAME)}*&select=${SEL}&limit=30`
  );
  const list = Array.isArray(byName) ? byName : [];
  if (!list.length) throw new Error(`Nenhum perfil ~ ${NAME}`);

  const preferredBals = [TARGET, BASE_BEFORE, 897_141, 898_252];
  // Prefer locked>0 (stake preso)
  const lockedHit = list
    .filter((p) => n(p.locked_balance_cents) > 0)
    .sort((a, b) => n(b.locked_balance_cents) - n(a.locked_balance_cents));
  if (lockedHit.length === 1) return lockedHit[0];
  if (lockedHit.length > 1) {
    const exact = lockedHit.find((p) => n(p.locked_balance_cents) === STAKE);
    if (exact) return exact;
  }

  for (const bal of preferredBals) {
    const hit = list.find((p) => n(p.balance_cents) === bal);
    if (hit) return hit;
  }

  const ranked = list
    .map((p) => ({
      p,
      score:
        (String(p.full_name || "").toLowerCase().includes("carlos") ? 10 : 0) +
        (String(p.full_name || "").toLowerCase().includes("roberto") ? 10 : 0) +
        (n(p.locked_balance_cents) > 0 ? 50 : 0) +
        (preferredBals.includes(n(p.balance_cents)) ? 30 : 0),
    }))
    .sort((a, b) => b.score - a.score);

  console.log("Candidatos:");
  for (const { p, score } of ranked.slice(0, 8)) {
    console.log(
      " ",
      score,
      p.id,
      p.full_name,
      "Real",
      money(p.balance_cents),
      "Congelado",
      money(p.locked_balance_cents)
    );
  }
  if (ranked[0]?.score >= 20) return ranked[0].p;
  throw new Error("Não identifiquei o Carlos — passe USER_ID=");
}

async function recentProtections(userId) {
  const sel =
    "id,status,settled_outcome,amount_cents,responsibility_cents,platform_deduction_cents,odd,metadata,created_at,updated_at";
  const lay = await sb(
    `/rest/v1/protections?user_id=eq.${encodeURIComponent(userId)}&select=${sel}&order=updated_at.desc&limit=15`
  ).catch(() => []);
  const back = await sb(
    `/rest/v1/back_protections?user_id=eq.${encodeURIComponent(userId)}&select=${sel}&order=updated_at.desc&limit=15`
  ).catch(() => []);
  return [
    ...(Array.isArray(lay) ? lay.map((r) => ({ ...r, _table: "protections" })) : []),
    ...(Array.isArray(back)
      ? back.map((r) => ({ ...r, _table: "back_protections" }))
      : []),
  ].sort(
    (a, b) =>
      new Date(b.updated_at || b.created_at || 0) -
      new Date(a.updated_at || a.created_at || 0)
  );
}

async function alreadyDone(userId) {
  const rows = await sb(
    `/rest/v1/wallet_transactions?user_id=eq.${encodeURIComponent(userId)}&select=id,metadata,amount_cents,created_at&order=created_at.desc&limit=40`
  ).catch(() => []);
  for (const t of Array.isArray(rows) ? rows : []) {
    const meta = t.metadata && typeof t.metadata === "object" ? t.metadata : {};
    if (meta.repair_tag === TAG || meta.tag === TAG) return t;
  }
  return null;
}

function plan(user, prots) {
  const bal = n(user.balance_cents);
  const locked = n(user.locked_balance_cents);
  const last = prots[0] || null;
  const lastStake = last
    ? n(last.responsibility_cents || last.amount_cents) || STAKE
    : STAKE;
  const lastStatus = String(last?.status || "");
  const lastOutcome = String(last?.settled_outcome || "");

  // Já no alvo e sem congelado
  if (bal === TARGET && locked === 0) {
    return {
      kind: "ok",
      nextBal: TARGET,
      nextLocked: 0,
      delta: 0,
      fee: FEE,
      note: "já no alvo v9",
      last,
    };
  }

  // A) stake ainda congelado
  if (locked > 0) {
    const fee = locked === STAKE ? FEE : Math.round((FEE * locked) / STAKE);
    const nextBal = bal + locked - fee;
    return {
      kind: "unlock-return-fee",
      nextBal,
      nextLocked: 0,
      delta: nextBal - bal,
      fee,
      stake: locked,
      note: `devolve ${money(locked)} − dedução ${money(fee)}`,
      last,
    };
  }

  // B) jogo finalizado (won_exchange) mas saldo ainda no nível pré-devolução
  const settledExchange =
    /won_exchange/i.test(lastStatus) ||
    /exchange/i.test(lastOutcome) ||
    /won_exchange/i.test(lastOutcome);

  if (settledExchange && (bal === BASE_BEFORE || bal < BASE_BEFORE + lastStake - FEE - 50)) {
    // Se está em ~8067, stake não voltou
    if (Math.abs(bal - BASE_BEFORE) <= 2) {
      return {
        kind: "credit-missing-return",
        nextBal: bal + lastStake - FEE,
        nextLocked: 0,
        delta: lastStake - FEE,
        fee: FEE,
        stake: lastStake,
        note: `stake não voltou após settle — credita ${money(lastStake)} − ${money(FEE)}`,
        last,
      };
    }
  }

  // C) saldos intermediários conhecidos → força alvo
  if ([897_141, 898_252, 8_971_41].includes(bal) || bal !== TARGET) {
    // Se parece Carlos no print histórico, ajusta ao alvo
    if (
      bal === 897_141 ||
      bal === 898_252 ||
      bal === BASE_BEFORE ||
      (settledExchange && Math.abs(bal - TARGET) < 50_000)
    ) {
      return {
        kind: "set-target",
        nextBal: TARGET,
        nextLocked: 0,
        delta: TARGET - bal,
        fee: FEE,
        note: `ajusta Apostador ${money(bal)} → ${money(TARGET)}`,
        last,
      };
    }
  }

  return {
    kind: "manual",
    nextBal: bal,
    nextLocked: locked,
    delta: 0,
    fee: FEE,
    note: "saldo fora do padrão esperado — passe USER_ID= e TARGET_BALANCE_CENTS=",
    last,
  };
}

async function main() {
  console.log("==> Reparo stake não voltou (Carlos)", FIX ? "(FIX=1)" : "(dry-run)");
  console.log("    alvo:", money(TARGET), `(${BASE_BEFORE}+${STAKE}-${FEE})`);
  console.log("    tag:", TAG);

  const user = await findUser();
  console.log(
    "    user:",
    user.id,
    user.full_name,
    "Real",
    money(user.balance_cents),
    "Congelado",
    money(user.locked_balance_cents),
    "Reembolso",
    money(user.deduction_balance_cents)
  );

  const prots = await recentProtections(user.id);
  console.log("    proteções recentes:", prots.length);
  for (const p of prots.slice(0, 5)) {
    console.log(
      "     -",
      p._table,
      p.id,
      "status=",
      p.status,
      "outcome=",
      p.settled_outcome || "—",
      "stake",
      money(p.responsibility_cents || p.amount_cents),
      "feeStored",
      money(p.platform_deduction_cents)
    );
  }

  const prev = await alreadyDone(user.id);
  if (prev && n(user.balance_cents) === TARGET && n(user.locked_balance_cents) === 0) {
    console.log("OK — reparo já aplicado:", prev.id);
    return;
  }

  const p = plan(user, prots);
  console.log("\nPLANO:", p.kind, "—", p.note);
  console.log("  Real", money(user.balance_cents), "→", money(p.nextBal));
  console.log("  Congelado", money(user.locked_balance_cents), "→", money(p.nextLocked));
  console.log("  delta", money(p.delta), "fee", money(p.fee));

  if (p.kind === "ok") {
    console.log("OK — nada a fazer.");
    return;
  }
  if (p.kind === "manual") {
    console.error("ERRO: " + p.note);
    process.exit(2);
  }

  if (!FIX) {
    console.log("\nDry-run. Rode FIX=1 para aplicar.");
    return;
  }

  await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
    method: "PATCH",
    body: {
      balance_cents: p.nextBal,
      locked_balance_cents: 0,
      reusable_balance_cents: 0,
      updated_at: new Date().toISOString(),
    },
    headers: { Prefer: "return=minimal" },
  });

  // Confirma locked=0 (retry)
  let after = await sb(
    `/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=${SEL}&limit=1`
  );
  let row = Array.isArray(after) ? after[0] : null;
  if (n(row?.locked_balance_cents) > 0) {
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      body: { locked_balance_cents: 0, balance_cents: p.nextBal },
      headers: { Prefer: "return=minimal" },
    });
    after = await sb(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=${SEL}&limit=1`
    );
    row = Array.isArray(after) ? after[0] : null;
  }

  try {
    await sb(`/rest/v1/wallet_transactions`, {
      method: "POST",
      body: {
        user_id: user.id,
        amount_cents: p.delta,
        type: p.delta >= 0 ? "credit" : "debit",
        description:
          "Reparo: stake do último jogo Exchange não voltou — devolve stake e cobra só dedução R$91,11",
        metadata: {
          repair_tag: TAG,
          tag: TAG,
          kind: p.kind,
          fee_cents: p.fee,
          stake_cents: p.stake || STAKE,
          target_cents: TARGET,
          protection_id: p.last?.id || null,
          protection_status: p.last?.status || null,
        },
      },
    });
  } catch (e) {
    console.warn("  wallet_transactions skip:", e.message || e);
  }

  console.log("\nVERIFY:");
  console.log("  Apostador", money(row?.balance_cents), "(alvo", money(TARGET) + ")");
  console.log("  Congelado", money(row?.locked_balance_cents));
  console.log("  Reembolso", money(row?.deduction_balance_cents), "(Exchange → R$ 0 OK)");

  if (n(row?.locked_balance_cents) !== 0) {
    console.error("FALHA: Congelado ainda > 0");
    process.exit(1);
  }
  if (n(row?.balance_cents) !== p.nextBal && n(row?.balance_cents) !== TARGET) {
    console.error("FALHA: saldo não bateu o plano");
    process.exit(1);
  }
  console.log("OK — hard refresh no Financeiro (Apostador deve ser R$ 8.976,41).");
}

main().catch((e) => {
  console.error("ERRO:", e.message || e);
  process.exit(1);
});
