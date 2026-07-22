#!/usr/bin/env node
/**
 * Auditoria Pedro Iuri — settlements ArbiShield sem reembolso no saldo real.
 *
 * Relatório:
 *   NAME="PEDRO IURI" node scripts/vps-audit-pedro-arbishield.mjs
 *   ID_PREFIX=24037bdf node scripts/vps-audit-pedro-arbishield.mjs
 *
 * Corrigir (move reusable→real das liquidações arbishield + credita faltantes):
 *   FIX=1 ID_PREFIX=24037bdf node scripts/vps-audit-pedro-arbishield.mjs
 *
 * DAYS=7 limita partidas/proteções recentes (default 14).
 */
import fs from "node:fs";
import path from "node:path";

const FIX = process.env.FIX === "1" || process.env.FIX === "true";
/** Com FIX=1, move TODO o reusable → real (política: saldo sempre real). */
const MOVE_ALL_REUSABLE =
  process.env.MOVE_ALL_REUSABLE === "1" ||
  process.env.MOVE_ALL_REUSABLE === "true" ||
  (FIX && process.env.MOVE_ALL_REUSABLE !== "0");
const NAME = String(
  process.env.NAME || "PEDRO IURI TEIXEIRA DOS SANTOS"
).trim();
const ID_PREFIX = String(process.env.ID_PREFIX || "24037bdf").trim().toLowerCase();
const DAYS = Math.max(1, Number(process.env.DAYS || 14));
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

function feeOf(row) {
  const raw =
    row.platform_deduction_cents != null
      ? row.platform_deduction_cents
      : row.locked_deduction_cents;
  return Math.max(0, n(raw));
}

function expectedCredit(row) {
  const amount = n(row.responsibility_cents || row.amount_cents);
  const outcome = String(row.settled_outcome || "").toLowerCase();
  if (outcome === "arbishield" || outcome === "platform") return amount;
  if (outcome === "exchange") return Math.max(0, amount - Math.min(feeOf(row), amount));
  // status lost_exchange normalmente = bateu arbishield
  const st = String(row.status || "").toLowerCase();
  if (st === "lost_exchange" || st === "won_platform") return amount;
  if (st === "won_exchange") return Math.max(0, amount - Math.min(feeOf(row), amount));
  return amount;
}

function isArbishieldOutcome(row) {
  const outcome = String(row.settled_outcome || "").toLowerCase();
  const st = String(row.status || "").toLowerCase();
  if (outcome === "arbishield" || outcome === "platform") return true;
  if (st === "lost_exchange" || st === "won_platform") return true;
  return false;
}

function isClosed(row) {
  const st = String(row.status || "").toLowerCase();
  return [
    "settled",
    "won_exchange",
    "lost_exchange",
    "won_platform",
    "lost_platform",
    "cancelled",
    "closed_no_refund",
    "refund_requested",
    "pending_refund",
  ].includes(st);
}

async function resolveUser() {
  if (ID_PREFIX) {
    const rows = await sb(
      `/rest/v1/profiles?select=id,full_name,account_status,balance_cents,reusable_balance_cents,locked_balance_cents,demo_balance_cents,updated_at&order=created_at.desc&limit=5000`
    );
    const list = (Array.isArray(rows) ? rows : []).filter((r) =>
      String(r.id || "").toLowerCase().startsWith(ID_PREFIX)
    );
    if (list.length) return list[0];
  }
  const q = encodeURIComponent("%" + NAME + "%");
  const rows = await sb(
    `/rest/v1/profiles?select=id,full_name,account_status,balance_cents,reusable_balance_cents,locked_balance_cents,demo_balance_cents,updated_at&full_name=ilike.${q}&order=created_at.desc&limit=20`
  );
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) throw new Error(`cliente não encontrado: ${NAME}`);
  if (list.length > 1) {
    console.log("Matches:");
    list.forEach((p) =>
      console.log(
        `  ${p.id}  ${p.full_name}  real=${money(p.balance_cents)}  reutil=${money(p.reusable_balance_cents)}`
      )
    );
  }
  return list[0];
}

