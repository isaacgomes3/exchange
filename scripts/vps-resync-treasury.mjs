#!/usr/bin/env node
/**
 * Resync / backfill de platform_treasury desde a última atualização.
 *
 * Dry-run (padrão):
 *   node scripts/vps-resync-treasury.mjs
 *
 * Aplicar:
 *   APPLY=1 node scripts/vps-resync-treasury.mjs
 *
 * Desde data explícita (America/Sao_Paulo):
 *   FROM=2026-07-19 APPLY=1 node scripts/vps-resync-treasury.mjs
 */
import fs from "node:fs";
import path from "node:path";

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

const APPLY = String(process.env.APPLY || "") === "1";

function n(v) {
  return Number(v || 0);
}
function money(cents) {
  return (Number(cents || 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

async function sb(p, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}${p}`, {
    method: opts.method || "GET",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: "application/json",
      ...(opts.body
        ? { "Content-Type": "application/json", Prefer: "return=representation" }
        : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`${res.status} ${p}: ${String(text).slice(0, 280)}`);
  }
  return data;
}

async function sbAll(basePath) {
  const pageSize = 1000;
  let from = 0;
  const out = [];
  for (;;) {
    const sep = basePath.includes("?") ? "&" : "?";
    const rows = await sb(`${basePath}${sep}limit=${pageSize}&offset=${from}`);
    const list = Array.isArray(rows) ? rows : [];
    out.push(...list);
    if (list.length < pageSize) break;
    from += pageSize;
    if (from > 50000) break;
  }
  return out;
}

function platformCut(row) {
  const plat =
    n(row.platform_profit_cents) ||
    n(row.platform_deduction_cents) ||
    n(row.locked_deduction_cents);
  return plat + n(row.exchange_profit_net_cents) + n(row.exchange_fee_cents);
}

async function main() {
  console.log("════════════════════════════════════════════════════════════");
  console.log(" RESYNC TESOURARIA  (treasury-writers-v1)");
  console.log(` Modo: ${APPLY ? "APPLY (vai gravar)" : "DRY-RUN (só calcula)"}`);
  console.log("════════════════════════════════════════════════════════════");

  const tRows = await sb(
    "/rest/v1/platform_treasury?select=*&order=updated_at.desc&limit=1"
  );
  const treasury = Array.isArray(tRows) ? tRows[0] : null;
  if (!treasury?.id) {
    console.error("ERRO: platform_treasury sem linha");
    process.exit(1);
  }

  const cashNow = n(
    treasury.operational_balance_cents ?? treasury.balance_cents ?? 0
  );
  console.log("\n── TESOURARIA ATUAL ────────────────────────────────────────");
  console.log("  id:", treasury.id);
  console.log("  operational/balance:", money(cashNow));
  console.log("  updated_at:", treasury.updated_at);

  let fromIso;
  if (process.env.FROM) {
    fromIso = new Date(`${process.env.FROM}T00:00:00-03:00`).toISOString();
  } else if (treasury.updated_at) {
    fromIso = new Date(treasury.updated_at).toISOString();
  } else {
    fromIso = new Date("2026-07-19T00:00:00-03:00").toISOString();
  }
  const toIso = new Date().toISOString();
  console.log(`  Janela: ${fromIso} → ${toIso}`);

  async function alreadyTreasury(action, entityType, entityId) {
    try {
      const rows = await sb(
        `/rest/v1/admin_audit_logs?select=id&action=eq.${encodeURIComponent(action)}&entity_type=eq.${encodeURIComponent(entityType)}&entity_id=eq.${encodeURIComponent(entityId)}&limit=1`
      );
      return Array.isArray(rows) && rows.length > 0;
    } catch {
      return false;
    }
  }

  // ── Desafio casa-win ───────────────────────────────────────────────
  let steps = [];
  try {
    steps = await sbAll(
      `/rest/v1/desafio_steps?select=id,result,settled_at,match_label,home_team,away_team,step_index&result=eq.win&settled_at=gt.${encodeURIComponent(fromIso)}&settled_at=lte.${encodeURIComponent(toIso)}&order=settled_at.asc`
    );
  } catch (e) {
    console.warn("desafio_steps:", e.message);
  }

  let desafioZebra = 0;
  let desafioCasaPaid = 0;
  let desafioSkipped = 0;
  const desafioLines = [];
  for (let i = 0; i < steps.length; i += 40) {
    const chunk = steps.slice(i, i + 40);
    const ids = chunk.map((s) => s.id).join(",");
    if (!ids) continue;
    let parts = [];
    try {
      parts = await sbAll(
        `/rest/v1/desafio_participations?select=id,step_id,side,result,amount_cents,profit_cents&step_id=in.(${ids})`
      );
    } catch (e) {
      console.warn("participations:", e.message);
    }
    const byStep = new Map();
    for (const p of parts) {
      if (!byStep.has(p.step_id)) byStep.set(p.step_id, []);
      byStep.get(p.step_id).push(p);
    }
    for (const s of chunk) {
      if (await alreadyTreasury("TREASURY_DESAFIO_CASA_WIN", "desafio_steps", s.id)) {
        desafioSkipped += 1;
        continue;
      }
      const list = byStep.get(s.id) || [];
      let zebra = 0;
      let casa = 0;
      for (const p of list) {
        const side = String(p.side || "").toLowerCase();
        const res = String(p.result || "").toLowerCase();
        if (side === "arbishield" && res !== "won" && res !== "win" && res !== "pending") {
          zebra += n(p.amount_cents);
        }
        if (side === "casa" && (res === "won" || res === "win")) {
          casa += n(p.profit_cents);
        }
      }
      desafioZebra += zebra;
      desafioCasaPaid += casa;
      const label =
        s.match_label ||
        [s.home_team, s.away_team].filter(Boolean).join(" x ") ||
        s.id.slice(0, 8);
      desafioLines.push({
        id: s.id,
        label,
        net: zebra - casa,
        zebra,
        casa,
        settled_at: s.settled_at,
      });
    }
  }
  const desafioNet = desafioZebra - desafioCasaPaid;

  // ── Proteções (fee/cut) ────────────────────────────────────────────
  async function loadProt(table) {
    try {
      return await sbAll(
        `/rest/v1/${table}?select=id,status,settled_at,platform_profit_cents,platform_deduction_cents,locked_deduction_cents,exchange_profit_net_cents,exchange_fee_cents,amount_cents,responsibility_cents&settled_at=gt.${encodeURIComponent(fromIso)}&settled_at=lte.${encodeURIComponent(toIso)}`
      );
    } catch (e) {
      console.warn(table, e.message);
      return [];
    }
  }
  const lays = await loadProt("protections");
  const backs = await loadProt("back_protections");
  let protCut = 0;
  let protN = 0;
  let protSkipped = 0;
  for (const r of [
    ...lays.map((x) => ({ ...x, _table: "protections" })),
    ...backs.map((x) => ({ ...x, _table: "back_protections" })),
  ]) {
    const cut = platformCut(r);
    if (!(cut > 0)) continue;
    const st = String(r.status || "").toLowerCase();
    // Bateu ArbiShield com reembolso integral → cut 0 na prática; se status won_platform, pula
    if (st.includes("won_platform")) continue;
    if (await alreadyTreasury("TREASURY_PROTECTION_FEE", r._table, r.id)) {
      protSkipped += 1;
      continue;
    }
    protCut += cut;
    protN += 1;
  }

  // ── Depósitos aprovados ────────────────────────────────────────────
  let deposits = 0;
  let depN = 0;
  let depSkipped = 0;
  async function addApprovedDeposits(rows) {
    for (const r of rows) {
      if (await alreadyTreasury("TREASURY_DEPOSIT_IN", "manual_deposits", r.id)) {
        depSkipped += 1;
        continue;
      }
      deposits += n(r.amount_cents);
      depN += 1;
    }
  }
  try {
    const rows = await sbAll(
      `/rest/v1/manual_deposits?select=id,amount_cents,status,reviewed_at,updated_at,created_at&status=eq.APPROVED&reviewed_at=gt.${encodeURIComponent(fromIso)}&reviewed_at=lte.${encodeURIComponent(toIso)}`
    );
    await addApprovedDeposits(rows);
  } catch {
    try {
      const rows = await sbAll(
        `/rest/v1/manual_deposits?select=id,amount_cents,status,updated_at,created_at&status=eq.APPROVED&updated_at=gt.${encodeURIComponent(fromIso)}&updated_at=lte.${encodeURIComponent(toIso)}`
      );
      await addApprovedDeposits(rows);
    } catch (e) {
      console.warn("manual_deposits:", e.message);
    }
  }

  // ── Saídas (refunds / withdraw / expenses) ─────────────────────────
  let refunds = 0;
  try {
    const rows = await sbAll(
      `/rest/v1/wallet_transactions?select=amount_cents,type&type=in.(protection_refund,refund,desafio_cancel_refund)&created_at=gt.${encodeURIComponent(fromIso)}&created_at=lte.${encodeURIComponent(toIso)}`
    );
    refunds = rows.reduce((a, r) => a + n(r.amount_cents), 0);
  } catch {
    /* */
  }
  let withdraws = 0;
  try {
    const rows = await sbAll(
      `/rest/v1/wallet_transactions?select=amount_cents,type&type=in.(withdrawal,withdraw,affiliate_withdraw)&created_at=gt.${encodeURIComponent(fromIso)}&created_at=lte.${encodeURIComponent(toIso)}`
    );
    withdraws = rows.reduce((a, r) => a + Math.abs(n(r.amount_cents)), 0);
  } catch {
    /* */
  }
  let expenses = 0;
  try {
    const rows = await sbAll(
      `/rest/v1/admin_expenses?select=amount_cents,created_at&created_at=gt.${encodeURIComponent(fromIso)}&created_at=lte.${encodeURIComponent(toIso)}`
    );
    expenses = rows.reduce((a, r) => a + n(r.amount_cents), 0);
  } catch {
    /* */
  }

  const credits = desafioNet + protCut + deposits;
  const debits = refunds + withdraws + expenses;
  const delta = credits - debits;
  const projected = cashNow + delta;

  console.log("\n── DELTAS DESDE A ÚLTIMA UPDATE ─────────────────────────────");
  console.log(
    `  Desafio casa-win:     ${money(desafioNet)}  (${desafioLines.length} etapas, skip=${desafioSkipped}/${steps.length})`
  );
  for (const line of desafioLines.slice(0, 20)) {
    console.log(
      `    • ${line.label.slice(0, 40).padEnd(40)}  ${money(line.net)}`
    );
  }
  if (desafioLines.length > 20) console.log(`    … +${desafioLines.length - 20} etapas`);
  console.log(`  Proteções (fee/cut):  ${money(protCut)}  (${protN} rows, skip=${protSkipped})`);
  console.log(`  Depósitos aprovados:  ${money(deposits)}  (${depN}, skip=${depSkipped})`);
  console.log(`  − Refunds:            ${money(refunds)}`);
  console.log(`  − Saques:             ${money(withdraws)}`);
  console.log(`  − Despesas:           ${money(expenses)}`);
  console.log("  ─────────────────────────────────────────────────────────");
  console.log(`  DELTA total:          ${money(delta)}`);
  console.log(`  Saldo atual:          ${money(cashNow)}`);
  console.log(`  Saldo projetado:      ${money(projected)}`);

  if (!APPLY) {
    console.log("\nDry-run OK. Para gravar:");
    console.log("  APPLY=1 node scripts/vps-resync-treasury.mjs");
    console.log("\nOK — resync dry-run concluído.\n");
    return;
  }

  if (!delta) {
    console.log("\nNada a aplicar (delta=0).");
    return;
  }

  const body = {
    operational_balance_cents: projected,
    updated_at: new Date().toISOString(),
  };
  if (treasury.balance_cents != null) {
    body.balance_cents = n(treasury.balance_cents) + delta;
  }

  await sb(`/rest/v1/platform_treasury?id=eq.${encodeURIComponent(treasury.id)}`, {
    method: "PATCH",
    body,
  });

  // Marca cada entidade para idempotência (próximo resync / writers futuros)
  async function mark(action, entityType, entityId, details) {
    try {
      await sb("/rest/v1/admin_audit_logs", {
        method: "POST",
        body: {
          admin_id: null,
          action,
          entity_type: entityType,
          entity_id: entityId,
          details: { ...details, via: "resync", fix: "treasury-writers-v1" },
        },
      });
    } catch {
      /* */
    }
  }
  for (const line of desafioLines) {
    await mark("TREASURY_DESAFIO_CASA_WIN", "desafio_steps", line.id, {
      delta_cents: line.net,
      zebra_kept_cents: line.zebra,
      casa_paid_cents: line.casa,
    });
  }
  for (const r of [
    ...lays.map((x) => ({ ...x, _table: "protections" })),
    ...backs.map((x) => ({ ...x, _table: "back_protections" })),
  ]) {
    const cut = platformCut(r);
    if (!(cut > 0)) continue;
    if (String(r.status || "").toLowerCase().includes("won_platform")) continue;
    if (await alreadyTreasury("TREASURY_PROTECTION_FEE", r._table, r.id)) continue;
    await mark("TREASURY_PROTECTION_FEE", r._table, r.id, { cut_cents: cut });
  }
  // depósitos: re-lista só os que entraram no somatório
  try {
    let depRows = [];
    try {
      depRows = await sbAll(
        `/rest/v1/manual_deposits?select=id,amount_cents&status=eq.APPROVED&reviewed_at=gt.${encodeURIComponent(fromIso)}&reviewed_at=lte.${encodeURIComponent(toIso)}`
      );
    } catch {
      depRows = await sbAll(
        `/rest/v1/manual_deposits?select=id,amount_cents&status=eq.APPROVED&updated_at=gt.${encodeURIComponent(fromIso)}&updated_at=lte.${encodeURIComponent(toIso)}`
      );
    }
    for (const r of depRows) {
      if (await alreadyTreasury("TREASURY_DEPOSIT_IN", "manual_deposits", r.id)) continue;
      await mark("TREASURY_DEPOSIT_IN", "manual_deposits", r.id, {
        amount_cents: n(r.amount_cents),
      });
    }
  } catch {
    /* */
  }

  try {
    await sb("/rest/v1/admin_audit_logs", {
      method: "POST",
      body: {
        admin_id: null,
        action: "TREASURY_BACKFILL_RESYNC",
        entity_type: "platform_treasury",
        entity_id: treasury.id,
        details: {
          from_iso: fromIso,
          to_iso: toIso,
          before_cents: cashNow,
          delta_cents: delta,
          after_cents: projected,
          desafio_net_cents: desafioNet,
          protection_cut_cents: protCut,
          deposits_cents: deposits,
          refunds_cents: refunds,
          withdraws_cents: withdraws,
          expenses_cents: expenses,
          fix: "treasury-writers-v1",
        },
      },
    });
  } catch (e) {
    console.warn("audit:", e.message);
  }

  console.log("\nAPLICADO.");
  console.log(`  ${money(cashNow)} → ${money(projected)}`);
  console.log("\nOK — resync APPLY concluído.\n");
}

main().catch((err) => {
  console.error("ERRO:", err.message || err);
  process.exit(1);
});
