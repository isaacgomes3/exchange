#!/usr/bin/env node
/**
 * Lista jogos (matches) do dia civil BRT.
 *
 *   DATE=2026-07-31 node scripts/vps-listar-jogos-dia.mjs
 *   # DATE vazio = hoje (America/Sao_Paulo)
 *   ONLY_PUBLISHED=1 DATE=2026-07-31 node scripts/vps-listar-jogos-dia.mjs
 *   JSON=1 node scripts/vps-listar-jogos-dia.mjs
 */
import fs from "node:fs";
import path from "node:path";

const DATE = String(process.env.DATE || "").trim();
const ONLY_PUBLISHED =
  process.env.ONLY_PUBLISHED === "1" || process.env.ONLY_PUBLISHED === "true";
const INCLUDE_DELETED =
  process.env.INCLUDE_DELETED === "1" || process.env.INCLUDE_DELETED === "true";
const AS_JSON = process.env.JSON === "1" || process.env.JSON === "true";

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

function todayBrYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function brDayBounds(ymd) {
  const fromIso = new Date(`${ymd}T00:00:00-03:00`).toISOString();
  const [y, m, d] = ymd.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const toYmd = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  const toIso = new Date(`${toYmd}T00:00:00-03:00`).toISOString();
  return { fromIso, toIso, ymd };
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

function fmtTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(iso);
  }
}

async function sb(p) {
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
    const msg =
      (data && data.message) ||
      (data && data.error) ||
      text ||
      `HTTP ${res.status}`;
    throw new Error(`${p} → ${msg}`);
  }
  return data;
}

async function fetchAll(pathBase, { pageSize = 500, maxPages = 20 } = {}) {
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

async function countOpenProtections(matchIds) {
  /** @type {Map<string, {lay: number, back: number, cents: number}>} */
  const map = new Map();
  for (const id of matchIds) {
    map.set(String(id), { lay: 0, back: 0, cents: 0 });
  }
  if (!matchIds.length) return map;

  for (let i = 0; i < matchIds.length; i += 40) {
    const chunk = matchIds.slice(i, i + 40);
    const inList = chunk.join(",");
    try {
      const lays = await fetchAll(
        `/rest/v1/protections?match_id=in.(${inList})&status=in.(active,pending,review_odd)&select=match_id,amount_cents,responsibility_cents`
      );
      for (const r of lays) {
        const cur = map.get(String(r.match_id));
        if (!cur) continue;
        cur.lay += 1;
        cur.cents += n(r.responsibility_cents || r.amount_cents);
      }
    } catch {
      /* */
    }
    try {
      const backs = await fetchAll(
        `/rest/v1/back_protections?match_id=in.(${inList})&status=in.(active,pending,review_odd)&select=match_id,amount_cents`
      );
      for (const r of backs) {
        const cur = map.get(String(r.match_id));
        if (!cur) continue;
        cur.back += 1;
        cur.cents += n(r.amount_cents);
      }
    } catch {
      /* */
    }
  }
  return map;
}

async function main() {
  const ymd = DATE || todayBrYmd();
  const { fromIso, toIso } = brDayBounds(ymd);

  let q =
    `/rest/v1/matches?starts_at=gte.${encodeURIComponent(fromIso)}` +
    `&starts_at=lt.${encodeURIComponent(toIso)}` +
    `&select=*&order=starts_at.asc`;
  if (!INCLUDE_DELETED) q += `&deleted_at=is.null`;
  if (ONLY_PUBLISHED) q += `&is_published=eq.true`;

  let matches = [];
  try {
    matches = await fetchAll(q);
  } catch (e) {
    // fallback sem deleted_at / is_published se coluna faltar
    const msg = e instanceof Error ? e.message : String(e);
    let q2 =
      `/rest/v1/matches?starts_at=gte.${encodeURIComponent(fromIso)}` +
      `&starts_at=lt.${encodeURIComponent(toIso)}` +
      `&select=*&order=starts_at.asc`;
    matches = await fetchAll(q2);
    if (!INCLUDE_DELETED) {
      matches = matches.filter((m) => !m.deleted_at);
    }
    if (ONLY_PUBLISHED) {
      matches = matches.filter((m) => m.is_published === true);
    }
    if (!matches.length && /column/i.test(msg)) {
      console.warn("WARN:", msg.slice(0, 160));
    }
  }

  const protMap = await countOpenProtections(matches.map((m) => m.id));

  const rows = matches.map((m, idx) => {
    const prot = protMap.get(String(m.id)) || { lay: 0, back: 0, cents: 0 };
    const markets = Array.isArray(m.markets) ? m.markets.length : 0;
    return {
      n: idx + 1,
      id: m.id,
      home: m.home_team || "?",
      away: m.away_team || "?",
      league: m.league || null,
      starts_at: m.starts_at,
      status: m.status || m.status_v2 || null,
      is_published: !!m.is_published,
      deleted_at: m.deleted_at || null,
      max_protection_cents: n(m.max_protection_cents),
      used_protection_cents: n(m.used_protection_cents),
      markets,
      open_protections: prot.lay + prot.back,
      open_lay: prot.lay,
      open_back: prot.back,
      open_cents: prot.cents,
      final_score: m.final_score || null,
    };
  });

  const report = {
    date: ymd,
    from: fromIso,
    to: toIso,
    filter: {
      only_published: ONLY_PUBLISHED,
      include_deleted: INCLUDE_DELETED,
    },
    summary: {
      total: rows.length,
      published: rows.filter((r) => r.is_published).length,
      draft: rows.filter((r) => !r.is_published).length,
      with_open_protection: rows.filter((r) => r.open_protections > 0).length,
      settled: rows.filter((r) =>
        ["settled", "finished", "closed"].includes(
          String(r.status || "").toLowerCase()
        )
      ).length,
    },
    matches: rows,
  };

  if (AS_JSON) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("═".repeat(72));
  console.log(`JOGOS · ${ymd} (kickoff BRT)`);
  console.log(`UTC: ${fromIso} → ${toIso}`);
  console.log(
    `Total: ${report.summary.total} · Publicados: ${report.summary.published} · Rascunho: ${report.summary.draft} · Com proteção aberta: ${report.summary.with_open_protection} · Settled: ${report.summary.settled}`
  );
  console.log("═".repeat(72));

  if (!rows.length) {
    console.log("\nNenhum jogo com kickoff neste dia.\n");
    return;
  }

  for (const r of rows) {
    const pub = r.is_published ? "PUB" : "draft";
    const del = r.deleted_at ? " EXCLUÍDO" : "";
    console.log("");
    console.log(
      `${String(r.n).padStart(2, " ")}. ${fmtTime(r.starts_at)}  ${r.home} x ${r.away}  [${pub}${del}]`
    );
    if (r.league) console.log(`    Liga: ${r.league}`);
    console.log(
      `    status=${r.status || "—"}  liquidez=${money(r.used_protection_cents)}/${money(r.max_protection_cents)}  mercados=${r.markets}`
    );
    if (r.open_protections) {
      console.log(
        `    proteções abertas: ${r.open_protections} (LAY ${r.open_lay} / BACK ${r.open_back}) · ${money(r.open_cents)}`
      );
    }
    if (r.final_score) console.log(`    placar: ${r.final_score}`);
    console.log(`    id: ${r.id}`);
  }
  console.log("");
}

main().catch((err) => {
  console.error("ERRO:", err instanceof Error ? err.message : err);
  process.exit(1);
});
