#!/usr/bin/env node
/**
 * Senilvo — liquidação R$ 200 sem taxa R$ 6,01 (deveria ser Exchange).
 *
 * Relatório:
 *   node scripts/vps-fix-senilvo-taxa-exchange.mjs
 * Debitar a taxa faltante:
 *   FIX=1 node scripts/vps-fix-senilvo-taxa-exchange.mjs
 *
 * Defaults: stake R$ 200, taxa R$ 6,01
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
const NAME = String(process.env.NAME || "SENILVO ACRI CARVALHO").trim();
const STAKE_CENTS = Math.round(Number(process.env.STAKE_CENTS || 20000));
const FEE_CENTS = Math.round(Number(process.env.FEE_CENTS || 601));
const DAYS = Math.max(1, Number(process.env.DAYS || 7));
const SINCE = new Date(Date.now() - DAYS * 864e5).toISOString();

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

async function main() {
  console.log("==> Senilvo — taxa Exchange faltante");
  console.log("    NAME:", NAME);
  console.log("    stake~", money(STAKE_CENTS), "taxa", money(FEE_CENTS));
  console.log("    desde:", SINCE);
  console.log("    FIX:", FIX ? "SIM" : "não");

  const q = encodeURIComponent("%" + NAME + "%");
  const profs = await sb(
    `/rest/v1/profiles?select=id,full_name,balance_cents,reusable_balance_cents,locked_balance_cents,demo_balance_cents,account_status&full_name=ilike.${q}&order=created_at.desc&limit=10`
  );
  const list = Array.isArray(profs) ? profs : [];
  if (!list.length) throw new Error("cliente não encontrado");
  if (list.length > 1) {
    list.forEach((p) =>
      console.log(`  ${p.id}  ${p.full_name}  real=${money(p.balance_cents)}`)
    );
  }
  const user = list[0];
  console.log("\n  user:", user.id);
  console.log("  nome:", user.full_name);
  console.log("  real:", money(user.balance_cents));
  console.log("  reutil:", money(user.reusable_balance_cents));
  console.log("  locked:", money(user.locked_balance_cents));
  console.log(
    "  Apostador:",
    money(n(user.balance_cents) + n(user.reusable_balance_cents) + n(user.demo_balance_cents))
  );

  const lays = await sb(
    `/rest/v1/protections?select=*&user_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=50`
  );
  const backs = await sb(
    `/rest/v1/back_protections?select=*&user_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=50`
  ).catch(() => []);

  const rows = []
    .concat((Array.isArray(lays) ? lays : []).map((r) => ({ ...r, _side: "LAY", _table: "protections" })))
    .concat(
      (Array.isArray(backs) ? backs : []).map((r) => ({
        ...r,
        _side: "BACK",
        _table: "back_protections",
      }))
    )
    .filter((r) => {
      const when = r.settled_at || r.updated_at || r.created_at;
      return when && String(when) >= SINCE;
    });

  console.log(`\n==> Proteções recentes (${DAYS}d): ${rows.length}`);

  const candidates = [];

  for (const row of rows) {
    const stake = n(row.responsibility_cents || row.amount_cents);
    const feeStored = n(
      row.platform_deduction_cents != null
        ? row.platform_deduction_cents
        : row.locked_deduction_cents
    );
    const outcome = String(row.settled_outcome || "—").toLowerCase();
    const st = String(row.status || "").toLowerCase();

    let matchLabel = row.match_id || "?";
    try {
      const ms = await sb(
        `/rest/v1/matches?select=home_team,away_team,starts_at,final_score&id=eq.${encodeURIComponent(row.match_id || "")}&limit=1`
      );
      const m = Array.isArray(ms) ? ms[0] : null;
      if (m) matchLabel = `${m.home_team} × ${m.away_team}  ${m.final_score || ""}`;
    } catch {
      /* */
    }

    const txs = await sb(
      `/rest/v1/wallet_transactions?select=id,type,amount_cents,created_at,metadata,ref&user_id=eq.${encodeURIComponent(user.id)}&or=(ref.eq.${encodeURIComponent(row.id)},metadata->>protection_id.eq.${encodeURIComponent(row.id)})&order=created_at.asc&limit=40`
    ).catch(async () => {
      const all = await sb(
        `/rest/v1/wallet_transactions?select=id,type,amount_cents,created_at,metadata,ref&user_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=300`
      );
      return (Array.isArray(all) ? all : []).filter(
        (t) =>
          String(t.ref || "") === String(row.id) ||
          (t.metadata && String(t.metadata.protection_id || "") === String(row.id))
      );
    });
    const tlist = Array.isArray(txs) ? txs : [];
    const settleTxs = tlist.filter((t) =>
      ["protection_settlement", "protection_release", "protection_refund"].includes(
        String(t.type || "")
      )
    );
    const credited = settleTxs.reduce((s, t) => s + n(t.amount_cents), 0);
    const metaFee = settleTxs.map((t) => n(t.metadata?.fee_cents)).find((x) => x > 0) || 0;

    const stakeMatch =
      Math.abs(stake - STAKE_CENTS) <= 50 || Math.abs(credited - STAKE_CENTS) <= 50;
    const expectExchangeCredit = Math.max(0, stake - (feeStored || FEE_CENTS));
    const overcredit =
      credited >= stake - 1 && (outcome === "exchange" || feeStored > 0 || stakeMatch);

    console.log("\n—", row.id);
    console.log(`  ${row._side}  ${matchLabel}`);
    console.log(
      `  status=${st}  outcome=${outcome}  stake=${money(stake)}  fee_db=${money(feeStored)}`
    );
    console.log(
      `  creditado=${money(credited)}  meta.fee=${money(metaFee)}  esperado_exchange=${money(expectExchangeCredit)}`
    );
    for (const t of settleTxs) {
      console.log(
        `    ${t.created_at}  ${t.type}  ${money(t.amount_cents)}  bucket=${t.metadata?.bucket || "?"} outcome=${t.metadata?.outcome || "?"}`
      );
    }

    // Caso reportado: creditou stake cheio (200) sem taxa 6,01
    if (stakeMatch && credited >= STAKE_CENTS - 1) {
      const missingFee = feeStored > 0 ? feeStored : FEE_CENTS;
      const alreadyClawed = tlist.some(
        (t) =>
          String(t.type) === "admin_adjustment" &&
          t.metadata &&
          String(t.metadata.fix || "").includes("senilvo-taxa")
      );
      candidates.push({
        row,
        stake,
        fee: missingFee,
        credited,
        outcome,
        overBy: Math.max(0, credited - (stake - missingFee)),
        alreadyClawed,
        matchLabel,
      });
      if (outcome === "arbishield") {
        console.log(
          "  ⚠ liquidado como ARBISHIELD (devolve stake cheio). Se era Exchange, falta debitar taxa",
          money(missingFee)
        );
      } else if (outcome === "exchange" && metaFee === 0 && credited >= stake - 1) {
        console.log("  ⚠ outcome=exchange mas creditou stake cheio / fee_cents=0");
      } else {
        console.log("  ⚠ creditou ~stake cheio — possível taxa não descontada", money(missingFee));
      }
      if (alreadyClawed) console.log("  (já tem clawback senilvo-taxa no ledger)");
    }
  }

  console.log("\n========== RESUMO ==========");
  console.log("  candidatos:", candidates.length);
  const toFix = candidates.filter((c) => !c.alreadyClawed && c.overBy > 0);
  const totalFee = toFix.reduce((s, c) => s + c.fee, 0);
  for (const c of toFix) {
    console.log(
      `  ${c.row.id.slice(0, 8)}  ${c.matchLabel}  outcome=${c.outcome}  debitar taxa ${money(c.fee)}`
    );
  }
  console.log("  total a debitar:", money(totalFee || FEE_CENTS));

  if (!toFix.length) {
    // fallback: se saldo bate com 0,39+200 = 200,39 e não achou por filtro, ainda permite FEE fixo
    const apostador =
      n(user.balance_cents) + n(user.reusable_balance_cents) + n(user.demo_balance_cents);
    console.log("\n  Apostador atual:", money(apostador));
    if (!FIX) {
      console.log("  Nenhum candidato claro. Se confirmar taxa faltante:");
      console.log(
        `  FIX=1 FEE_CENTS=${FEE_CENTS} FORCE=1 node scripts/vps-fix-senilvo-taxa-exchange.mjs`
      );
    }
    if (FIX && (process.env.FORCE === "1" || process.env.FORCE === "true")) {
      const fee = FEE_CENTS;
      if (n(user.balance_cents) < fee) throw new Error("saldo insuficiente para debitar taxa");
      const next = n(user.balance_cents) - fee;
      console.log("\n==> FORCE debitando taxa", money(fee));
      await patchBal(user.id, next);
      await postClawback(user.id, fee, null, "FORCE taxa Exchange Senilvo");
      console.log("  real agora", money(next));
      console.log("OK");
      return;
    }
    console.log("OK");
    return;
  }

  if (!FIX) {
    console.log("\n  Para debitar a(s) taxa(s):");
    console.log("  FIX=1 node scripts/vps-fix-senilvo-taxa-exchange.mjs");
    console.log("OK");
    return;
  }

  let bal = n(user.balance_cents);
  for (const c of toFix) {
    const fee = c.fee;
    if (bal < fee) throw new Error(`saldo ${money(bal)} < taxa ${money(fee)}`);
    bal -= fee;
    console.log("\n==> Debitando taxa", money(fee), c.matchLabel, c.row.id.slice(0, 8));
    await patchBal(user.id, bal);
    await postClawback(
      user.id,
      fee,
      c.row.id,
      `clawback taxa Exchange (creditou ${money(c.credited)} em vez de ${money(c.stake - fee)})`
    );
    // Se estava marcado arbishield mas era exchange, corrige outcome
    if (c.outcome === "arbishield" || c.outcome === "—") {
      try {
        await sb(`/rest/v1/${c.row._table}?id=eq.${encodeURIComponent(c.row.id)}`, {
          method: "PATCH",
          body: {
            settled_outcome: "exchange",
            status: "won_exchange",
          },
        });
        console.log("  outcome → exchange / won_exchange");
      } catch (e) {
        console.warn("  status patch:", e.message || e);
      }
    }
    console.log("  real agora", money(bal));
  }

  console.log("\nOK — taxa Exchange debitada");
}

async function patchBal(userId, balanceCents) {
  try {
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: { balance_cents: balanceCents, updated_at: new Date().toISOString() },
    });
  } catch {
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: { balance_cents: balanceCents },
    });
  }
}

async function postClawback(userId, fee, protectionId, reason) {
  await sb("/rest/v1/wallet_transactions", {
    method: "POST",
    body: {
      user_id: userId,
      type: "admin_adjustment",
      amount_cents: -fee,
      ref: protectionId,
      metadata: {
        reason,
        fee_cents: fee,
        protection_id: protectionId,
        fix: "vps-fix-senilvo-taxa-exchange-v1",
      },
    },
  });
}

main().catch((e) => {
  console.error("FALHA:", e.message || e);
  process.exit(1);
});
