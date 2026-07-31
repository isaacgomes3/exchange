#!/usr/bin/env node
/**
 * Relatório: jogos/proteções canceladas (LAY + BACK) + estornos.
 *
 * Na VPS (SERVICE_ROLE no .env):
 *   DATE=2026-07-30 DAYS=2 node scripts/vps-relatorio-protecoes-canceladas.mjs
 *   # DATE vazio = ontem (America/Sao_Paulo)
 *   DAYS=2 → inclui DATE e o dia anterior a ele até DATE (N dias)
 *   JSON=1 DATE=2026-07-31 node scripts/vps-relatorio-protecoes-canceladas.mjs
 *
 * Fontes:
 *  1) wallet_transactions type=protection_refund
 *  2) protections / back_protections status=cancelled (settled_at no período)
 *  3) matches status=cancelled OU deleted_at no período
 *  4) admin_audit_logs protection_cancel_refund / protection_close_no_refund
 */
import fs from "node:fs";
import path from "node:path";

const DATE = String(process.env.DATE || "").trim(); // YYYY-MM-DD (BRT)
const DAYS = Math.max(1, Math.min(30, Number(process.env.DAYS || 1) || 1));
const AS_JSON = process.env.JSON === "1" || process.env.JSON === "true";

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
  "/opt/arbishield/scripts/.env",
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
function fmtBr(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
    });
  } catch {
    return String(iso);
  }
}

function brDayBounds(ymd) {
  const from = `${ymd}T00:00:00-03:00`;
  const [y, m, d] = ymd.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const ny = next.getUTCFullYear();
  const nm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const nd = String(next.getUTCDate()).padStart(2, "0");
  const to = `${ny}-${nm}-${nd}T00:00:00-03:00`;
  return {
    fromIso: new Date(from).toISOString(),
    toIso: new Date(to).toISOString(),
    ymd,
  };
}

function yesterdayBrYmd() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = fmt.format(new Date());
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function addDaysYmd(ymd, delta) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

async function sb(p, { okNull = false } = {}) {
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
  if (!res.ok) {
    if (okNull) return null;
    const msg =
      (data && data.message) ||
      (data && data.error) ||
      text ||
      `HTTP ${res.status}`;
    throw new Error(`${p} → ${msg}`);
  }
  return data;
}

async function fetchAll(pathBase, { pageSize = 1000, maxPages = 50 } = {}) {
  const out = [];
  for (let page = 0; page < maxPages; page++) {
    const sep = pathBase.includes("?") ? "&" : "?";
    const rows = await sb(
      `${pathBase}${sep}limit=${pageSize}&offset=${page * pageSize}`,
      { okNull: true }
    );
    if (rows == null) break;
    const list = Array.isArray(rows) ? rows : [];
    out.push(...list);
    if (list.length < pageSize) break;
  }
  return out;
}

function matchLabel(m) {
  if (!m) return null;
  const teams = [m.home_team, m.away_team].filter(Boolean).join(" x ");
  return teams || null;
}

function cancelSource(row, auditByProt) {
  const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const ac = meta.auto_cancel || {};
  const audit = auditByProt.get(String(row.id)) || null;
  if (audit) {
    return {
      kind: "admin",
      by: audit.admin_id || null,
      at: audit.created_at || null,
      action: audit.action || null,
      auto: false,
      reason: audit.details?.reason || ac.reason || null,
    };
  }
  if (ac && (ac.auto || ac.cancelled_at || ac.cancelled_by)) {
    return {
      kind: "client_auto",
      by: ac.cancelled_by || null,
      at: ac.cancelled_at || row.settled_at || null,
      action: "auto_cancel",
      auto: true,
      reason: ac.reason || null,
    };
  }
  if (meta.closed_by) {
    return {
      kind: "admin_close",
      by: meta.closed_by,
      at: meta.closed_at || row.settled_at || null,
      action: "close_no_refund",
      auto: false,
      reason: meta.close_reason || null,
    };
  }
  return {
    kind: "unknown",
    by: null,
    at: row.settled_at || null,
    action: row.result || null,
    auto: false,
    reason: null,
  };
}

