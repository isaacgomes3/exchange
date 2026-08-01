#!/usr/bin/env node
/**
 * Auditoria — clientes com Saldo Provedor × data de entrada no provedor.
 *
 * Data de entrada = partner_rounds.signed_at ?? partner_rounds.created_at
 * (NÃO usar profiles.created_at — isso é cadastro da conta).
 *
 * Cruza com o 1º crédito provedor (wallet_transactions / manual_deposits)
 * para flagrar rodada backfillada depois do saldo.
 *
 * Na VPS (só relatório — não altera nada):
 *   node scripts/vps-audit-provedor-entrada.mjs
 *   INCLUDE_ZERO=1 node scripts/vps-audit-provedor-entrada.mjs   # também rodadas ACTIVE sem saldo
 *   JSON=1 node scripts/vps-audit-provedor-entrada.mjs > /tmp/provedor-entrada.json
 *
 * Marker: provedor-entrada-audit-v1
 * profiles-sem-coluna-email-v1
 */
import fs from "node:fs";
import path from "node:path";

const INCLUDE_ZERO =
  process.env.INCLUDE_ZERO === "1" || process.env.INCLUDE_ZERO === "true";
const AS_JSON = process.env.JSON === "1" || process.env.JSON === "true";
const PAGE = Math.min(1000, Number(process.env.PAGE_SIZE || 500));
const MISMATCH_HOURS = Math.max(1, Number(process.env.MISMATCH_HOURS || 24));

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
function pad(s, w) {
  s = String(s ?? "");
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}
function fmtDt(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}
function daysSince(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

async function sb(pathQs) {
  const res = await fetch(`${SUPABASE_URL}${pathQs}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Prefer: "count=exact",
    },
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
      (data && data.error) ||
      text ||
      res.statusText;
    const err = new Error(`${res.status} ${msg}`);
    err.status = res.status;
    throw err;
  }
  return Array.isArray(data) ? data : data ? [data] : [];
}

async function sbPage(basePath) {
  const out = [];
  let offset = 0;
  for (;;) {
    const sep = basePath.includes("?") ? "&" : "?";
    const chunk = await sb(
      `${basePath}${sep}limit=${PAGE}&offset=${offset}`
    );
    out.push(...chunk);
    if (chunk.length < PAGE) break;
    offset += PAGE;
    if (offset > 20000) break;
  }
  return out;
}

function isProviderCreditTx(t) {
  const ty = String(t.type || "").toLowerCase();
  if (ty === "provider_deposit") return true;
  if (ty === "desafio_forfeit_to_provider") return true;
  const meta = t.metadata && typeof t.metadata === "object" ? t.metadata : {};
  const wallet = String(
    meta.wallet || meta.bucket || meta.field || meta.balance_field || ""
  ).toLowerCase();
  if (
    wallet.includes("investor") ||
    wallet.includes("provider") ||
    wallet.includes("provedor") ||
    wallet === "investor_balance_cents"
  ) {
    return n(t.amount_cents) > 0;
  }
  return false;
}

async function firstProviderCreditAt(userId) {
  // wallet_transactions — tentativas com selects cada vez mais enxutos
  const tries = [
    `/rest/v1/wallet_transactions?select=id,type,amount_cents,metadata,created_at&user_id=eq.${encodeURIComponent(userId)}&order=created_at.asc&limit=200`,
    `/rest/v1/wallet_transactions?select=id,type,amount_cents,created_at&user_id=eq.${encodeURIComponent(userId)}&order=created_at.asc&limit=200`,
  ];
  let txs = null;
  for (const q of tries) {
    try {
      txs = await sb(q);
      break;
    } catch {
      /* next */
    }
  }
  if (Array.isArray(txs)) {
    const hit = txs.find(isProviderCreditTx);
    if (hit?.created_at) {
      return { at: hit.created_at, source: `tx:${hit.type}` };
    }
  }

  // manual_deposits aprovados investor/provider/partner
  try {
    const deps = await sb(
      `/rest/v1/manual_deposits?select=id,status,deposit_type,amount_cents,created_at,reviewed_at&user_id=eq.${encodeURIComponent(userId)}&deposit_type=in.(investor,provider,partner)&status=in.(APPROVED,CREDITED,PAID)&order=created_at.asc&limit=5`
    );
    const d = Array.isArray(deps) ? deps[0] : null;
    if (d) {
      return {
        at: d.reviewed_at || d.created_at,
        source: `manual_deposit:${d.deposit_type}`,
      };
    }
  } catch {
    /* ignore */
  }
  return { at: null, source: null };
}

function entryDateOf(round) {
  if (!round) return null;
  return round.signed_at || round.created_at || null;
}

async function main() {
  console.error("==> provedor-entrada-audit-v1");
  console.error(`URL=${SUPABASE_URL}`);

  // profiles-sem-coluna-email-v1 — sem email
  const profiles = await sbPage(
    `/rest/v1/profiles?select=id,full_name,account_status,investor_balance_cents,demo_balance_provider_cents,created_at&or=(investor_balance_cents.gt.0,demo_balance_provider_cents.gt.0)&order=investor_balance_cents.desc`
  );

  let rounds = [];
  try {
    rounds = await sbPage(
      `/rest/v1/partner_rounds?select=id,user_id,status,invested_amount,accumulated_amount,signed_at,created_at,updated_at,completed_at,is_demo&order=created_at.asc`
    );
  } catch (e) {
    console.error("AVISO: falha partner_rounds:", e.message || e);
  }

  const roundsByUser = new Map();
  for (const r of rounds) {
    const uid = String(r.user_id || "");
    if (!uid) continue;
    if (!roundsByUser.has(uid)) roundsByUser.set(uid, []);
    roundsByUser.get(uid).push(r);
  }

  const withBalanceIds = new Set(profiles.map((p) => String(p.id)));

  // Rodadas ACTIVE sem saldo (opcional) — órfão inverso
  const orphanRounds = [];
  if (INCLUDE_ZERO) {
    for (const r of rounds) {
      if (String(r.status || "").toUpperCase() !== "ACTIVE") continue;
      if (withBalanceIds.has(String(r.user_id))) continue;
      orphanRounds.push(r);
    }
  }

  const rows = [];
  for (const p of profiles) {
    const uid = String(p.id);
    const list = roundsByUser.get(uid) || [];
    const active =
      list.find((r) => String(r.status || "").toUpperCase() === "ACTIVE") ||
      null;
    const firstRound = list[0] || null;
    const round = active || firstRound;
    const entryAt = entryDateOf(round);
    const credit = await firstProviderCreditAt(uid);

    let flag = "ok";
    if (!round) flag = "SEM_RODADA";
    else if (!entryAt) flag = "SEM_DATA_ENTRADA";
    else if (credit.at) {
      const entryMs = new Date(entryAt).getTime();
      const creditMs = new Date(credit.at).getTime();
      if (
        !Number.isNaN(entryMs) &&
        !Number.isNaN(creditMs) &&
        entryMs - creditMs > MISMATCH_HOURS * 3600 * 1000
      ) {
        flag = "BACKFILL_SUSPEITO";
      } else if (
        !Number.isNaN(entryMs) &&
        !Number.isNaN(creditMs) &&
        creditMs - entryMs > MISMATCH_HOURS * 3600 * 1000
      ) {
        flag = "CREDITO_APOS_RODADA";
      }
    }

    rows.push({
      user_id: uid,
      full_name: p.full_name || "(sem nome)",
      account_status: p.account_status || "",
      investor_balance_cents: n(p.investor_balance_cents),
      demo_balance_provider_cents: n(p.demo_balance_provider_cents),
      saldo_provedor_cents:
        n(p.investor_balance_cents) + n(p.demo_balance_provider_cents),
      profile_created_at: p.created_at || null,
      round_id: round?.id || null,
      round_status: round?.status || null,
      invested_amount: round ? n(round.invested_amount) : 0,
      accumulated_amount: round ? n(round.accumulated_amount) : 0,
      signed_at: round?.signed_at || null,
      round_created_at: round?.created_at || null,
      entrada_at: entryAt,
      dias_no_provedor: daysSince(entryAt),
      first_credit_at: credit.at,
      first_credit_source: credit.source,
      flag,
    });
  }

  // INCLUDE_ZERO: rodadas ACTIVE cujo profile não entrou na lista de saldo
  for (const r of orphanRounds) {
    let name = "(perfil?)";
    let status = "";
    let inv = 0;
    let demo = 0;
    let profCreated = null;
    try {
      const ps = await sb(
        `/rest/v1/profiles?select=id,full_name,account_status,investor_balance_cents,demo_balance_provider_cents,created_at&id=eq.${encodeURIComponent(r.user_id)}&limit=1`
      );
      const p = ps[0];
      if (p) {
        name = p.full_name || name;
        status = p.account_status || "";
        inv = n(p.investor_balance_cents);
        demo = n(p.demo_balance_provider_cents);
        profCreated = p.created_at || null;
      }
    } catch {
      /* ignore */
    }
    const entryAt = entryDateOf(r);
    rows.push({
      user_id: String(r.user_id),
      full_name: name,
      account_status: status,
      investor_balance_cents: inv,
      demo_balance_provider_cents: demo,
      saldo_provedor_cents: inv + demo,
      profile_created_at: profCreated,
      round_id: r.id,
      round_status: r.status,
      invested_amount: n(r.invested_amount),
      accumulated_amount: n(r.accumulated_amount),
      signed_at: r.signed_at || null,
      round_created_at: r.created_at || null,
      entrada_at: entryAt,
      dias_no_provedor: daysSince(entryAt),
      first_credit_at: null,
      first_credit_source: null,
      flag: "RODADA_SEM_SALDO",
    });
  }

  rows.sort((a, b) => b.saldo_provedor_cents - a.saldo_provedor_cents);

  const summary = {
    marker: "provedor-entrada-audit-v1",
    generated_at: new Date().toISOString(),
    total_com_saldo: profiles.length,
    total_linhas: rows.length,
    sem_rodada: rows.filter((r) => r.flag === "SEM_RODADA").length,
    backfill_suspeito: rows.filter((r) => r.flag === "BACKFILL_SUSPEITO")
      .length,
    rodada_sem_saldo: rows.filter((r) => r.flag === "RODADA_SEM_SALDO").length,
    total_saldo_cents: rows.reduce((a, r) => a + r.saldo_provedor_cents, 0),
  };

  if (AS_JSON) {
    console.log(JSON.stringify({ summary, rows }, null, 2));
    return;
  }

  console.log("\n=== CLIENTES COM SALDO PROVEDOR — DATA DE ENTRADA ===");
  console.log(
    `Total com saldo: ${summary.total_com_saldo} · Sem rodada: ${summary.sem_rodada} · Backfill suspeito: ${summary.backfill_suspeito} · Soma saldos: ${money(summary.total_saldo_cents)}`
  );
  console.log(
    "Entrada = partner_rounds.signed_at ?? created_at (NÃO é profiles.created_at)\n"
  );

  console.log(
    [
      pad("FLAG", 18),
      pad("NOME", 28),
      pad("SALDO", 14),
      pad("ENTRADA", 20),
      pad("DIAS", 6),
      pad("1º CRÉDITO", 20),
      pad("STATUS RODADA", 12),
      "ID",
    ].join(" ")
  );
  console.log("-".repeat(140));

  for (const r of rows) {
    console.log(
      [
        pad(r.flag, 18),
        pad(r.full_name, 28),
        pad(money(r.saldo_provedor_cents), 14),
        pad(fmtDt(r.entrada_at), 20),
        pad(r.dias_no_provedor == null ? "—" : String(r.dias_no_provedor), 6),
        pad(fmtDt(r.first_credit_at), 20),
        pad(r.round_status || "—", 12),
        r.user_id.slice(0, 8),
      ].join(" ")
    );
  }

  const alerts = rows.filter((r) =>
    ["SEM_RODADA", "BACKFILL_SUSPEITO", "SEM_DATA_ENTRADA", "RODADA_SEM_SALDO"].includes(
      r.flag
    )
  );
  if (alerts.length) {
    console.log("\n=== ALERTAS (detalhe) ===");
    for (const r of alerts) {
      console.log(
        `\n[${r.flag}] ${r.full_name} (${r.user_id.slice(0, 8)})`
      );
      console.log(`  Saldo Provedor: ${money(r.saldo_provedor_cents)}`);
      console.log(`  Conta criada:   ${fmtDt(r.profile_created_at)}`);
      console.log(
        `  Entrada rodada: ${fmtDt(r.entrada_at)} (signed_at=${fmtDt(r.signed_at)} · created_at=${fmtDt(r.round_created_at)})`
      );
      console.log(
        `  1º crédito:     ${fmtDt(r.first_credit_at)} (${r.first_credit_source || "—"})`
      );
      console.log(
        `  Investido/Acum: ${money(r.invested_amount)} / ${money(r.accumulated_amount)} · status=${r.round_status || "—"}`
      );
    }
  }

  console.log("\n=== RESUMO ===");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error("FALHA:", e.message || e);
  process.exit(1);
});