async function txsForProtection(userId, protectionId) {
  try {
    const txs = await sb(
      `/rest/v1/wallet_transactions?select=id,type,amount_cents,created_at,metadata,ref&or=(ref.eq.${encodeURIComponent(protectionId)},metadata->>protection_id.eq.${encodeURIComponent(protectionId)})&order=created_at.asc&limit=50`
    );
    return Array.isArray(txs) ? txs : [];
  } catch {
    const all = await sb(
      `/rest/v1/wallet_transactions?select=id,type,amount_cents,created_at,metadata,ref&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=500`
    );
    return (Array.isArray(all) ? all : []).filter(
      (t) =>
        String(t.ref || "") === String(protectionId) ||
        (t.metadata && String(t.metadata.protection_id || "") === String(protectionId))
    );
  }
}

async function patchProfile(userId, patch) {
  try {
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: { ...patch, updated_at: new Date().toISOString() },
    });
  } catch {
    await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: patch,
    });
  }
}

async function main() {
  console.log("==> Auditoria ArbiShield / reembolso");
  console.log("    NAME:", NAME);
  console.log("    ID_PREFIX:", ID_PREFIX || "—");
  console.log("    desde:", SINCE, `(${DAYS}d)`);
  console.log("    FIX:", FIX ? "SIM" : "não (só relatório)");
  console.log(
    "    MOVE_ALL_REUSABLE:",
    MOVE_ALL_REUSABLE ? "SIM (tudo → saldo real)" : "não"
  );

  const user = await resolveUser();
  console.log("\n  user:", user.id);
  console.log("  nome:", user.full_name);
  console.log("  status:", user.account_status);
  console.log("  real:", money(user.balance_cents));
  console.log("  reutilizável:", money(user.reusable_balance_cents));
  console.log("  locked:", money(user.locked_balance_cents));
  console.log(
    "  Apostador (real+reutil+demo):",
    money(n(user.balance_cents) + n(user.reusable_balance_cents) + n(user.demo_balance_cents))
  );

  const lays = await sb(
    `/rest/v1/protections?select=*&user_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=200`
  );
  const backs = await sb(
    `/rest/v1/back_protections?select=*&user_id=eq.${encodeURIComponent(user.id)}&order=created_at.desc&limit=200`
  ).catch(() => []);

  let rows = []
    .concat(
      (Array.isArray(lays) ? lays : []).map((r) => ({ ...r, _table: "protections", _side: "LAY" }))
    )
    .concat(
      (Array.isArray(backs) ? backs : []).map((r) => ({
        ...r,
        _table: "back_protections",
        _side: "BACK",
      }))
    );

  // Filtra por recência (created ou settled)
  rows = rows.filter((r) => {
    const c = r.settled_at || r.created_at || r.updated_at;
    return c && String(c) >= SINCE;
  });

  const matchIds = [...new Set(rows.map((r) => r.match_id).filter(Boolean))];
  const matchMap = {};
  if (matchIds.length) {
    const chunk = matchIds.slice(0, 80);
    const inList = chunk.map((id) => `"${id}"`).join(",");
    const selects = [
      "id,home_team,away_team,league,starts_at,status,final_score",
      "id,home_team,away_team,league,starts_at,status",
    ];
    let loaded = false;
    for (const sel of selects) {
      try {
        const ms = await sb(
          `/rest/v1/matches?select=${sel}&id=in.(${inList})`
        );
        for (const m of Array.isArray(ms) ? ms : []) matchMap[m.id] = m;
        loaded = true;
        break;
      } catch (e) {
        console.warn("  matches select falhou:", e.message || e);
      }
    }
    if (!loaded) console.warn("  ⚠ sem metadados de partidas — seguindo só com proteções");
  }

  console.log(`\n==> Proteções últimos ${DAYS}d: ${rows.length}`);

  const actions = {
    moveReusable: [], // { id, amount, bucket }
    creditMissing: [], // { id, amount, row }
    closedNoRefund: [],
    okReal: [],
    active: [],
  };

  for (const row of rows) {
    const m = matchMap[row.match_id] || {};
    const amount = n(row.responsibility_cents || row.amount_cents);
    const expect = expectedCredit(row);
    const st = String(row.status || "").toLowerCase();
    const outcome = String(row.settled_outcome || "—").toLowerCase();
    const jogo = `${m.home_team || "?"} × ${m.away_team || "?"}`;

    console.log("\n—", row.id);
    console.log(`  ${jogo}  ${m.starts_at || ""}  placar ${m.final_score ?? "—"}`);
    console.log(
      `  ${row._side}  status=${st}  outcome=${outcome}  stake=${money(amount)}  esperado=${money(expect)}`
    );

    if (!isClosed(row)) {
      console.log("  → ATIVA (ainda aberta)");
      actions.active.push(row);
      continue;
    }

    if (st === "closed_no_refund" || /no_refund|sem.?estorno/i.test(outcome)) {
      console.log("  ⚠ ENCERRADA SEM ESTORNO (ADM Monitor)");
      actions.closedNoRefund.push({ row, amount, expect, jogo });
      continue;
    }

    const tlist = await txsForProtection(user.id, row.id);
    const creditTxs = tlist.filter((t) =>
      ["protection_settlement", "protection_release", "protection_refund"].includes(
        String(t.type || "")
      )
    );
    console.log("  wallet_tx crédito:");
    if (!creditTxs.length) console.log("    (nenhuma)");
    for (const t of creditTxs) {
      const bucket = t.metadata?.bucket || "?";
      console.log(
        `    ${t.created_at}  ${t.type}  ${money(t.amount_cents)}  bucket=${bucket}`
      );
    }

    if (!creditTxs.length) {
      if (isArbishieldOutcome(row) || expect > 0) {
        console.log("  ⚠ ENCERRADA SEM CRÉDITO NO LEDGER");
        actions.creditMissing.push({ row, amount: expect, jogo });
      } else {
        console.log("  → encerrada sem crédito esperado");
      }
      continue;
    }

    const credited = creditTxs.reduce((s, t) => s + n(t.amount_cents), 0);
    const anyReusable = creditTxs.some(
      (t) => String(t.metadata?.bucket || "") === "reusable_balance_cents"
    );
    const anyReal = creditTxs.some(
      (t) => String(t.metadata?.bucket || "") === "balance_cents"
    );

    if (anyReusable && !anyReal && isArbishieldOutcome(row)) {
      console.log(
        `  ⚠ crédito foi para REUTILIZÁVEL (${money(credited)}) — cliente não vê reembolso “real”`
      );
      actions.moveReusable.push({
        row,
        amount: credited > 0 ? credited : expect,
        jogo,
      });
    } else if (anyReal || !anyReusable) {
      console.log(`  → OK crédito no ledger (${money(credited)})`);
      actions.okReal.push({ row, amount: credited, jogo });
    } else {
      console.log(`  → crédito presente (${money(credited)})`);
      actions.okReal.push({ row, amount: credited, jogo });
    }
  }

  console.log("\n========== RESUMO ==========");
  console.log("  OK (ledger):", actions.okReal.length);
  console.log("  Em reusable (mover→real):", actions.moveReusable.length);
  console.log("  Sem crédito (creditar):", actions.creditMissing.length);
  console.log("  Sem estorno (ADM):", actions.closedNoRefund.length);
  console.log("  Ainda ativas:", actions.active.length);

  const moveTotal = actions.moveReusable.reduce((s, x) => s + x.amount, 0);
  const missTotal = actions.creditMissing.reduce((s, x) => s + x.amount, 0);
  console.log("  total a mover reusable→real:", money(moveTotal));
  console.log("  total a creditar faltante:", money(missTotal));

  if (actions.closedNoRefund.length) {
    console.log("\n  (Sem estorno — NÃO auto-corrige; use Cancelar e estornar no Monitor se for o caso)");
    for (const x of actions.closedNoRefund) {
      console.log(`    ${x.row.id.slice(0, 8)}  ${x.jogo}  ${money(x.amount)}`);
    }
  }

  if (!FIX) {
    if (moveTotal > 0 || missTotal > 0 || n(user.reusable_balance_cents) > 0) {
      console.log("\n  Para mover reusable → saldo real (e creditar faltantes):");
      console.log(
        `  FIX=1 ID_PREFIX=${ID_PREFIX || "24037bdf"} node scripts/vps-audit-pedro-arbishield.mjs`
      );
    }
    console.log("OK");
    return;
  }

  // Aplicar correções — política: crédito sempre no saldo real
  let bal = n(user.balance_cents);
  let reusable = n(user.reusable_balance_cents);
  const now = new Date().toISOString();

  const wantMove = MOVE_ALL_REUSABLE
    ? reusable
    : Math.min(moveTotal > 0 ? moveTotal : 0, reusable);

  if (wantMove > 0) {
    console.log(
      "\n==> Movendo",
      money(wantMove),
      "reusable → real",
      MOVE_ALL_REUSABLE ? "(todo o reutilizável)" : "(só settlements ArbiShield)"
    );
    bal += wantMove;
    reusable -= wantMove;
    await patchProfile(user.id, {
      balance_cents: bal,
      reusable_balance_cents: reusable,
    });
    await sb("/rest/v1/wallet_transactions", {
      method: "POST",
      body: {
        user_id: user.id,
        type: "admin_adjustment",
        amount_cents: wantMove,
        ref: actions.moveReusable[0]?.row?.id || null,
        metadata: {
          reason: "mover reusable→real (política: saldo sempre real)",
          protections: actions.moveReusable.map((x) => x.row.id),
          fix: "vps-audit-pedro-arbishield-v2",
          bucket_from: "reusable_balance_cents",
          bucket_to: "balance_cents",
          move_all_reusable: MOVE_ALL_REUSABLE,
        },
      },
    });
    console.log("  saldo agora real", money(bal), "reutil", money(reusable));
  } else if (moveTotal > 0) {
    console.log("\n  ⚠ pediu mover", money(moveTotal), "mas reusable está", money(reusable));
  }

  for (const item of actions.creditMissing) {
    const pay = item.amount;
    if (!(pay > 0)) continue;
    console.log("\n==> Creditando faltante", money(pay), item.jogo, item.row.id.slice(0, 8));
    bal += pay;
    const locked = Math.max(
      0,
      n(user.locked_balance_cents) - n(item.row.responsibility_cents || item.row.amount_cents)
    );
    await patchProfile(user.id, {
      balance_cents: bal,
      locked_balance_cents: locked,
    });
    user.locked_balance_cents = locked;
    await sb("/rest/v1/wallet_transactions", {
      method: "POST",
      body: {
        user_id: user.id,
        type: "protection_settlement",
        amount_cents: pay,
        ref: item.row.id,
        metadata: {
          protection_id: item.row.id,
          match_id: item.row.match_id || null,
          outcome: String(item.row.settled_outcome || "arbishield").toLowerCase(),
          stake_cents: n(item.row.responsibility_cents || item.row.amount_cents),
          bucket: "balance_cents",
          reason: "clawback_settlement_faltante_pedro",
          fix: "vps-audit-pedro-arbishield-v1",
          at: now,
        },
      },
    });
    console.log("  creditado → real", money(bal));
  }

  const refreshed = await sb(
    `/rest/v1/profiles?select=balance_cents,reusable_balance_cents,locked_balance_cents&id=eq.${encodeURIComponent(user.id)}&limit=1`
  );
  const p2 = Array.isArray(refreshed) ? refreshed[0] : null;
  console.log("\n==> Saldo final");
  console.log("  real:", money(p2?.balance_cents));
  console.log("  reutil:", money(p2?.reusable_balance_cents));
  console.log("  locked:", money(p2?.locked_balance_cents));
  console.log("OK");
}

main().catch((e) => {
  console.error("FALHA:", e.message || e);
  process.exit(1);
});
