#!/usr/bin/env node
/**
 * Auditoria + correção: transfer Reembolso→Desafio sem débito no Reembolso.
 *
 * Caso Pedro: TX internal_transfer R$ 255,51 em 26/07; correção admin em 27/07
 * ainda via Reembolso ~R$ 750 → transferência não debitou (ou foi sobrescrita).
 *
 * Relatório:
 *   ID_PREFIX=24037bdf node scripts/vps-fix-xfer-reembolso-desafio-sem-debito.mjs
 * Aplicar débito faltante no Reembolso (se Desafio já recebeu):
 *   FIX=1 ID_PREFIX=24037bdf node scripts/vps-fix-xfer-reembolso-desafio-sem-debito.mjs
 *
 * Marker: vps-fix-xfer-reembolso-desafio-sem-debito-v1
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const ID_PREFIX = String(process.env.ID_PREFIX || "24037bdf")
  .trim()
  .toLowerCase();
const USER_ID = String(process.env.USER_ID || "").trim();
const TX_ID = String(
  process.env.TX_ID || "9fcb1d29-ddf1-44cd-bf7d-f8c0a25b33a6"
).trim();
const NAME = String(process.env.NAME || "Pedro Iuri Teixeira dos Santos").trim();

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
  console.error("ERRO: SERVICE_ROLE_KEY ausente — rode na VPS");
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
  if (!res.ok) throw new Error(`${res.status} ${p}: ${String(text).slice(0, 400)}`);
  return data;
}

async function main() {
  console.log("==> Fix xfer Reembolso→Desafio sem débito");
  console.log("    marker: vps-fix-xfer-reembolso-desafio-sem-debito-v1");
  console.log("    FIX:", FIX ? "SIM" : "não (só relatório)");

  let uid = USER_ID;
  if (!uid) {
    const rows = await sb(
      `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,deduction_balance_cents,desafio_balance_cents,demo_balance_cents&id=gte.${ID_PREFIX}-0000-0000-0000-000000000000&id=lte.${ID_PREFIX}-ffff-ffff-ffff-ffffffffffff`
    );
    if (!Array.isArray(rows) || !rows[0]) {
      console.error("perfil não encontrado");
      process.exit(2);
    }
    uid = rows[0].id;
  }

  const profiles = await sb(
    `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,deduction_balance_cents,desafio_balance_cents,demo_balance_cents,updated_at&id=eq.${encodeURIComponent(uid)}`
  );
  const p = Array.isArray(profiles) && profiles[0];
  if (!p) {
    console.error("perfil não encontrado");
    process.exit(2);
  }

  console.log("\n==> Perfil");
  console.log("   ", p.id, p.full_name);
  console.log("    Real      :", money(n(p.balance_cents) + n(p.reusable_balance_cents)));
  console.log("    Reembolso :", money(p.deduction_balance_cents));
  console.log("    Desafio   :", money(p.desafio_balance_cents));
  console.log("    updated   :", p.updated_at);

  // Transferências Reembolso → Desafio
  const txs = await sb(
    `/rest/v1/wallet_transactions?select=*&user_id=eq.${encodeURIComponent(uid)}&type=eq.internal_transfer&order=created_at.asc&limit=100`
  );
  const xfers = (Array.isArray(txs) ? txs : []).filter((t) => {
    const m = metaOf(t);
    const from = String(m.from_bucket || m.from || "");
    const to = String(m.to_bucket || m.to || "");
    return (
      from.includes("deduction") ||
      to.includes("desafio") ||
      String(m.source || "").includes("reembolso_desafio") ||
      String(m.label || "").toLowerCase().includes("reembolso")
    );
  });

  console.log("\n==> internal_transfer Reembolso→Desafio:", xfers.length);
  let sumXfer = 0;
  for (const t of xfers) {
    const m = metaOf(t);
    const amt = n(t.amount_cents);
    sumXfer += amt;
    const mark = t.id === TX_ID || String(t.id).startsWith(TX_ID.slice(0, 8)) ? " ← ALVO" : "";
    console.log(
      "   ",
      t.created_at,
      money(amt),
      "before",
      money(t.balance_before_cents ?? m.deduction_before_cents),
      "→ after",
      money(t.balance_after_cents ?? m.deduction_after_cents),
      "| desafio",
      money(m.desafio_before_cents),
      "→",
      money(m.desafio_after_cents),
      t.id,
      mark
    );
    console.log("      meta:", JSON.stringify(m));
  }
  console.log("    soma xfers:", money(sumXfer));

  // Correções admin
  const adjs = await sb(
    `/rest/v1/wallet_transactions?select=id,created_at,amount_cents,type,metadata&user_id=eq.${encodeURIComponent(uid)}&type=eq.admin_adjustment&order=created_at.asc&limit=50`
  );
  console.log("\n==> admin_adjustment:");
  for (const t of Array.isArray(adjs) ? adjs : []) {
    const m = metaOf(t);
    console.log(
      "   ",
      t.created_at,
      money(t.amount_cents),
      m.kind || "",
      m.from_bucket || "",
      "→",
      m.to_bucket || "",
      "amt",
      money(m.amount_cents),
      "keep",
      money(m.keep_arbi_cents)
    );
    if (m.reason) console.log("      ", String(m.reason).slice(0, 160));
  }

  // Settlements que creditam Reembolso
  const settles = await sb(
    `/rest/v1/wallet_transactions?select=id,created_at,amount_cents,metadata&user_id=eq.${encodeURIComponent(uid)}&type=eq.protection_settlement&order=created_at.asc&limit=300`
  );
  let sumArbi = 0;
  let sumEx = 0;
  let sumVoid = 0;
  for (const t of Array.isArray(settles) ? settles : []) {
    const amt = n(t.amount_cents);
    const o = String(metaOf(t).outcome || "").toLowerCase();
    if (amt <= 0) continue;
    if (o === "arbishield" || o === "lost_exchange") sumArbi += amt;
    else if (o === "void" || o === "empate_anula") sumVoid += amt;
    else if (o === "exchange" || o === "won_exchange") sumEx += amt;
  }
  console.log("\n==> Settles (crédito hist)");
  console.log("    Arbi  :", money(sumArbi));
  console.log("    Void  :", money(sumVoid));
  console.log("    Exch  :", money(sumEx), "(não deveria creditar)");

  // Saques reembolso
  const wds = await sb(
    `/rest/v1/withdrawals?select=amount_cents,status,metadata,created_at&user_id=eq.${encodeURIComponent(uid)}&limit=50`
  );
  let wdReemb = 0;
  for (const w of Array.isArray(wds) ? wds : []) {
    const st = String(w.status || "").toLowerCase();
    if (["rejected", "cancelled", "canceled"].includes(st)) continue;
    const origin = String(metaOf(w).origin || metaOf(w).label || "").toUpperCase();
    if (
      origin.includes("REEMBOLSO") ||
      origin.includes("DEDUCTION") ||
      origin.includes("DEDUCAO")
    ) {
      wdReemb += n(w.amount_cents);
      console.log("    saque reemb", w.created_at, money(w.amount_cents), w.status, origin);
    }
  }

  // Admin moves Reembolso → Real
  let movedToReal = 0;
  for (const t of Array.isArray(adjs) ? adjs : []) {
    const m = metaOf(t);
    if (
      String(m.from_bucket || "") === "deduction_balance_cents" &&
      String(m.to_bucket || "") === "balance_cents"
    ) {
      movedToReal += n(m.amount_cents);
    }
  }

  const reembolso = n(p.deduction_balance_cents);
  const desafio = n(p.desafio_balance_cents);

  // Teórico Reembolso se xfers tivessem debitado:
  // créditos legítimos - saques - moves para Real - xfers
  const creditsOk = sumArbi + sumVoid;
  const teorico = Math.max(0, creditsOk - wdReemb - movedToReal - sumXfer);
  // Alternativa: se Exchange indevido ainda está no bucket, atual pode estar alto
  const teoricoComEx = Math.max(0, creditsOk + sumEx - wdReemb - movedToReal - sumXfer);

  console.log("\n==> Reconciliação Reembolso");
  console.log("    atual              :", money(reembolso));
  console.log("    teórico (Arbi+void − saque − moveReal − xfer):", money(teorico));
  console.log("    teórico+Ex indevido:", money(teoricoComEx));
  console.log("    delta atual−teórico:", money(reembolso - teorico));

  // Alvo da TX específica
  let alvo = xfers.find((t) => t.id === TX_ID);
  if (!alvo && TX_ID) {
    const byId = await sb(
      `/rest/v1/wallet_transactions?select=*&id=eq.${encodeURIComponent(TX_ID)}&limit=1`
    );
    alvo = Array.isArray(byId) && byId[0] ? byId[0] : null;
  }
  if (!alvo && xfers.length) alvo = xfers[xfers.length - 1];

  let missingDebit = 0;
  if (alvo) {
    const m = metaOf(alvo);
    const amt = n(alvo.amount_cents);
    const before = n(alvo.balance_before_cents ?? m.deduction_before_cents);
    const after = n(alvo.balance_after_cents ?? m.deduction_after_cents);
    console.log("\n==> TX alvo");
    console.log("    id     :", alvo.id);
    console.log("    quando :", alvo.created_at);
    console.log("    valor  :", money(amt));
    console.log("    Reembolso na TX:", money(before), "→", money(after));
    console.log("    Desafio na TX  :", money(m.desafio_before_cents), "→", money(m.desafio_after_cents));

    // Se a correção admin posterior setou Reembolso alto (ex. keep_arbi),
    // o débito da xfer foi perdido. Débito faltante ≈ o que a xfer deveria
    // ter tirado e ainda está no Reembolso além do teórico.
    missingDebit = Math.max(0, reembolso - teorico);
    // Limitar ao valor da(s) xfer(s) — não clavar Arbi legítimo
    missingDebit = Math.min(missingDebit, sumXfer);
  } else {
    missingDebit = Math.min(Math.max(0, reembolso - teorico), sumXfer);
  }

  console.log("\n==> Diagnóstico");
  if (sumXfer <= 0) {
    console.log("    Sem transferências Reembolso→Desafio.");
    return;
  }
  if (missingDebit <= 0) {
    console.log("    OK: Reembolso já reflete as transferências (ou teórico ≥ atual).");
    console.log("    Se a UI ainda mostra alto, force refresh / limpe cache.");
    return;
  }

  console.log("    PROBLEMA: Reembolso está", money(missingDebit), "acima do teórico");
  console.log("    após xfer(s) de", money(sumXfer), "→ Desafio.");
  console.log("    Causa provável: TX gravada mas débito perdido (race/correção admin).");
  console.log("\n==> PLANO");
  console.log("    Debitar Reembolso:", money(missingDebit));
  console.log("    Reembolso:", money(reembolso), "→", money(reembolso - missingDebit));
  console.log("    Desafio permanece:", money(desafio), "(já recebeu)");
  console.log("    Apostador líquido:", money(n(p.balance_cents) + n(p.reusable_balance_cents) + reembolso), "→", money(n(p.balance_cents) + n(p.reusable_balance_cents) + reembolso - missingDebit));

  // Já aplicado?
  const already = (Array.isArray(adjs) ? adjs : []).some(
    (t) => metaOf(t).kind === "fix_xfer_reembolso_desafio_sem_debito_v1"
  );
  if (already) {
    console.log("\n✓ Correção já aplicada anteriormente. Abortando.");
    return;
  }

  if (!FIX) {
    console.log("\n(dry-run) Exporte FIX=1 para debitar o Reembolso faltante.");
    return;
  }

  if (missingDebit > reembolso) {
    console.error("Abortado: débito > Reembolso atual");
    process.exit(3);
  }

  const newDed = reembolso - missingDebit;
  await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(p.id)}`, {
    method: "PATCH",
    body: {
      deduction_balance_cents: newDed,
      updated_at: new Date().toISOString(),
    },
  });

  await sb(`/rest/v1/wallet_transactions`, {
    method: "POST",
    body: {
      user_id: p.id,
      type: "admin_adjustment",
      amount_cents: -missingDebit,
      ref: alvo?.id || p.id,
      metadata: {
        kind: "fix_xfer_reembolso_desafio_sem_debito_v1",
        from_bucket: "deduction_balance_cents",
        to_bucket: "desafio_balance_cents",
        amount_cents: missingDebit,
        note:
          "Débito retroativo: internal_transfer Reembolso→Desafio gravada sem reduzir Saldo Reembolso (ou sobrescrita). Desafio já havia recebido.",
        name: NAME,
        xfer_tx_id: alvo?.id || null,
        xfer_sum_cents: sumXfer,
        reembolso_before: reembolso,
        reembolso_after: newDed,
        teorico_cents: teorico,
      },
    },
  });

  const verify = await sb(
    `/rest/v1/profiles?select=deduction_balance_cents,desafio_balance_cents,balance_cents&id=eq.${encodeURIComponent(p.id)}&limit=1`
  );
  const v = Array.isArray(verify) && verify[0];
  console.log("\n==> ✓ APLICADO");
  console.log("    Reembolso agora:", money(v?.deduction_balance_cents));
  console.log("    Desafio agora  :", money(v?.desafio_balance_cents));
}

main().catch((e) => {
  console.error("FALHA:", e && e.stack ? e.stack : e);
  process.exit(1);
});
