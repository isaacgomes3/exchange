#!/usr/bin/env node
/**
 * Relação de desafios cancelados com clientes ativos (reembolsados) e valores.
 *
 * Na VPS (com SERVICE_ROLE no .env):
 *   DATE=2026-07-30 node scripts/vps-relatorio-desafios-cancelados.mjs
 *   # DATE vazio = ontem (America/Sao_Paulo)
 *   DAYS=2 node scripts/vps-relatorio-desafios-cancelados.mjs
 *   JSON=1 DATE=2026-07-30 node scripts/vps-relatorio-desafios-cancelados.mjs
 */
import fs from "node:fs";
import path from "node:path";

const DATE = String(process.env.DATE || "").trim(); // YYYY-MM-DD (BRT)
const DAYS = Math.max(1, Math.min(30, Number(process.env.DAYS || 1) || 1));
const AS_JSON = process.env.JSON === "1" || process.env.JSON === "true";
const ONLY_WITH_CLIENTS =
  process.env.ONLY_WITH_CLIENTS !== "0" &&
  process.env.ONLY_WITH_CLIENTS !== "false";

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

/** Início/fim do dia civil em America/Sao_Paulo → ISO UTC */
function brDayBounds(ymd) {
  // BRT/BRST ≈ UTC-3 na maior parte do ano; usamos offset fixo -03:00
  // (consistente com demais scripts do repo).
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
  const today = fmt.format(new Date()); // YYYY-MM-DD
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
      `${pathBase}${sep}limit=${pageSize}&offset=${page * pageSize}`
    );
    const list = Array.isArray(rows) ? rows : [];
    out.push(...list);
    if (list.length < pageSize) break;
  }
  return out;
}

async function buildReport({ fromIso, toIso, label }) {
  // 1) Reembolsos do cancelamento no período (fonte da verdade do "cliente ativo")
  const refunds = await fetchAll(
    `/rest/v1/wallet_transactions?type=eq.desafio_cancel_refund&created_at=gte.${encodeURIComponent(fromIso)}&created_at=lt.${encodeURIComponent(toIso)}&select=id,user_id,amount_cents,metadata,created_at&order=created_at.asc`
  );

  // 2) Desafios marcados cancelled no período (mesmo sem reembolso)
  const cancelledDesafios = await fetchAll(
    `/rest/v1/desafios?status=eq.cancelled&updated_at=gte.${encodeURIComponent(fromIso)}&updated_at=lt.${encodeURIComponent(toIso)}&select=id,number,title,subtitle,status,is_active,initial_balance_cents,updated_at,created_at,published_at&order=updated_at.desc`
  );

  const desafioIds = new Set(cancelledDesafios.map((d) => d.id).filter(Boolean));
  for (const tx of refunds) {
    const mid = tx?.metadata?.desafio_id;
    if (mid) desafioIds.add(String(mid));
  }

  const idList = [...desafioIds];
  let desafiosById = new Map(cancelledDesafios.map((d) => [d.id, d]));
  if (idList.length) {
    for (let i = 0; i < idList.length; i += 80) {
      const chunk = idList.slice(i, i + 80);
      const rows = await sb(
        `/rest/v1/desafios?id=in.(${chunk.join(",")})&select=id,number,title,subtitle,status,is_active,initial_balance_cents,updated_at,created_at,published_at`
      ).catch(() => []);
      for (const d of Array.isArray(rows) ? rows : []) {
        desafiosById.set(d.id, d);
      }
    }
  }

  // Participações canceladas ligadas a esses desafios (fallback se não houver tx)
  const partsByDesafio = new Map();
  if (idList.length) {
    for (let i = 0; i < idList.length; i += 40) {
      const chunk = idList.slice(i, i + 40);
      const rows = await fetchAll(
        `/rest/v1/desafio_participations?desafio_id=in.(${chunk.join(",")})&result=eq.cancelled&select=id,user_id,desafio_id,step_id,amount_cents,result,side,updated_at,created_at,profiles(full_name,email)`
      );
      for (const p of rows) {
        const did = String(p.desafio_id || "");
        if (!partsByDesafio.has(did)) partsByDesafio.set(did, []);
        partsByDesafio.get(did).push(p);
      }
    }
  }

  const userIds = new Set();
  for (const tx of refunds) if (tx.user_id) userIds.add(tx.user_id);
  for (const list of partsByDesafio.values()) {
    for (const p of list) if (p.user_id) userIds.add(p.user_id);
  }
  const profilesById = new Map();
  const uids = [...userIds];
  for (let i = 0; i < uids.length; i += 80) {
    const chunk = uids.slice(i, i + 80);
    const rows = await sb(
      `/rest/v1/profiles?id=in.(${chunk.join(",")})&select=id,full_name,email,desafio_balance_cents,account_status`
    ).catch(() => []);
    for (const p of Array.isArray(rows) ? rows : []) {
      profilesById.set(p.id, p);
    }
  }

  // Agrupa reembolsos por desafio
  const refundsByDesafio = new Map();
  for (const tx of refunds) {
    const did = String(tx?.metadata?.desafio_id || "").trim();
    if (!did) continue;
    if (!refundsByDesafio.has(did)) refundsByDesafio.set(did, []);
    refundsByDesafio.get(did).push(tx);
  }

  const desafios = [];
  for (const did of idList) {
    const d = desafiosById.get(did) || { id: did, title: "(desafio)", number: null };
    const txs = refundsByDesafio.get(did) || [];
    const parts = partsByDesafio.get(did) || [];

    /** @type {Map<string, any>} */
    const clients = new Map();

    for (const tx of txs) {
      const uid = String(tx.user_id || "");
      if (!uid) continue;
      const prof = profilesById.get(uid) || {};
      const cur = clients.get(uid) || {
        user_id: uid,
        full_name: prof.full_name || null,
        email: prof.email || null,
        account_status: prof.account_status || null,
        amount_cents: 0,
        refund_cents: 0,
        participations: 0,
        refund_txs: 0,
        sources: new Set(),
      };
      cur.refund_cents += n(tx.amount_cents);
      cur.amount_cents += n(tx.amount_cents);
      cur.refund_txs += 1;
      cur.sources.add("refund");
      if (!cur.full_name && prof.full_name) cur.full_name = prof.full_name;
      clients.set(uid, cur);
    }

    // Se não houver wallet_transactions, usa participações cancelled
    if (!txs.length) {
      for (const p of parts) {
        const uid = String(p.user_id || "");
        if (!uid) continue;
        const prof = profilesById.get(uid) || p.profiles || {};
        const cur = clients.get(uid) || {
          user_id: uid,
          full_name: prof.full_name || null,
          email: prof.email || null,
          account_status: prof.account_status || null,
          amount_cents: 0,
          refund_cents: 0,
          participations: 0,
          refund_txs: 0,
          sources: new Set(),
        };
        cur.amount_cents += n(p.amount_cents);
        cur.participations += 1;
        cur.sources.add("participation");
        if (!cur.full_name) {
          cur.full_name = prof.full_name || p.profiles?.full_name || null;
        }
        clients.set(uid, cur);
      }
    } else {
      // Conta participações por usuário mesmo com refunds
      for (const p of parts) {
        const uid = String(p.user_id || "");
        if (!uid || !clients.has(uid)) continue;
        const cur = clients.get(uid);
        cur.participations += 1;
        cur.sources.add("participation");
      }
    }

    const clientList = [...clients.values()]
      .map((c) => ({
        user_id: c.user_id,
        full_name: c.full_name || "(sem nome)",
        email: c.email || null,
        account_status: c.account_status || null,
        amount_cents: c.amount_cents,
        refund_cents: c.refund_cents,
        participations: c.participations,
        refund_txs: c.refund_txs,
        sources: [...c.sources],
      }))
      .sort((a, b) => b.amount_cents - a.amount_cents || String(a.full_name).localeCompare(String(b.full_name)));

    if (ONLY_WITH_CLIENTS && !clientList.length) continue;

    const totalCents = clientList.reduce((a, c) => a + c.amount_cents, 0);
    desafios.push({
      id: d.id,
      number: d.number,
      title: d.title || "(sem título)",
      subtitle: d.subtitle || null,
      status: d.status || "cancelled",
      initial_balance_cents: n(d.initial_balance_cents),
      cancelled_at: d.updated_at || null,
      clients: clientList,
      clients_count: clientList.length,
      total_cents: totalCents,
    });
  }

  desafios.sort((a, b) => {
    const ta = a.cancelled_at ? Date.parse(a.cancelled_at) : 0;
    const tb = b.cancelled_at ? Date.parse(b.cancelled_at) : 0;
    return tb - ta;
  });

  const orphanRefunds = refunds.filter((tx) => !tx?.metadata?.desafio_id);

  return {
    period: { label, from: fromIso, to: toIso },
    summary: {
      desafios: desafios.length,
      clients: desafios.reduce((a, d) => a + d.clients_count, 0),
      total_cents: desafios.reduce((a, d) => a + d.total_cents, 0),
      refund_txs: refunds.length,
      orphan_refund_txs: orphanRefunds.length,
    },
    desafios,
    orphan_refunds: orphanRefunds.map((tx) => ({
      id: tx.id,
      user_id: tx.user_id,
      full_name: profilesById.get(tx.user_id)?.full_name || null,
      amount_cents: n(tx.amount_cents),
      created_at: tx.created_at,
      metadata: tx.metadata || null,
    })),
  };
}

