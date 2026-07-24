#!/usr/bin/env node
/**
 * Auditoria do dia — eventos, lucro (dedução plataforma), saldo empresa.
 * Resiliente a diferenças de schema (descobre colunas com select=*).
 *
 * Na VPS:
 *   DAY=2026-07-24 node scripts/vps-auditoria-dia.mjs
 *   node scripts/vps-auditoria-dia.mjs
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
      ...(opts.headers || {}),
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
    const err = new Error(`${res.status} ${p}: ${String(text).slice(0, 320)}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

async function sbAll(basePath) {
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
    if (from > 30000) break;
  }
  return out;
}

/** Descobre colunas existentes via select=* limit 1 (ou OpenAPI). */
const schemaCache = new Map();
async function tableColumns(table) {
  if (schemaCache.has(table)) return schemaCache.get(table);
  const cols = new Set();
  try {
    const rows = await sb(`/rest/v1/${table}?select=*&limit=1`);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (row && typeof row === "object") {
      for (const k of Object.keys(row)) cols.add(k);
    }
  } catch {
    /* */
  }
  // Se tabela vazia, tenta OpenAPI
  if (!cols.size) {
    try {
      const spec = await sb(`/rest/v1/`, {
        headers: { Accept: "application/openapi+json" },
      });
      const props =
        spec?.definitions?.[table]?.properties ||
        spec?.components?.schemas?.[table]?.properties ||
        null;
      if (props) for (const k of Object.keys(props)) cols.add(k);
    } catch {
      /* */
    }
  }
  schemaCache.set(table, cols);
  return cols;
}

function pickSelect(cols, wanted) {
  const DENY = new Set([
    "match_label",
    "league_name",
    "market_id",
    "used_liquidity_cents",
  ]);
  const base = wanted.filter((c) => !DENY.has(c));
  if (!cols.size) return base;
  return base.filter((c) => cols.has(c));
}

function missingColumnFromError(err) {
  const msg = String((err && err.message) || err || "");
  let m = msg.match(/column\s+[\w.]*?([A-Za-z_]\w*)\s+does not exist/i);
  if (m) return m[1];
  try {
    const body = err && err.body;
    const j = typeof body === "string" ? JSON.parse(body) : body;
    const m2 = String((j && j.message) || "").match(
      /column\s+[\w.]*?([A-Za-z_]\w*)\s+does not exist/i
    );
    if (m2) return m2[1];
  } catch {}
  return null;
}

async function sbSelectRetry(table, colList, querySuffix) {
  let cols = [...colList];
  for (let attempt = 0; attempt < 14; attempt++) {
    const select = cols.length ? cols.join(",") : "*";
    const path = `/rest/v1/${table}?select=${select}${querySuffix || ""}`;
    try {
      return await sbAll(path);
    } catch (err) {
      const bad = missingColumnFromError(err);
      if (!bad) throw err;
      const next = cols.filter((c) => c !== bad);
      console.warn(`  schema: removendo ${table}.${bad}`);
      if (!cols.length) throw err;
      if (next.length === cols.length) {
        // coluna vinha do *; não dá para filtrar — aborta esse caminho
        throw err;
      }
      cols = next;
    }
  }
  return [];
}

function matchLabel(m) {
  if (!m) return "—";
  return (
    m.match_label ||
    [m.home_team, m.away_team].filter(Boolean).join(" x ") ||
    m.title ||
    String(m.id || "—").slice(0, 8)
  );
}

function platformCut(p) {
  // Não somar platform_profit + platform_deduction (mesmo valor no LAY).
  const plat =
    n(p.platform_profit_cents) || n(p.platform_deduction_cents) || 0;
  return plat + n(p.exchange_profit_net_cents) + n(p.exchange_fee_cents);
}

function stakeOf(p) {
  return n(p.responsibility_cents || p.amount_cents);
}

function isSettledStatus(st) {
  const s = String(st || "").toLowerCase();
  return (
    s.startsWith("won_") ||
    s.startsWith("lost_") ||
    s === "settled" ||
    s === "closed" ||
    s === "cancelled" ||
    s === "canceled"
  );
}