async function buildReport({ fromIso, toIso, label }) {
  // 1) Estornos protection_refund no período
  const refunds = await fetchAll(
    `/rest/v1/wallet_transactions?type=eq.protection_refund&created_at=gte.${encodeURIComponent(fromIso)}&created_at=lt.${encodeURIComponent(toIso)}&select=id,user_id,amount_cents,ref,metadata,created_at&order=created_at.asc`
  );

  // 2) Proteções canceladas — select=* (schema VPS varia; colunas extras quebram o GET)
  async function loadCancelled(table) {
    // preferir settled_at; se coluna não existir, PostgREST falha → fallback created_at
    let rows = await fetchAll(
      `/rest/v1/${table}?status=eq.cancelled&settled_at=gte.${encodeURIComponent(fromIso)}&settled_at=lt.${encodeURIComponent(toIso)}&select=*&order=settled_at.desc`
    );
    if (!rows.length) {
      const recent = await fetchAll(
        `/rest/v1/${table}?status=eq.cancelled&created_at=gte.${encodeURIComponent(fromIso)}&select=*&order=created_at.desc`
      );
      rows = recent.filter((r) => {
        const t = r.settled_at || r.created_at;
        if (!t) return true; // sem timestamp → inclui p/ não perder
        const ms = Date.parse(t);
        return ms >= Date.parse(fromIso) && ms < Date.parse(toIso);
      });
    }
    // também result=cancelled_refund (status às vezes diverge)
    const byResult = await fetchAll(
      `/rest/v1/${table}?result=eq.cancelled_refund&settled_at=gte.${encodeURIComponent(fromIso)}&settled_at=lt.${encodeURIComponent(toIso)}&select=*`
    ).catch(() => []);
    const map = new Map(rows.map((r) => [String(r.id), r]));
    for (const r of byResult) map.set(String(r.id), r);
    return [...map.values()];
  }

  const cancelledLay = await loadCancelled("protections");
  const cancelledBack = await loadCancelled("back_protections");

  const cancelled = [
    ...cancelledLay.map((r) => ({ ...r, _table: "protections", market: "LAY" })),
    ...cancelledBack.map((r) => ({
      ...r,
      _table: "back_protections",
      market: "BACK",
    })),
  ];

  // Inclui proteções referenciadas só por refund (caso status divergente)
  const protIds = new Set(cancelled.map((r) => String(r.id)));
  for (const tx of refunds) {
    const pid = String(tx.ref || tx?.metadata?.protection_id || "").trim();
    if (pid) protIds.add(pid);
  }

  const missingIds = [...protIds].filter(
    (id) => !cancelled.some((r) => String(r.id) === id)
  );
  for (let i = 0; i < missingIds.length; i += 40) {
    const chunk = missingIds.slice(i, i + 40);
    const lays = await sb(
      `/rest/v1/protections?id=in.(${chunk.join(",")})&select=*`,
      { okNull: true }
    ).catch(() => []);
    for (const r of Array.isArray(lays) ? lays : []) {
      cancelled.push({ ...r, _table: "protections", market: "LAY" });
    }
    const backs = await sb(
      `/rest/v1/back_protections?id=in.(${chunk.join(",")})&select=*`,
      { okNull: true }
    ).catch(() => []);
    for (const r of Array.isArray(backs) ? backs : []) {
      cancelled.push({ ...r, _table: "back_protections", market: "BACK" });
    }
  }

  // Dedup por id
  const byId = new Map();
  for (const r of cancelled) byId.set(String(r.id), r);
  const protections = [...byId.values()];

  // 3) Jogos cancelados / excluídos no período
  const matchesCancelled = await fetchAll(
    `/rest/v1/matches?status=eq.cancelled&or=(updated_at.gte.${encodeURIComponent(fromIso)},created_at.gte.${encodeURIComponent(fromIso)})&select=*&order=created_at.desc`
  ).catch(() => []);
  const matchesDeleted = await fetchAll(
    `/rest/v1/matches?deleted_at=gte.${encodeURIComponent(fromIso)}&deleted_at=lt.${encodeURIComponent(toIso)}&select=*&order=deleted_at.desc`
  ).catch(() => []);

  const matchIds = new Set();
  for (const m of matchesCancelled) {
    const t = m.updated_at || m.deleted_at || m.created_at;
    if (t) {
      const ms = Date.parse(t);
      if (ms < Date.parse(fromIso) || ms >= Date.parse(toIso)) continue;
    }
    matchIds.add(String(m.id));
  }
  for (const m of matchesDeleted) matchIds.add(String(m.id));
  for (const p of protections) if (p.match_id) matchIds.add(String(p.match_id));

  const matchesById = new Map();
  for (const m of [...matchesCancelled, ...matchesDeleted]) {
    matchesById.set(String(m.id), m);
  }
  const needMatch = [...matchIds].filter((id) => !matchesById.has(id));
  for (let i = 0; i < needMatch.length; i += 40) {
    const chunk = needMatch.slice(i, i + 40);
    const rows = await sb(
      `/rest/v1/matches?id=in.(${chunk.join(",")})&select=*`,
      { okNull: true }
    ).catch(() => []);
    for (const m of Array.isArray(rows) ? rows : []) {
      matchesById.set(String(m.id), m);
    }
  }

  // 4) Audit admin
  const audits = await fetchAll(
    `/rest/v1/admin_audit_logs?action=in.(protection_cancel_refund,protection_close_no_refund)&created_at=gte.${encodeURIComponent(fromIso)}&created_at=lt.${encodeURIComponent(toIso)}&select=id,admin_id,action,entity_type,entity_id,details,created_at&order=created_at.desc`
  ).catch(() => []);
  const auditByProt = new Map();
  for (const a of audits) {
    if (a.entity_id) auditByProt.set(String(a.entity_id), a);
  }

  // Profiles + e-mails
  const userIds = new Set();
  for (const p of protections) if (p.user_id) userIds.add(String(p.user_id));
  for (const tx of refunds) if (tx.user_id) userIds.add(String(tx.user_id));
  for (const a of audits) if (a.admin_id) userIds.add(String(a.admin_id));
  for (const p of protections) {
    const src = cancelSource(p, auditByProt);
    if (src.by) userIds.add(String(src.by));
  }

  const profilesById = new Map();
  const uids = [...userIds];
  for (let i = 0; i < uids.length; i += 80) {
    const chunk = uids.slice(i, i + 80);
    const rows = await sb(
      `/rest/v1/profiles?id=in.(${chunk.join(",")})&select=id,full_name,account_status,balance_cents`,
      { okNull: true }
    ).catch(() => []);
    for (const p of Array.isArray(rows) ? rows : []) {
      profilesById.set(String(p.id), p);
    }
  }

  const emailById = new Map();
  for (const uid of uids) {
    try {
      const u = await sb(`/auth/v1/admin/users/${encodeURIComponent(uid)}`, {
        okNull: true,
      });
      const email = u?.email || u?.user?.email || null;
      if (email) emailById.set(uid, email);
    } catch {
      /* opcional */
    }
  }

  const refundByProt = new Map();
  for (const tx of refunds) {
    const pid = String(tx.ref || tx?.metadata?.protection_id || "").trim();
    if (!pid) continue;
    if (!refundByProt.has(pid)) refundByProt.set(pid, []);
    refundByProt.get(pid).push(tx);
  }

  // Agrupa por jogo
  /** @type {Map<string, any>} */
  const games = new Map();
  function ensureGame(matchId) {
    const key = matchId ? String(matchId) : "__sem_jogo__";
    if (!games.has(key)) {
      const m = matchId ? matchesById.get(String(matchId)) : null;
      games.set(key, {
        match_id: matchId || null,
        label: matchLabel(m) || (matchId ? `(match ${String(matchId).slice(0, 8)}…)` : "(sem jogo)"),
        league: m?.league || null,
        starts_at: m?.starts_at || null,
        match_status: m?.status || null,
        match_deleted_at: m?.deleted_at || null,
        match_cancelled:
          String(m?.status || "").toLowerCase() === "cancelled" ||
          !!m?.deleted_at,
        protections: [],
        refund_cents: 0,
        clients: new Set(),
      });
    }
    return games.get(key);
  }

  for (const row of protections) {
    const g = ensureGame(row.match_id);
    const amt = n(row.responsibility_cents || row.amount_cents);
    const txs = refundByProt.get(String(row.id)) || [];
    const refundCents = txs.reduce((a, t) => a + n(t.amount_cents), 0);
    const src = cancelSource(row, auditByProt);
    const prof = profilesById.get(String(row.user_id)) || {};
    const entry = {
      id: row.id,
      table: row._table,
      market: row.market || (row._table === "back_protections" ? "BACK" : "LAY"),
      status: row.status,
      result: row.result || null,
      amount_cents: amt,
      refund_cents: refundCents || (String(row.result || "").includes("refund") ? amt : 0),
      odd: row.odd != null ? Number(row.odd) : null,
      user_id: row.user_id,
      full_name: prof.full_name || null,
      email: emailById.get(String(row.user_id)) || null,
      account_status: prof.account_status || null,
      settled_at: row.settled_at || null,
      created_at: row.created_at || null,
      cancel: {
        ...src,
        by_name: src.by
          ? profilesById.get(String(src.by))?.full_name || null
          : null,
        by_email: src.by ? emailById.get(String(src.by)) || null : null,
      },
      refund_txs: txs.length,
    };
    g.protections.push(entry);
    g.refund_cents += entry.refund_cents;
    if (row.user_id) g.clients.add(String(row.user_id));
  }

  // Jogos cancelados/excluídos sem proteção no período ainda entram na lista
  for (const m of [...matchesCancelled, ...matchesDeleted]) {
    ensureGame(m.id);
  }

  const gameList = [...games.values()]
    .map((g) => ({
      match_id: g.match_id,
      label: g.label,
      league: g.league,
      starts_at: g.starts_at,
      match_status: g.match_status,
      match_deleted_at: g.match_deleted_at,
      match_cancelled: g.match_cancelled,
      protections_count: g.protections.length,
      clients_count: g.clients.size,
      refund_cents: g.refund_cents,
      protections: g.protections.sort((a, b) => {
        const ta = a.settled_at ? Date.parse(a.settled_at) : 0;
        const tb = b.settled_at ? Date.parse(b.settled_at) : 0;
        return tb - ta;
      }),
    }))
    .sort((a, b) => {
      if (b.protections_count !== a.protections_count) {
        return b.protections_count - a.protections_count;
      }
      const ta = a.starts_at ? Date.parse(a.starts_at) : 0;
      const tb = b.starts_at ? Date.parse(b.starts_at) : 0;
      return tb - ta;
    });

  const orphanRefunds = refunds.filter((tx) => {
    const pid = String(tx.ref || tx?.metadata?.protection_id || "").trim();
    return !pid || !byId.has(pid);
  });

  const refundsDetail = refunds.map((tx) => {
    const pid = String(tx.ref || tx?.metadata?.protection_id || "").trim();
    const prot = pid ? byId.get(pid) : null;
    const match = prot?.match_id
      ? matchesById.get(String(prot.match_id))
      : null;
    const prof = profilesById.get(String(tx.user_id)) || {};
    const meta =
      tx.metadata && typeof tx.metadata === "object" ? tx.metadata : {};
    return {
      id: tx.id,
      user_id: tx.user_id,
      full_name: prof.full_name || null,
      email: emailById.get(String(tx.user_id)) || null,
      amount_cents: n(tx.amount_cents),
      created_at: tx.created_at,
      ref: tx.ref || null,
      protection_id: pid || null,
      protection_status: prot?.status || null,
      protection_result: prot?.result || null,
      match_id: prot?.match_id || null,
      match_label: matchLabel(match),
      auto_cancel: !!(meta.auto_cancel || prot?.metadata?.auto_cancel),
      metadata: meta,
    };
  });

  const totalRefund = refunds.reduce((a, t) => a + n(t.amount_cents), 0);
  const bySource = { admin: 0, client_auto: 0, admin_close: 0, unknown: 0 };
  for (const g of gameList) {
    for (const p of g.protections) {
      const k = p.cancel?.kind || "unknown";
      bySource[k] = (bySource[k] || 0) + 1;
    }
  }

  return {
    period: { label, from: fromIso, to: toIso },
    summary: {
      games: gameList.length,
      games_with_protections: gameList.filter((g) => g.protections_count > 0)
        .length,
      games_match_cancelled: gameList.filter((g) => g.match_cancelled).length,
      protections: protections.length,
      refund_txs: refunds.length,
      refund_cents: totalRefund,
      by_source: bySource,
      admin_audits: audits.length,
      orphan_refund_txs: orphanRefunds.length,
    },
    games: gameList,
    refunds_detail: refundsDetail,
    admin_audits: audits.map((a) => ({
      id: a.id,
      action: a.action,
      entity_id: a.entity_id,
      admin_id: a.admin_id,
      admin_name: profilesById.get(String(a.admin_id))?.full_name || null,
      admin_email: emailById.get(String(a.admin_id)) || null,
      amount_cents: n(a.details?.amount_cents),
      created_at: a.created_at,
      details: a.details || null,
    })),
    orphan_refunds: orphanRefunds.map((tx) => ({
      id: tx.id,
      user_id: tx.user_id,
      full_name: profilesById.get(String(tx.user_id))?.full_name || null,
      email: emailById.get(String(tx.user_id)) || null,
      amount_cents: n(tx.amount_cents),
      created_at: tx.created_at,
      ref: tx.ref || null,
      metadata: tx.metadata || null,
    })),
  };
}

