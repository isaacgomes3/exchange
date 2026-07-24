#!/usr/bin/env node
/**
 * Auditoria do dia — eventos, lucro (dedução plataforma), saldo empresa.
 *
 * Na VPS:
 *   DAY=2026-07-24 node scripts/vps-auditoria-dia.mjs
 *   node scripts/vps-auditoria-dia.mjs   # hoje (America/Sao_Paulo)
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
  "/opt/arbishield/.arbishield-odds-sync.env",
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
  return String(s ?? "").padEnd(w);
}
function padL(s, w) {
  return String(s ?? "").padStart(w);
}

function dayBounds(dayStr) {
  // Dia civil America/Sao_Paulo
  const day =
    dayStr ||
    new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const fromIso = new Date(`${day}T00:00:00-03:00`).toISOString();
  const toIso = new Date(`${day}T23:59:59.999-03:00`).toISOString();
  return { day, fromIso, toIso };
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
  // Paginação simples por range
  const pageSize = 1000;
  let from = 0;
  const out = [];
  for (;;) {
    const sep = basePath.includes("?") ? "&" : "?";
    const rows = await sb(
      `${basePath}${sep}limit=${pageSize}&offset=${from}`
    );
    const list = Array.isArray(rows) ? rows : [];
    out.push(...list);
    if (list.length < pageSize) break;
    from += pageSize;
    if (from > 20000) break;
  }
  return out;
}

function matchLabel(m) {
  if (!m) return "—";
  const teams =
    m.match_label ||
    [m.home_team, m.away_team].filter(Boolean).join(" x ") ||
    m.title ||
    m.id;
  return String(teams);
}

function platformCut(p) {
  return (
    n(p.platform_profit_cents) +
    n(p.platform_deduction_cents) +
    n(p.exchange_profit_net_cents) +
    n(p.exchange_fee_cents)
  );
}

function stakeOf(p) {
  return n(p.responsibility_cents || p.amount_cents);
}

async function main() {
  const { day, fromIso, toIso } = dayBounds(process.env.DAY || "");
  console.log("════════════════════════════════════════════════════════════");
  console.log(` AUDITORIA DO DIA  ${day}  (America/Sao_Paulo)`);
  console.log(` Janela UTC: ${fromIso} → ${toIso}`);
  console.log(` Supabase: ${SUPABASE_URL}`);
  console.log("════════════════════════════════════════════════════════════");

  // ── Tesouraria / saldo empresa ─────────────────────────────────────
  let treasury = null;
  try {
    const rows = await sb(
      "/rest/v1/platform_treasury?select=*&order=updated_at.desc&limit=1"
    );
    treasury = Array.isArray(rows) ? rows[0] : null;
  } catch (e) {
    console.warn("treasury:", e.message);
  }

  const cashNow = n(
    treasury?.balance_cents ??
      treasury?.operational_balance_cents ??
      treasury?.cash_balance_cents ??
      0
  );
  const reserve = n(treasury?.reserve_balance_cents);
  const lockedT = n(treasury?.locked_balance_cents);

  console.log("\n── SALDO EMPRESA (tesouraria) ──────────────────────────────");
  if (!treasury) {
    console.log("  (sem linha em platform_treasury)");
  } else {
    console.log("  Saldo atual (balance/operational):", money(cashNow));
    if (reserve) console.log("  Reserva:", money(reserve));
    if (lockedT) console.log("  Travado na tesouraria:", money(lockedT));
    if (treasury.updated_at) console.log("  Atualizado em:", treasury.updated_at);
  }

  // ── Eventos (matches) liquidados hoje ──────────────────────────────
  let matches = [];
  try {
    matches = await sbAll(
      `/rest/v1/matches?select=id,home_team,away_team,match_label,league_name,status,starts_at,settled_at,final_score,liquidity_cents,used_liquidity_cents,markets&settled_at=gte.${encodeURIComponent(fromIso)}&settled_at=lte.${encodeURIComponent(toIso)}&order=settled_at.asc`
    );
  } catch (e) {
    console.warn("matches settled_at:", e.message);
    try {
      matches = await sbAll(
        `/rest/v1/matches?select=id,home_team,away_team,match_label,league_name,status,starts_at,settled_at,final_score&status=eq.settled&updated_at=gte.${encodeURIComponent(fromIso)}&updated_at=lte.${encodeURIComponent(toIso)}&order=updated_at.asc`
      );
    } catch (e2) {
      console.warn("matches fallback:", e2.message);
    }
  }

  console.log("\n── EVENTOS LIQUIDADOS HOJE ─────────────────────────────────");
  console.log(`  Total: ${matches.length}`);
  for (const m of matches) {
    const when = m.settled_at
      ? new Date(m.settled_at).toLocaleString("pt-BR", {
          timeZone: "America/Sao_Paulo",
        })
      : "—";
    console.log(
      `  • ${pad(matchLabel(m), 42)}  placar=${pad(m.final_score || "—", 7)}  ${when}`
    );
  }

  // ── Proteções liquidadas hoje ──────────────────────────────────────
  const settledStatuses =
    "won_exchange,won_platform,lost_exchange,lost_platform,settled,cancelled";
  let lays = [];
  let backs = [];
  try {
    lays = await sbAll(
      `/rest/v1/protections?select=id,user_id,match_id,market_id,status,result,amount_cents,responsibility_cents,platform_profit_cents,platform_deduction_cents,exchange_profit_net_cents,exchange_fee_cents,user_profit_cents,settled_at,settled_outcome,created_at&settled_at=gte.${encodeURIComponent(fromIso)}&settled_at=lte.${encodeURIComponent(toIso)}&order=settled_at.asc`
    );
  } catch (e) {
    console.warn("protections:", e.message);
  }
  try {
    backs = await sbAll(
      `/rest/v1/back_protections?select=id,user_id,match_id,market_id,status,result,amount_cents,responsibility_cents,platform_profit_cents,platform_deduction_cents,exchange_profit_net_cents,exchange_fee_cents,user_profit_cents,settled_at,settled_outcome,created_at&settled_at=gte.${encodeURIComponent(fromIso)}&settled_at=lte.${encodeURIComponent(toIso)}&order=settled_at.asc`
    );
  } catch (e) {
    console.warn("back_protections:", e.message);
  }

  const allProt = [
    ...lays.map((r) => ({ ...r, _side: "LAY" })),
    ...backs.map((r) => ({ ...r, _side: "BACK" })),
  ];

  // Mapa de partidas (inclui as referenciadas mesmo se settled_at do match falhou)
  const matchIds = [
    ...new Set([
      ...matches.map((m) => m.id),
      ...allProt.map((p) => p.match_id).filter(Boolean),
    ]),
  ];
  const matchMap = new Map(matches.map((m) => [m.id, m]));
  for (let i = 0; i < matchIds.length; i += 50) {
    const chunk = matchIds.slice(i, i + 50).filter((id) => !matchMap.has(id));
    if (!chunk.length) continue;
    try {
      const rows = await sb(
        `/rest/v1/matches?select=id,home_team,away_team,match_label,league_name,status,starts_at,settled_at,final_score&id=in.(${chunk.join(",")})`
      );
      for (const m of Array.isArray(rows) ? rows : []) matchMap.set(m.id, m);
    } catch {
      /* */
    }
  }

  // Agrupa por evento
  const byMatch = new Map();
  for (const p of allProt) {
    const mid = p.match_id || "_sem_match";
    if (!byMatch.has(mid)) {
      byMatch.set(mid, {
        match: matchMap.get(mid) || null,
        rows: [],
        stake: 0,
        profitPlat: 0,
        userProfit: 0,
        fees: 0,
        cut: 0,
      });
    }
    const g = byMatch.get(mid);
    g.rows.push(p);
    g.stake += stakeOf(p);
    g.profitPlat +=
      n(p.platform_profit_cents) || n(p.platform_deduction_cents) || 0;
    g.userProfit += n(p.user_profit_cents);
    g.fees += n(p.exchange_fee_cents) + n(p.exchange_profit_net_cents);
    g.cut += platformCut(p);
  }

  console.log("\n── LUCRO POR EVENTO (proteções liquidadas hoje) ────────────");
  console.log(
    `  ${pad("#", 3)} ${pad("Evento", 40)} ${padL("Prots", 5)} ${padL("Stake", 12)} ${padL("Dedução/Lucro", 14)} ${padL("Fee/Exch", 12)} ${padL("User profit", 12)}`
  );
  let totStake = 0;
  let totCut = 0;
  let totPlat = 0;
  let totFees = 0;
  let totUser = 0;
  let i = 0;
  const groups = [...byMatch.entries()].sort((a, b) => b[1].cut - a[1].cut);
  for (const [mid, g] of groups) {
    i += 1;
    totStake += g.stake;
    totCut += g.cut;
    totPlat += g.profitPlat;
    totFees += g.fees;
    totUser += g.userProfit;
    console.log(
      `  ${padL(i, 3)} ${pad(matchLabel(g.match) || mid.slice(0, 8), 40)} ${padL(g.rows.length, 5)} ${padL(money(g.stake), 12)} ${padL(money(g.cut), 14)} ${padL(money(g.fees), 12)} ${padL(money(g.userProfit), 12)}`
    );
  }
  console.log("  ─────────────────────────────────────────────────────────────");
  console.log(
    `  ${pad("TOTAL", 44)} ${padL(allProt.length, 5)} ${padL(money(totStake), 12)} ${padL(money(totCut), 14)} ${padL(money(totFees), 12)} ${padL(money(totUser), 12)}`
  );

  // Breakdown por status
  const byStatus = {};
  for (const p of allProt) {
    const st = String(p.status || p.result || "?");
    if (!byStatus[st]) byStatus[st] = { n: 0, cut: 0, stake: 0 };
    byStatus[st].n += 1;
    byStatus[st].cut += platformCut(p);
    byStatus[st].stake += stakeOf(p);
  }
  console.log("\n  Por status:");
  for (const [st, v] of Object.entries(byStatus).sort((a, b) => b[1].cut - a[1].cut)) {
    console.log(
      `    ${pad(st, 18)}  n=${padL(v.n, 4)}  stake=${padL(money(v.stake), 12)}  lucro=${money(v.cut)}`
    );
  }

  // ── Desafios / etapas liquidadas hoje ──────────────────────────────
  let steps = [];
  try {
    steps = await sbAll(
      `/rest/v1/desafio_steps?select=id,desafio_id,step_index,match_label,home_team,away_team,status,result,settled_at,used_liquidity_cents,liquidity_cents&settled_at=gte.${encodeURIComponent(fromIso)}&settled_at=lte.${encodeURIComponent(toIso)}&order=settled_at.asc`
    );
  } catch (e) {
    console.warn("desafio_steps:", e.message);
  }
  console.log("\n── DESAFIOS / ETAPAS ENCERRADAS HOJE ────────────────────────");
  console.log(`  Total etapas: ${steps.length}`);
  let desafioLiq = 0;
  for (const s of steps) {
    desafioLiq += n(s.used_liquidity_cents);
    const label =
      s.match_label ||
      [s.home_team, s.away_team].filter(Boolean).join(" x ") ||
      s.id;
    console.log(
      `  • Etapa ${s.step_index} · ${pad(label, 36)}  result=${pad(s.result || s.status, 16)}  usado=${money(s.used_liquidity_cents)}`
    );
  }
  if (steps.length) {
    console.log(`  Liquidez usada (soma): ${money(desafioLiq)}`);
  }

  // ── Caixa do dia (depósitos / saques / despesas / settlements) ─────
  async function sumTx(types) {
    const inList = types.map(encodeURIComponent).join(",");
    try {
      const rows = await sbAll(
        `/rest/v1/wallet_transactions?select=amount_cents,type&type=in.(${inList})&created_at=gte.${encodeURIComponent(fromIso)}&created_at=lte.${encodeURIComponent(toIso)}`
      );
      return rows.reduce((a, r) => a + n(r.amount_cents), 0);
    } catch {
      return 0;
    }
  }

  const dep = await sumTx(["deposit", "manual_credit", "asaas_deposit", "desafio_deposit", "provider_deposit"]);
  const settleCredit = await sumTx(["protection_settlement", "protection_unlock", "protection_release"]);
  const refunds = await sumTx(["protection_refund", "refund", "desafio_cancel_refund"]);
  const withdraws = await sumTx(["withdrawal", "withdraw", "affiliate_withdraw"]);

  let expenses = 0;
  try {
    const rows = await sb(
      `/rest/v1/admin_expenses?select=amount_cents&expense_date=eq.${day}`
    );
    expenses = (Array.isArray(rows) ? rows : []).reduce((a, r) => a + n(r.amount_cents), 0);
  } catch {
    try {
      const rows = await sbAll(
        `/rest/v1/admin_expenses?select=amount_cents&created_at=gte.${encodeURIComponent(fromIso)}&created_at=lte.${encodeURIComponent(toIso)}`
      );
      expenses = rows.reduce((a, r) => a + n(r.amount_cents), 0);
    } catch {
      /* */
    }
  }

  console.log("\n── MOVIMENTAÇÃO DE CAIXA (hoje) ─────────────────────────────");
  console.log("  Depósitos (clientes):           ", money(dep));
  console.log("  Créditos settlement/unlock:     ", money(settleCredit));
  console.log("  Estornos / refunds:             ", money(refunds));
  console.log("  Saques:                         ", money(withdraws));
  console.log("  Despesas admin:                 ", money(expenses));

  // ── Banca usuários agora ───────────────────────────────────────────
  let bancaUsers = 0;
  let bancaLocked = 0;
  let bancaDesafio = 0;
  let bancaProv = 0;
  let usersN = 0;
  try {
    const profiles = await sbAll(
      "/rest/v1/profiles?select=balance_cents,locked_balance_cents,desafio_balance_cents,investor_balance_cents,demo_balance_provider_cents"
    );
    usersN = profiles.length;
    for (const p of profiles) {
      bancaUsers += n(p.balance_cents);
      bancaLocked += n(p.locked_balance_cents);
      bancaDesafio += n(p.desafio_balance_cents);
      bancaProv += n(p.investor_balance_cents) + n(p.demo_balance_provider_cents);
    }
  } catch (e) {
    console.warn("profiles:", e.message);
  }

  console.log("\n── BANCA CLIENTES (agora) ───────────────────────────────────");
  console.log("  Usuários:", usersN);
  console.log("  Saldo real (apostador):         ", money(bancaUsers));
  console.log("  Travado em proteções:           ", money(bancaLocked));
  console.log("  Carteira Desafio:               ", money(bancaDesafio));
  console.log("  Provedor/Investor:              ", money(bancaProv));

  // ── Reconciliação saldo inicial × atual ────────────────────────────
  // Lucro plataforma do dia ≈ deduções nas proteções liquidadas.
  // Saldo inicial estimado da tesouraria = atual - (lucro líquido caixa do dia).
  // Como a tesouraria pode não espelhar 1:1 o P&L, mostramos ambos os números.
  const lucroDia = totCut;
  const saidaDia = expenses + refunds + withdraws;
  const entradaDia = dep;
  const saldoInicialEstimado = cashNow - lucroDia + saidaDia - entradaDia;

  console.log("\n── RESUMO / RECONCILIAÇÃO ───────────────────────────────────");
  console.log("  Lucro gerado hoje (dedução plataforma nas proteções):", money(lucroDia));
  console.log("    ├ platform_profit/deduction: ", money(totPlat));
  console.log("    └ exchange fee/net:          ", money(totFees));
  console.log("  Eventos liquidados:            ", matches.length || byMatch.size);
  console.log("  Proteções liquidadas:          ", allProt.length);
  console.log("  Stake total liquidado:         ", money(totStake));
  console.log("");
  console.log("  Saldo empresa ATUAL:          ", money(cashNow));
  console.log("  Saldo empresa INICIAL (est.):  ", money(saldoInicialEstimado));
  console.log("    fórmula: atual − lucro_proteções + (despesas+refunds+saques) − depósitos");
  console.log("  Variação bruta (atual−inicial):", money(cashNow - saldoInicialEstimado));
  console.log("");
  console.log("  Observação: se a tesouraria não for atualizada a cada settle,");
  console.log("  o 'saldo inicial estimado' é apenas referência analítica.");
  console.log("  O lucro operacional do dia nas proteções é o TOTAL de dedução:", money(lucroDia));

  // JSON opcional
  if (process.env.JSON_OUT) {
    const payload = {
      day,
      fromIso,
      toIso,
      treasury: { cashNow, reserve, lockedT, raw: treasury },
      matches: matches.length,
      protections: allProt.length,
      totals: {
        stake: totStake,
        platformCut: totCut,
        platformProfit: totPlat,
        fees: totFees,
        userProfit: totUser,
        deposits: dep,
        settleCredit,
        refunds,
        withdraws,
        expenses,
        cashNow,
        cashStartEstimated: saldoInicialEstimado,
      },
      byMatch: groups.map(([mid, g]) => ({
        matchId: mid,
        label: matchLabel(g.match),
        count: g.rows.length,
        stake: g.stake,
        cut: g.cut,
        fees: g.fees,
        userProfit: g.userProfit,
      })),
    };
    fs.writeFileSync(process.env.JSON_OUT, JSON.stringify(payload, null, 2));
    console.log("\nJSON →", process.env.JSON_OUT);
  }

  console.log("\nOK — auditoria concluída.\n");
}

main().catch((err) => {
  console.error("ERRO:", err.message || err);
  process.exit(1);
});