async function main() {
  const { day, fromIso, toIso } = dayBounds(process.env.DAY || "");
  console.log("════════════════════════════════════════════════════════════");
  console.log(` AUDITORIA DO DIA  ${day}  (America/Sao_Paulo)  v3`);
  console.log(` Janela UTC: ${fromIso} → ${toIso}`);
  console.log(` Supabase: ${SUPABASE_URL}`);
  console.log("════════════════════════════════════════════════════════════");

  const [matchCols, protCols, backCols, stepCols] = await Promise.all([
    tableColumns("matches"),
    tableColumns("protections"),
    tableColumns("back_protections"),
    tableColumns("desafio_steps"),
  ]);
  console.log("\n── SCHEMA DETECTADO ────────────────────────────────────────");
  console.log(
    "  matches:",
    matchCols.size ? [...matchCols].sort().join(", ") : "(vazio/indisponível)"
  );
  console.log(
    "  protections:",
    protCols.size
      ? [...protCols].filter((c) =>
          /profit|fee|amount|status|settled|match|side|deduct|result/i.test(c)
        ).join(", ")
      : "(vazio)"
  );
  console.log(
    "  back_protections cols:",
    backCols.size,
    "· desafio_steps cols:",
    stepCols.size
  );

  // ── Tesouraria ─────────────────────────────────────────────────────
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
    if (treasury.updated_at) {
      console.log("  Atualizado em:", treasury.updated_at);
      const ageH =
        (Date.now() - new Date(treasury.updated_at).getTime()) / 3600000;
      if (ageH > 24) {
        console.log(
          `  ⚠ Tesouraria desatualizada há ${ageH.toFixed(1)}h — P&L do dia pode não estar refletido no caixa.`
        );
      }
    }
  }

  // ── Proteções liquidadas hoje (fonte principal do lucro) ───────────
  const protWanted = [
    "id",
    "user_id",
    "match_id",
    "status",
    "result",
    "amount_cents",
    "responsibility_cents",
    "platform_profit_cents",
    "platform_deduction_cents",
    "exchange_profit_net_cents",
    "exchange_fee_cents",
    "user_profit_cents",
    "settled_at",
    "settled_outcome",
    "created_at",
    "updated_at",
    "side",
    "market_category",
    "odd",
  ];
  const protSelect = pickSelect(protCols, protWanted);
  const backSelect = pickSelect(backCols, protWanted);
  console.log("  select protections:", (protSelect.join && protSelect.join(",")) || protSelect || "*");
  console.log("  select back_protections:", (backSelect.join && backSelect.join(",")) || backSelect || "*");

  let lays = [];
  let backs = [];

  async function loadSettledProtections(table, colList) {
    const cols = table === "protections" ? protCols : backCols;
    const out = [];
    if (cols.has("settled_at") || !cols.size) {
      try {
        const rows = await sbSelectRetry(
          table,
          colList,
          `&settled_at=gte.${encodeURIComponent(fromIso)}&settled_at=lte.${encodeURIComponent(toIso)}&order=settled_at.asc`
        );
        out.push(...rows);
      } catch (e) {
        console.warn(`  ${table} settled_at:`, e.message);
      }
    }
    if (!out.length) {
      try {
        const rows = await sbSelectRetry(
          table,
          colList,
          `&updated_at=gte.${encodeURIComponent(fromIso)}&updated_at=lte.${encodeURIComponent(toIso)}&order=updated_at.asc`
        );
        const filtered = rows.filter((r) => isSettledStatus(r.status || r.result));
        out.push(...filtered);
        if (filtered.length) {
          console.log(`  ${table}: fallback updated_at → ${filtered.length}`);
        }
      } catch (e) {
        console.warn(`  ${table} updated_at:`, e.message);
      }
    }
    return out;
  }

  console.log("\n── CARREGANDO PROTEÇÕES DO DIA ─────────────────────────────");
  lays = await loadSettledProtections("protections", protSelect);
  backs = await loadSettledProtections("back_protections", backSelect);

  const allProt = [
    ...lays.map((r) => ({ ...r, _side: "LAY" })),
    ...backs.map((r) => ({ ...r, _side: "BACK" })),
  ];
  console.log(`  LAY=${lays.length}  BACK=${backs.length}  total=${allProt.length}`);

  // Fonte confiável do dia: créditos protection_settlement / unlock
  if (!allProt.length) {
    console.log("\n── FALLBACK VIA wallet_transactions (settlements do dia) ───");
    try {
      const txCols = await tableColumns("wallet_transactions");
      const txSelect = pickSelect(txCols, [
        "id",
        "user_id",
        "type",
        "amount_cents",
        "ref",
        "reference_id",
        "metadata",
        "description",
        "created_at",
      ]);
      const txRows = await sbSelectRetry(
        "wallet_transactions",
        txSelect,
        `&type=in.(protection_settlement,protection_unlock,protection_release,unlock,release)&created_at=gte.${encodeURIComponent(fromIso)}&created_at=lte.${encodeURIComponent(toIso)}&order=created_at.asc`
      );
      console.log(`  tx settlements/unlock: ${txRows.length}`);
      const ids = [];
      const txByProt = new Map();
      for (const tx of txRows) {
        let meta = tx.metadata;
        if (typeof meta === "string") {
          try {
            meta = JSON.parse(meta);
          } catch {
            meta = {};
          }
        }
        meta = meta && typeof meta === "object" ? meta : {};
        const pid =
          tx.ref ||
          tx.reference_id ||
          meta.protection_id ||
          meta.protectionId ||
          null;
        if (!pid) continue;
        ids.push(String(pid));
        if (!txByProt.has(String(pid))) txByProt.set(String(pid), []);
        txByProt.get(String(pid)).push({ ...tx, metadata: meta });
      }
      const uniq = [...new Set(ids)];
      console.log(`  protection ids nas txs: ${uniq.length}`);
      const loaded = [];
      for (let i = 0; i < uniq.length; i += 40) {
        const chunk = uniq.slice(i, i + 40);
        const inList = chunk.join(",");
        try {
          const rows = await sbSelectRetry(
            "protections",
            protSelect,
            `&id=in.(${inList})`
          );
          for (const r of rows) loaded.push({ ...r, _side: "LAY", _fromTx: true });
        } catch (e) {
          console.warn("  load protections by id:", e.message);
        }
        try {
          const rows = await sbSelectRetry(
            "back_protections",
            backSelect,
            `&id=in.(${inList})`
          );
          for (const r of rows) loaded.push({ ...r, _side: "BACK", _fromTx: true });
        } catch (e) {
          console.warn("  load back_protections by id:", e.message);
        }
      }
      if (loaded.length) {
        allProt.push(...loaded);
        console.log(`  proteções hidratadas via tx: ${loaded.length}`);
      } else if (txRows.length) {
        // Sem row de proteção — estima pelo metadata da tx
        for (const tx of txRows) {
          let meta = tx.metadata;
          if (typeof meta === "string") {
            try {
              meta = JSON.parse(meta);
            } catch {
              meta = {};
            }
          }
          meta = meta && typeof meta === "object" ? meta : {};
          allProt.push({
            id: tx.ref || tx.reference_id || tx.id,
            user_id: tx.user_id,
            match_id: meta.match_id || null,
            status: "settled_via_tx",
            amount_cents: n(meta.stake_cents) || n(tx.amount_cents),
            responsibility_cents: n(meta.stake_cents) || 0,
            platform_profit_cents:
              n(meta.platform_profit_cents) ||
              n(meta.fee_cents) ||
              n(meta.platform_deduction_cents) ||
              0,
            exchange_fee_cents: n(meta.fee_cents) || 0,
            user_profit_cents: n(meta.user_profit_cents),
            settled_at: tx.created_at,
            settled_outcome: meta.outcome || null,
            _side: "TX",
            _fromTx: true,
            _credit_cents: n(tx.amount_cents),
          });
        }
        console.log(`  usando metadata das txs: ${txRows.length}`);
      }
    } catch (e) {
      console.warn("  fallback tx:", e.message);
    }
  }


  // ── Matches do dia (settled_at / via proteções) ────────────────────
  const matchWanted = [
    "id",
    "home_team",
    "away_team",
    "league",
    "league_name",
    "match_label",
    "status",
    "starts_at",
    "settled_at",
    "final_score",
    "markets",
    "used_protection_cents",
    "updated_at",
  ];
  const matchSelectCols = pickSelect(matchCols, matchWanted);
  let matches = [];
  try {
    matches = await sbSelectRetry(
      "matches",
      matchSelectCols,
      `&settled_at=gte.${encodeURIComponent(fromIso)}&settled_at=lte.${encodeURIComponent(toIso)}&order=settled_at.asc`
    );
  } catch (e) {
    console.warn("matches settled_at:", e.message);
  }
  if (!matches.length) {
    try {
      const rows = await sbSelectRetry(
        "matches",
        matchSelectCols,
        `&updated_at=gte.${encodeURIComponent(fromIso)}&updated_at=lte.${encodeURIComponent(toIso)}&order=updated_at.asc`
      );
      matches = rows.filter((m) => {
        const st = String(m.status || "").toLowerCase();
        return st === "settled" || st === "closed" || st === "finished" || m.settled_at;
      });
    } catch (e) {
      console.warn("matches updated_at:", e.message);
    }
  }

  const matchMap = new Map(matches.map((m) => [m.id, m]));
  const missingIds = [
    ...new Set(allProt.map((p) => p.match_id).filter((id) => id && !matchMap.has(id))),
  ];
  for (let i = 0; i < missingIds.length; i += 40) {
    const chunk = missingIds.slice(i, i + 40);
    try {
      const rows = await sbSelectRetry(
        "matches",
        matchSelectCols,
        `&id=in.(${chunk.join(",")})`
      );
      for (const m of Array.isArray(rows) ? rows : []) matchMap.set(m.id, m);
    } catch (e) {
      console.warn("matches by id:", e.message);
    }
  }

  console.log("\n── EVENTOS LIQUIDADOS HOJE ─────────────────────────────────");
  const eventIds = new Set([
    ...matches.map((m) => m.id),
    ...allProt.map((p) => p.match_id).filter(Boolean),
  ]);
  console.log(`  Total eventos (matches + refs): ${eventIds.size}`);
  for (const id of eventIds) {
    const m = matchMap.get(id);
    const when = (m?.settled_at || m?.updated_at)
      ? new Date(m.settled_at || m.updated_at).toLocaleString("pt-BR", {
          timeZone: "America/Sao_Paulo",
        })
      : "—";
    console.log(
      `  • ${pad(matchLabel(m) || id.slice(0, 8), 42)}  placar=${pad(m?.final_score || "—", 7)}  ${when}`
    );
  }

  // ── Lucro por evento ───────────────────────────────────────────────
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
      `  ${padL(i, 3)} ${pad(matchLabel(g.match) || String(mid).slice(0, 8), 40)} ${padL(g.rows.length, 5)} ${padL(money(g.stake), 12)} ${padL(money(g.cut), 14)} ${padL(money(g.fees), 12)} ${padL(money(g.userProfit), 12)}`
    );
  }
  console.log("  ─────────────────────────────────────────────────────────────");
  console.log(
    `  ${pad("TOTAL", 44)} ${padL(allProt.length, 5)} ${padL(money(totStake), 12)} ${padL(money(totCut), 14)} ${padL(money(totFees), 12)} ${padL(money(totUser), 12)}`
  );

  const byStatus = {};
  for (const p of allProt) {
    const st = String(p.status || p.result || "?");
    if (!byStatus[st]) byStatus[st] = { n: 0, cut: 0, stake: 0 };
    byStatus[st].n += 1;
    byStatus[st].cut += platformCut(p);
    byStatus[st].stake += stakeOf(p);
  }
  if (Object.keys(byStatus).length) {
    console.log("\n  Por status:");
    for (const [st, v] of Object.entries(byStatus).sort(
      (a, b) => b[1].cut - a[1].cut
    )) {
      console.log(
        `    ${pad(st, 18)}  n=${padL(v.n, 4)}  stake=${padL(money(v.stake), 12)}  lucro=${money(v.cut)}`
      );
    }
  }

  // ── Desafio steps ──────────────────────────────────────────────────
  const stepWanted = [
    "id",
    "desafio_id",
    "step_index",
    "match_label",
    "home_team",
    "away_team",
    "status",
    "result",
    "settled_at",
    "liquidity_cents",
    "used_liquidity_cents",
    "updated_at",
  ];
  const stepSelectCols = pickSelect(stepCols, stepWanted);
  let steps = [];
  try {
    steps = await sbSelectRetry(
      "desafio_steps",
      stepSelectCols,
      `&settled_at=gte.${encodeURIComponent(fromIso)}&settled_at=lte.${encodeURIComponent(toIso)}&order=settled_at.asc`
    );
  } catch (e) {
    console.warn("desafio_steps:", e.message);
  }
  console.log("\n── DESAFIOS / ETAPAS ENCERRADAS HOJE ────────────────────────");
  console.log(`  Total etapas: ${steps.length}`);
  let desafioLiq = 0;
  for (const s of steps) {
    const used = n(s.used_liquidity_cents || s.liquidity_cents);
    desafioLiq += used;
    const label =
      s.match_label ||
      [s.home_team, s.away_team].filter(Boolean).join(" x ") ||
      s.id;
    console.log(
      `  • Etapa ${s.step_index} · ${pad(label, 36)}  result=${pad(s.result || s.status, 16)}  liq=${money(used)}`
    );
  }
  if (steps.length) console.log(`  Liquidez (soma): ${money(desafioLiq)}`);

  // ── Caixa do dia ───────────────────────────────────────────────────
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

  const dep = await sumTx([
    "deposit",
    "manual_credit",
    "asaas_deposit",
    "desafio_deposit",
    "provider_deposit",
  ]);
  const settleCredit = await sumTx([
    "protection_settlement",
    "protection_unlock",
    "protection_release",
  ]);
  const refunds = await sumTx([
    "protection_refund",
    "refund",
    "desafio_cancel_refund",
  ]);
  const withdraws = await sumTx([
    "withdrawal",
    "withdraw",
    "affiliate_withdraw",
  ]);

  let expenses = 0;
  try {
    const rows = await sb(
      `/rest/v1/admin_expenses?select=amount_cents&expense_date=eq.${day}`
    );
    expenses = (Array.isArray(rows) ? rows : []).reduce(
      (a, r) => a + n(r.amount_cents),
      0
    );
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

  // ── Banca clientes ─────────────────────────────────────────────────
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
      bancaProv +=
        n(p.investor_balance_cents) + n(p.demo_balance_provider_cents);
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

  const lucroDia = totCut;
  const saidaDia = expenses + refunds + withdraws;
  const entradaDia = dep;
  // Só estima inicial se houver lucro OU se a tesouraria refletir caixa;
  // quando lucro=0 e só houve depósito, a "variação" = depósitos (não é P&L).
  const saldoInicialEstimado = cashNow - lucroDia + saidaDia - entradaDia;

  console.log("\n── RESUMO / RECONCILIAÇÃO ───────────────────────────────────");
  console.log(
    "  Lucro gerado hoje (dedução plataforma nas proteções):",
    money(lucroDia)
  );
  console.log("    ├ platform_profit/deduction: ", money(totPlat));
  console.log("    └ exchange fee/net:          ", money(totFees));
  console.log("  Eventos no dia:                ", eventIds.size);
  console.log("  Proteções liquidadas:          ", allProt.length);
  console.log("  Stake total liquidado:         ", money(totStake));
  console.log("");
  console.log("  Saldo empresa ATUAL:          ", money(cashNow));
  console.log("  Saldo empresa INICIAL (est.):  ", money(saldoInicialEstimado));
  console.log(
    "    fórmula: atual − lucro_proteções + (despesas+refunds+saques) − depósitos"
  );
  console.log(
    "  Variação bruta (atual−inicial):",
    money(cashNow - saldoInicialEstimado)
  );
  if (!allProt.length) {
    console.log("");
    console.log(
      "  ⚠ Nenhuma proteção liquidada encontrada no dia — lucro R$ 0,00."
    );
    console.log(
      "    A variação acima (~depósitos) NÃO é lucro operacional."
    );
  }
  if (treasury?.updated_at) {
    const tDay = new Date(treasury.updated_at).toLocaleDateString("en-CA", {
      timeZone: "America/Sao_Paulo",
    });
    if (tDay !== day) {
      console.log("");
      console.log(
        `  ⚠ Tesouraria última update em ${tDay}, não em ${day}. Caixa pode estar defasado.`
      );
    }
  }

  const jsonOut = process.env.JSON_OUT;
  if (jsonOut) {
    const payload = {
      day,
      fromIso,
      toIso,
      schema: {
        matches: [...matchCols],
        protections: [...protCols],
        back_protections: [...backCols],
        desafio_steps: [...stepCols],
      },
      treasury: { cashNow, reserve, lockedT, raw: treasury },
      totals: {
        events: eventIds.size,
        protections: allProt.length,
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
    fs.writeFileSync(jsonOut, JSON.stringify(payload, null, 2));
    console.log("\nJSON →", jsonOut);
  }

  console.log("\nOK — auditoria v3 concluída.\n");
}

main().catch((err) => {
  console.error("ERRO:", err.message || err);
  process.exit(1);
});
