#!/usr/bin/env node
/**
 * Rastreia settles Exchange do Augusto — para onde foi o dinheiro.
 *
 * Marker: vps-rastreia-settle-exchange-augusto-v1
 */
import fs from "node:fs";
import path from "node:path";

const ID_PREFIX = String(process.env.ID_PREFIX || "8b2cd8a3")
  .trim()
  .toLowerCase();
const USER_ID = String(process.env.USER_ID || "").trim();
const NAME = String(
  process.env.NAME || "Augusto Luiz Magalhaes Vila Nova"
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
function metaOf(row) {
  const m = row && row.metadata;
  if (!m) return {};
  if (typeof m === "string") {
    try {
      return JSON.parse(m) || {};
    } catch {
      return {};
    }
  }
  return typeof m === "object" && m ? m : {};
}
function outcomeOf(row) {
  const o = String(row.settled_outcome || "").toLowerCase();
  if (["arbishield", "won", "win", "user_won"].includes(o)) return "arbishield";
  if (["exchange", "lost", "loss"].includes(o)) return "exchange";
  const st = String(row.status || "").toLowerCase();
  if (st === "lost_exchange") return "arbishield";
  if (st === "won_exchange") return "exchange";
  return o || st || "";
}
function isFeeUpfront(row) {
  const meta = metaOf(row);
  return (
    meta.billing_model === "fee_upfront_v1" ||
    meta.fee_upfront === true ||
    String(meta.source || "").includes("fee_upfront")
  );
}

async function sb(p) {
  const res = await fetch(`${SUPABASE_URL}${p}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${res.status} ${p}: ${String(text).slice(0, 280)}`);
  return data;
}

async function main() {
  console.log("==> Rastreia settles Exchange — Augusto");
  console.log("    marker: vps-rastreia-settle-exchange-augusto-v1");

  let uid = USER_ID;
  if (!uid) {
    const rows = await sb(
      `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,deduction_balance_cents,demo_balance_cents,desafio_balance_cents,investor_balance_cents,demo_balance_provider_cents&id=gte.${ID_PREFIX}-0000-0000-0000-000000000000&id=lte.${ID_PREFIX}-ffff-ffff-ffff-ffffffffffff`
    );
    const p0 = Array.isArray(rows) && rows[0];
    if (!p0) {
      console.error("perfil não encontrado");
      process.exit(2);
    }
    uid = p0.id;
  }

  const profiles = await sb(
    `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,deduction_balance_cents,demo_balance_cents,desafio_balance_cents,investor_balance_cents,demo_balance_provider_cents,locked_balance_cents&id=eq.${encodeURIComponent(uid)}`
  );
  const p = Array.isArray(profiles) && profiles[0];
  console.log("    ", p.id, p.full_name);

  const real = n(p.balance_cents) + n(p.reusable_balance_cents);
  const reembolso = n(p.deduction_balance_cents);
  const apostador = real + reembolso + n(p.demo_balance_cents);
  console.log("\n==> Carteiras");
  console.log("    Real", money(real), "| Reembolso", money(reembolso), "| Apostador", money(apostador));
  console.log("    Desafio", money(p.desafio_balance_cents), "| Provedor", money(n(p.investor_balance_cents) + n(p.demo_balance_provider_cents)));

  const txs = await sb(
    `/rest/v1/wallet_transactions?select=id,type,amount_cents,ref,metadata,created_at&user_id=eq.${encodeURIComponent(uid)}&order=created_at.asc&limit=1000`
  );
  const allTx = Array.isArray(txs) ? txs : [];

  const prots = await sb(
    `/rest/v1/protections?select=id,status,amount_cents,responsibility_cents,platform_deduction_cents,settled_outcome,settled_at,created_at,metadata,odd&user_id=eq.${encodeURIComponent(uid)}&order=created_at.asc&limit=300`
  );
  const byId = {};
  for (const r of Array.isArray(prots) ? prots : []) byId[r.id] = r;

  // Todos settlements positivos
  const settles = allTx.filter(
    (t) => String(t.type) === "protection_settlement" && n(t.amount_cents) > 0
  );

  console.log("\n==> Settlements positivos (", settles.length, ")");
  let sumEx = 0,
    sumArbi = 0,
    sumOther = 0;
  const exchList = [];

  for (const t of settles) {
    const m = metaOf(t);
    const o = String(m.outcome || "").toLowerCase();
    const amt = n(t.amount_cents);
    const protId = String(t.ref || m.protection_id || "");
    const prot = byId[protId];
    const pout = prot ? outcomeOf(prot) : "?";
    const feeUp = prot ? isFeeUpfront(prot) : null;
    const stake = prot ? n(prot.responsibility_cents || prot.amount_cents) : 0;
    const billing = m.billing_model || (prot && metaOf(prot).billing_model) || "-";
    const bucket = m.bucket || m.destination || "-";

    let klass = "OUTRO";
    if (o === "arbishield" || o === "lost_exchange" || pout === "arbishield") {
      klass = "ARBI";
      sumArbi += amt;
    } else if (o === "exchange" || o === "won_exchange" || pout === "exchange") {
      klass = "EXCHANGE";
      sumEx += amt;
      exchList.push({ t, m, prot, amt, feeUp, stake, billing, bucket, pout });
    } else {
      sumOther += amt;
    }

    console.log(
      `    ${t.created_at} ${klass.padEnd(8)} ${money(amt).padStart(12)} txOutcome=${o || "-"} protOutcome=${pout} feeUp=${feeUp === null ? "?" : feeUp ? "Y" : "N"} billing=${billing} bucket=${bucket} stake=${money(stake)} ref=${protId.slice(0, 8)}`
    );
  }
  console.log("\n    soma EXCHANGE:", money(sumEx));
  console.log("    soma ARBI    :", money(sumArbi));
  console.log("    soma OUTRO   :", money(sumOther));

  // Produto fee_upfront: Exchange NÃO deveria creditar
  console.log("\n==> Settles Exchange — deveriam ser R$ 0 no fee_upfront");
  let indevidoFeeUp = 0;
  let legadoEx = 0;
  for (const x of exchList) {
    if (x.feeUp) {
      indevidoFeeUp += x.amt;
      console.log(
        `    !! INDEVIDO fee_upfront ${money(x.amt)} ref=${String(x.t.ref).slice(0, 8)} billing=${x.billing}`
      );
    } else {
      legadoEx += x.amt;
      console.log(
        `    legado/lock ${money(x.amt)} ref=${String(x.t.ref).slice(0, 8)} billing=${x.billing} (stake-fee esperado ~${money(Math.max(0, x.stake - n(x.prot?.platform_deduction_cents)))})`
      );
    }
  }
  console.log("    total indevido fee_upfront:", money(indevidoFeeUp));
  console.log("    total legado Exchange    :", money(legadoEx));

  // Running balance reconstruction (net all txs that typically hit Apostador buckets)
  console.log("\n==> Reconstrução líquida do ledger (todos os tipos)");
  const byType = {};
  for (const t of allTx) {
    const type = String(t.type || "unknown");
    byType[type] = (byType[type] || 0) + n(t.amount_cents);
  }
  const entries = Object.entries(byType).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  let netAll = 0;
  for (const [type, amt] of entries) {
    netAll += amt;
    console.log(`    ${type.padEnd(28)} ${money(amt).padStart(12)}`);
  }
  console.log("    NET todos tipos:", money(netAll));
  console.log("    Apostador agora:", money(apostador));
  console.log(
    "    Desafio+Prov+Apost:",
    money(
      apostador +
        n(p.desafio_balance_cents) +
        n(p.investor_balance_cents) +
        n(p.demo_balance_provider_cents)
    )
  );

  // Teóricos sob regras de produto
  const deps = byType["deposit"] || 0;
  const deps2 =
    (byType["manual_deposit"] || 0) +
    (byType["asaas_deposit"] || 0) +
    (byType["deposit"] || 0) +
    Object.entries(byType)
      .filter(([k]) => k.includes("deposit") && !["deposit", "manual_deposit", "asaas_deposit"].includes(k))
      .reduce((s, [, v]) => s + v, 0);
  const fees = byType["protection_fee"] || 0;
  const admin = byType["admin_adjustment"] || 0;
  const wd = Object.entries(byType)
    .filter(([k]) => k.includes("withdraw"))
    .reduce((s, [, v]) => s + v, 0);

  console.log("\n==> Três teóricos");
  const t1 = deps2 + fees + admin + sumArbi + sumEx + sumOther + wd;
  const t2 = deps2 + fees + admin + sumArbi + wd; // sem Exchange (regra fee_upfront)
  const t3 = deps2 + fees + sumArbi + wd; // sem admin (admin pode ser desafio)
  console.log("    A) ledger bruto (inclui Exchange):", money(t1), "delta", money(apostador - t1));
  console.log("    B) fee_upfront (sem crédito Exchange):", money(t2), "delta", money(apostador - t2));
  console.log("    C) B sem admin_adjustment         :", money(t3), "delta", money(apostador - t3));

  console.log("\n==> Conclusão operacional");
  if (sumEx > 0) {
    console.log(
      "    Há",
      money(sumEx),
      "em protection_settlement com outcome Exchange."
    );
    console.log(
      "    Sob regra atual (PERDEU = R$ 0), isso NÃO deveria aumentar Apostador."
    );
    console.log(
      "    Se o settle creditou e depois o saldo foi gasto/movido, o NET do ledger"
    );
    console.log(
      "    ainda mostra o crédito — por isso teórico A fica alto (delta ~-R$ 4.5k)."
    );
  }
  console.log("    Use teórico B ou C para comparar com o produto.");
  console.log("    Reembolso atual", money(reembolso), "| Arbi settles", money(sumArbi));
  if (reembolso > 0 && Math.abs(reembolso - (sumArbi + wd /* se saque do reembolso */)) > 100) {
    console.log(
      "    Reembolso ≠ Arbi±saque — parte pode ser residual de Exchange legado."
    );
  }

  // List transfer-like txs
  console.log("\n==> Movimentos possíveis Real/Desafio/Reembolso");
  for (const t of allTx) {
    const type = String(t.type || "");
    const m = metaOf(t);
    const blob = JSON.stringify(m).toLowerCase();
    if (
      type.includes("transfer") ||
      type.includes("desafio") ||
      blob.includes("desafio") ||
      blob.includes("reembolso") ||
      blob.includes("deduction") ||
      (type === "admin_adjustment" && Math.abs(n(t.amount_cents)) >= 10000)
    ) {
      console.log(
        `    ${t.created_at} ${type.padEnd(22)} ${money(t.amount_cents).padStart(12)} ${blob.slice(0, 120)}`
      );
    }
  }
}

main().catch((e) => {
  console.error("FALHA:", e && e.stack ? e.stack : e);
  process.exit(1);
});