function printReport(report) {
  const { period, summary, desafios, orphan_refunds } = report;
  console.log("═".repeat(72));
  console.log("RELATÓRIO · Desafios cancelados com cliente ativo");
  console.log(`Período (BRT): ${period.label}`);
  console.log(`UTC: ${period.from} → ${period.to}`);
  console.log("─".repeat(72));
  console.log(
    `Desafios: ${summary.desafios} · Clientes: ${summary.clients} · Total: ${money(summary.total_cents)} · Txs reembolso: ${summary.refund_txs}`
  );
  console.log("═".repeat(72));

  if (!desafios.length) {
    console.log("\nNenhum desafio cancelado com cliente ativo neste período.\n");
    return;
  }

  for (const d of desafios) {
    const num = d.number != null ? `#${d.number}` : "#?";
    console.log("");
    console.log(
      `▶ ${num} ${d.title}  ·  ${d.clients_count} cliente(s)  ·  ${money(d.total_cents)}`
    );
    if (d.cancelled_at) {
      console.log(
        `  Cancelado em: ${new Date(d.cancelled_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
      );
    }
    console.log(`  id: ${d.id}`);
    console.log("  ┌─────────────────────────────────────────────────────────────");
    for (const c of d.clients) {
      const val = money(c.amount_cents);
      console.log(
        `  │ ${c.full_name.padEnd(32).slice(0, 32)}  ${val.padStart(14)}  ${c.user_id.slice(0, 8)}…`
      );
      if (c.email) console.log(`  │   e-mail: ${c.email}`);
    }
    console.log("  └─────────────────────────────────────────────────────────────");
  }

  if (orphan_refunds?.length) {
    console.log("\n⚠ Reembolsos sem desafio_id no metadata:");
    for (const o of orphan_refunds) {
      console.log(
        `  · ${o.full_name || o.user_id}  ${money(o.amount_cents)}  ${o.created_at}`
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
  const label =
    startYmd === endYmd ? startYmd : `${startYmd} → ${endYmd}`;

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
