#!/usr/bin/env node
/**
 * Auditoria Saldo Reembolso — Lucas Gonçalves dos Santos (id~1210f201…)
 *
 * Relatório (VPS, com SERVICE_ROLE no .env):
 *   node scripts/vps-audit-reembolso-lucas.mjs
 *
 * Marker: vps-audit-reembolso-lucas-v1
 */
import fs from "node:fs";
import path from "node:path";

const NAME = String(
  process.env.NAME || "Lucas Gonçalves dos Santos"
).trim();
const ID_PREFIX = String(process.env.ID_PREFIX || "1210f201")
  .trim()
  .toLowerCase();
const EXPECTED_REEMBOLSO_CENTS = Math.round(
  Number(process.env.EXPECTED_REEMBOLSO_CENTS || 14900)
); // R$ 149,00 (admin)

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
function norm(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function sb(p, { method = "GET", body, okNull = false } = {}) {
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
    throw new Error(`${res.status} ${p}: ${String(text).slice(0, 280)}`);
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

function isReembolsoTx(t) {
  const type = String(t.type || "").toLowerCase();
  const meta = t.metadata && typeof t.metadata === "object" ? t.metadata : {};
  const blob = JSON.stringify(meta).toLowerCase();
  if (blob.includes("deduction_balance") || blob.includes("saldo_reembolso"))
    return true;
  if (blob.includes("saldo_deducao") || blob.includes("refund_balance"))
    return true;
  if (
    type.includes("deduction") ||
    type.includes("reembolso") ||
    type.includes("protection_refund")
  )
    return true;
  if (String(meta.bucket || "").includes("deduction")) return true;
  if (String(meta.origin || "").toUpperCase().includes("REEMBOLSO")) return true;
  if (String(meta.origin || "").toUpperCase().includes("DEDUCTION")) return true;
  return false;
}

function outcomeOf(p) {
  return String(
    p.settled_outcome || p.result || p.outcome || p.status || ""
  ).toLowerCase();
}

async function main() {
  console.log("==> Auditoria Saldo Reembolso — Lucas");
  console.log("    marker: vps-audit-reembolso-lucas-v1");
  console.log("    NAME:", NAME);
  console.log("    ID_PREFIX:", ID_PREFIX);
  console.log("    esperado (admin):", money(EXPECTED_REEMBOLSO_CENTS));
  console.log("    SUPABASE_URL:", SUPABASE_URL);

  const profiles = await sbTry([
    `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,deduction_balance_cents,demo_balance_cents,locked_balance_cents,investor_balance_cents,demo_balance_provider_cents,desafio_balance_cents,pix_key,created_at,updated_at&id=gte.${ID_PREFIX}-0000-0000-0000-000000000000&id=lte.${ID_PREFIX}-ffff-ffff-ffff-ffffffffffff`,
    `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,deduction_balance_cents,demo_balance_cents,locked_balance_cents,investor_balance_cents,demo_balance_provider_cents,desafio_balance_cents,pix_key,created_at,updated_at&full_name=ilike.*${encodeURIComponent(NAME.split(" ")[0])}*&limit=50`,
  ]);

  const want = norm(NAME);
  let rows = Array.isArray(profiles) ? profiles : [];
  rows = rows.filter((r) => {
    const id = String(r.id || "").toLowerCase();
    const nm = norm(r.full_name);
    return id.startsWith(ID_PREFIX) || nm.includes(want) || want.includes(nm);
  });
  if (!rows.length) {
    console.error("ERRO: perfil não encontrado");
    process.exit(2);
  }
  if (rows.length > 1) {
    console.log("!! múltiplos perfis, usando o de prefixo id:");
    rows.forEach((r) => console.log("   -", r.id, r.full_name));
    rows = rows.filter((r) => String(r.id).toLowerCase().startsWith(ID_PREFIX));
  }
  const p = rows[0];
  const id = p.id;

  const real = n(p.balance_cents) + n(p.reusable_balance_cents);
  const reembolso = n(p.deduction_balance_cents);
  const apostador =
    real + reembolso + n(p.demo_balance_cents);
  const desafio = n(p.desafio_balance_cents);
  const provedor =
    n(p.investor_balance_cents) + n(p.demo_balance_provider_cents);
  const congelado = n(p.locked_balance_cents);

  console.log("\n==> Perfil");
  console.log("    id:", id);
  console.log("    nome:", p.full_name);
  console.log("    pix_key:", p.pix_key ? "(cadastrada)" : "(AUSENTE)");
  console.log("    criado:", p.created_at);
  console.log("\n==> Carteiras (agora)");
  console.log("    Apostador :", money(apostador));
  console.log("    Real      :", money(real), `(balance=${money(p.balance_cents)} reusable=${money(p.reusable_balance_cents)})`);
  console.log("    Reembolso :", money(reembolso), reembolso === EXPECTED_REEMBOLSO_CENTS ? "✓ bate com admin" : `≠ admin ${money(EXPECTED_REEMBOLSO_CENTS)}`);
  console.log("    Desafio   :", money(desafio));
  console.log("    Provedor  :", money(provedor));
  console.log("    Congelado :", money(congelado));

  const protections = await sbTry([
    `/rest/v1/protections?select=id,status,amount_cents,responsibility_cents,platform_deduction_cents,locked_deduction_cents,user_profit_cents,settled_outcome,result,settled_at,refunded_at,created_at,metadata&user_id=eq.${id}&order=created_at.desc&limit=200`,
    `/rest/v1/protections?select=id,status,amount_cents,responsibility_cents,settled_outcome,settled_at,created_at&user_id=eq.${id}&order=created_at.desc&limit=200`,
  ]);
  const prots = Array.isArray(protections) ? protections : [];

  console.log("\n==> Proteções (", prots.length, ")");
  let expectedFromArbi = 0;
  for (const row of prots) {
    const stake = n(row.responsibility_cents || row.amount_cents);
    const fee = n(row.platform_deduction_cents || row.locked_deduction_cents);
    const out = outcomeOf(row);
    const arbi =
      out.includes("arbishield") ||
      out.includes("lost_exchange") ||
      out === "won" && String(row.result || "").toLowerCase().includes("arbi");
    const settled =
      ["settled", "won", "lost", "void", "refunded", "cancelled"].some((s) =>
        String(row.status || "").toLowerCase().includes(s)
      ) || !!row.settled_at;
    const line = `    ${String(row.id).slice(0, 8)}… st=${row.status} out=${out || "-"} stake=${money(stake)} fee=${money(fee)} at=${row.settled_at || row.created_at}`;
    console.log(line);
    if (settled && (out.includes("arbishield") || out.includes("lost_exchange"))) {
      // lock_fee_after / v4: Arbi → stake no Saldo Reembolso
      expectedFromArbi += stake;
      console.log("      → crédito esperado Reembolso (stake Arbi):", money(stake));
    }
    if (settled && out.includes("arbishield") && fee > 0) {
      // fee_upfront legado: stake+fee
      console.log("      (fee_upfront?) stake+fee =", money(stake + fee));
    }
  }

  const txs = await sbTry([
    `/rest/v1/wallet_transactions?select=id,type,amount_cents,ref,metadata,created_at,balance_after_cents&user_id=eq.${id}&order=created_at.desc&limit=300`,
    `/rest/v1/wallet_transactions?select=id,type,amount_cents,ref,metadata,created_at&user_id=eq.${id}&order=created_at.desc&limit=300`,
  ]);
  const allTx = Array.isArray(txs) ? txs : [];
  const reembTx = allTx.filter(isReembolsoTx);
  const reembNet = reembTx.reduce((s, t) => s + n(t.amount_cents), 0);

  console.log("\n==> wallet_transactions ligadas a Reembolso/Dedução (", reembTx.length, ")");
  for (const t of reembTx.slice(0, 40)) {
    const meta = t.metadata && typeof t.metadata === "object" ? t.metadata : {};
    console.log(
      `    ${t.created_at} ${t.type} ${money(t.amount_cents)} bucket=${meta.bucket || meta.origin || "-"} ref=${t.ref || "-"}`
    );
  }
  console.log("    net amostra reembolso tx:", money(reembNet));

  const withdrawals = await sbTry([
    `/rest/v1/withdrawals?select=id,amount_cents,status,pix_key,metadata,created_at,updated_at&user_id=eq.${id}&order=created_at.desc&limit=50`,
    `/rest/v1/withdrawals?select=id,amount_cents,status,created_at&user_id=eq.${id}&order=created_at.desc&limit=50`,
  ]);
  const wds = Array.isArray(withdrawals) ? withdrawals : [];
  const reembWd = wds.filter((w) => {
    const meta = w.metadata && typeof w.metadata === "object" ? w.metadata : {};
    const origin = String(meta.origin || meta.request_type || meta.label || "").toUpperCase();
    return (
      origin.includes("REEMBOLSO") ||
      origin.includes("DEDUCTION") ||
      origin.includes("DEDUCAO")
    );
  });
  console.log("\n==> Saques Saldo Reembolso (", reembWd.length, "/", wds.length, "total)");
  for (const w of reembWd) {
    console.log(
      `    ${w.created_at} ${w.status} ${money(w.amount_cents)} id=${String(w.id).slice(0, 8)}…`
    );
  }
  const openWd = reembWd.filter((w) =>
    ["pending", "approved", "processing"].includes(String(w.status || "").toLowerCase())
  );
  if (openWd.length) {
    console.log("    !! saque em aberto — cliente NÃO consegue sacar de novo até resolver");
  }

  console.log("\n==> Diagnóstico acesso");
  console.log("    PIX cadastrada:", p.pix_key ? "SIM" : "NÃO → saque bloqueado no app");
  console.log("    Reembolso > 0:", reembolso > 0 ? "SIM (botão saque/xfer deve habilitar)" : "NÃO (UI desabilita)");
  console.log("    Saque aberto:", openWd.length ? `SIM (${openWd.length})` : "não");
  if (expectedFromArbi > 0) {
    console.log(
      "    Soma stake Arbi settled:",
      money(expectedFromArbi),
      expectedFromArbi === reembolso
        ? "✓ igual ao Saldo Reembolso"
        : `≠ saldo atual ${money(reembolso)} (pode ter saque/xfer/consumo)`
    );
  }

  console.log("\n==> Conclusão rápida");
  if (reembolso === EXPECTED_REEMBOLSO_CENTS) {
    console.log("    Admin e DB batem em", money(reembolso));
  } else {
    console.log(
      "    DIVERGÊNCIA admin vs DB:",
      money(EXPECTED_REEMBOLSO_CENTS),
      "vs",
      money(reembolso)
    );
  }
  if (!p.pix_key) {
    console.log("    Cliente não saca sem PIX no perfil.");
  }
  if (openWd.length) {
    console.log("    Cliente vê erro de saque já em análise.");
  }
  if (reembolso > 0 && p.pix_key && !openWd.length) {
    console.log(
      "    Saldo acessível no DB. Se o app mostra 0, é UI/cache/sessão — pedir hard refresh em /app-carteira.html"
    );
  }
}

main().catch((e) => {
  console.error("FALHA:", e && e.stack ? e.stack : e);
  process.exit(1);
});