function printReport(report) {
  const { period, summary, games, admin_audits, orphan_refunds, refunds_detail } =
    report;
  console.log("═".repeat(72));
  console.log("RELATÓRIO · Jogos / proteções canceladas");
  console.log(`Período (BRT): ${period.label}`);
  console.log(`UTC: ${period.from} → ${period.to}`);
  console.log("─".repeat(72));
  console.log(
    `Jogos: ${summary.games} (${summary.games_with_protections} com proteção · ${summary.games_match_cancelled} cancelados/excluídos)`
  );
  console.log(
    `Proteções canceladas: ${summary.protections} · Estornos: ${summary.refund_txs} · Total: ${money(summary.refund_cents)} · Órfãos: ${summary.orphan_refund_txs}`
  );
  console.log(
    `Origem cancel: admin=${summary.by_source.admin || 0} · cliente(auto)=${summary.by_source.client_auto || 0} · close_sem_estorno=${summary.by_source.admin_close || 0} · ?=${summary.by_source.unknown || 0}`
  );
  console.log(`Audit admin (cancel/close): ${summary.admin_audits}`);
  console.log("═".repeat(72));

  // Sempre listar estornos do período (mesmo sem proteção resolvida)
  if (refunds_detail?.length) {
    console.log("\n── Estornos protection_refund (período) ──");
    for (const t of refunds_detail) {
      console.log(
        `  · ${fmtBr(t.created_at)}  ${money(t.amount_cents)}  ${t.full_name || "(sem nome)"}  ${t.email || t.user_id?.slice(0, 8) || "—"}`
      );
      console.log(
        `    ref=${t.ref || "—"}  prot_status=${t.protection_status || "não achou"}  jogo=${t.match_label || "—"}  auto=${t.auto_cancel ? "sim" : "não"}`
      );
      if (t.metadata && Object.keys(t.metadata).length) {
        console.log(`    meta=${JSON.stringify(t.metadata).slice(0, 180)}`);
      }
    }
  }

  if (!games.length) {
    console.log(
      "\nNenhuma proteção cancelada nem jogo cancelado/excluído ligado neste período."
    );
    if (orphan_refunds?.length) {
      console.log(
        `\n⚠ ${orphan_refunds.length} estorno(s) sem proteção resolvida (detalhe acima).`
      );
    }
    console.log("");
    return;
  }

  for (const g of games) {
    console.log("");
    const flags = [];
    if (g.match_cancelled) flags.push("JOGO CANCELADO/EXCLUÍDO");
    if (g.protections_count) flags.push(`${g.protections_count} proteção(ões)`);
    console.log(
      `▶ ${g.label}${flags.length ? "  ·  " + flags.join(" · ") : ""}`
    );
    if (g.league) console.log(`  Liga: ${g.league}`);
    if (g.starts_at) console.log(`  Kickoff: ${fmtBr(g.starts_at)}`);
    console.log(
      `  Match status: ${g.match_status || "—"} · deleted_at: ${fmtBr(g.match_deleted_at)}`
    );
    if (g.match_id) console.log(`  match_id: ${g.match_id}`);
    console.log(
      `  Clientes: ${g.clients_count} · Estorno no jogo: ${money(g.refund_cents)}`
    );

    if (!g.protections.length) {
      console.log("  (sem proteção cancelada ligada neste período)");
      continue;
    }

    console.log("  ┌─────────────────────────────────────────────────────────────");
    for (const p of g.protections) {
      const name = (p.full_name || "(sem nome)").padEnd(28).slice(0, 28);
      console.log(
        `  │ ${name}  ${p.market.padEnd(4)}  ${money(p.amount_cents).padStart(12)}  estorno ${money(p.refund_cents)}`
      );
      console.log(
        `  │   ${p.id.slice(0, 8)}…  settled=${fmtBr(p.settled_at)}  result=${p.result || "—"}`
      );
      const c = p.cancel || {};
      const who =
        c.by_email ||
        c.by_name ||
        (c.by ? String(c.by).slice(0, 8) + "…" : "—");
      console.log(
        `  │   origem=${c.kind || "?"}  por=${who}  em=${fmtBr(c.at)}${c.reason ? "  motivo=" + String(c.reason).slice(0, 60) : ""}`
      );
      if (p.email) console.log(`  │   cliente: ${p.email}`);
    }
    console.log("  └─────────────────────────────────────────────────────────────");
  }

  if (admin_audits?.length) {
    console.log("\n── Audit admin (protection_cancel / close) ──");
    for (const a of admin_audits) {
      console.log(
        `  · ${fmtBr(a.created_at)}  ${a.action}  ${a.admin_email || a.admin_name || a.admin_id || "—"}  prot=${String(a.entity_id || "").slice(0, 8)}…  ${money(a.amount_cents)}`
      );
    }
  }

  if (orphan_refunds?.length) {
    console.log("\n⚠ Estornos protection_refund sem proteção resolvida:");
    for (const o of orphan_refunds) {
      console.log(
        `  · ${o.full_name || o.user_id}  ${money(o.amount_cents)}  ${fmtBr(o.created_at)}  ref=${o.ref || "—"}`
      );
    }
  }
  console.log("");
}

async function main() {
  const endYmd = DATE || yesterdayBrYmd();
  const startYmd = DAYS > 1 ? addDaysYmd(endYmd, -(DAYS - 1)) : endYmd;
  const from = brDayBounds(startYmd).fromIso;
  const to = brDayBounds(endYmd).toIso;
  const label = startYmd === endYmd ? startYmd : `${startYmd} → ${endYmd}`;

  const report = await buildReport({
    fromIso: from,
    toIso: to,
    label,
  });

  if (AS_JSON) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }
}

main().catch((err) => {
  console.error("ERRO:", err instanceof Error ? err.message : err);
  process.exit(1);
});
