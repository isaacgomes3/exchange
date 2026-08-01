#!/usr/bin/env node
/**
 * Backtest da sugestão de outcome contra proteções JÁ LIQUIDADAS.
 *
 * SÓ LEITURA. Responde à pergunta que importa antes de automatizar ou de
 * confiar numa lista de sugestões: quando a ArbiShield liquidou de verdade, o
 * resultado foi o que a minha lógica diria?
 *
 * Se a taxa de acerto for alta, a direção (`arbishield` = Reembolso) está certa.
 * Se for baixa e o erro for sistemático — tudo invertido —, a direção está errada
 * e o relatório de pendentes precisa ser corrigido antes de liquidar nada.
 *
 * Na VPS:
 *   node /opt/arbishield/scripts/vps-protecoes-backtest.mjs
 *   DIAS=30 node /opt/arbishield/scripts/vps-protecoes-backtest.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { suggestProtectionOutcome } from "./lib/desafio-settle-suggest.mjs";

function loadEnvFile(file) {
  if (!file || !fs.existsSync(file)) return;
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
const DIAS = Math.max(1, Number(process.env.DIAS || 60));

if (!SERVICE_KEY) {
  console.error("ERRO: SERVICE_ROLE_KEY ausente (rode na VPS ou informe ENV_FILE)");
  process.exit(1);
}

async function sb(pathname) {
  const res = await fetch(SUPABASE_URL + pathname, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${pathname} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : [];
}

const pad = (s, w) => {
  s = String(s ?? "");
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
};
const metaOf = (r) => (r && r.metadata && typeof r.metadata === "object" ? r.metadata : {});

/** Outcome que ficou registrado, normalizado. */
function outcomeGravado(row) {
  const o = String(row.settled_outcome || "").toLowerCase().trim();
  if (o === "arbishield" || o === "exchange") return o;
  if (o === "void" || o === "empate_anula" || o === "anula") return "void";
  const st = String(row.status || "").toLowerCase();
  if (st === "lost_exchange" || st === "won_platform") return "arbishield";
  if (st === "won_exchange") return "exchange";
  if (st === "void") return "void";
  return "";
}

const desde = new Date(Date.now() - DIAS * 864e5).toISOString();

async function settled(table, kind) {
  try {
    const rows = await sb(
      `/rest/v1/${table}?select=*&settled_at=gte.${encodeURIComponent(desde)}` +
        `&settled_at=not.is.null&order=settled_at.desc&limit=500`
    );
    return (Array.isArray(rows) ? rows : []).map((r) => ({ ...r, _kind: kind }));
  } catch (err) {
    console.warn(`aviso: não li ${table} (${err.message})`);
    return [];
  }
}

const rows = [
  ...(await settled("protections", "LAY")),
  ...(await settled("back_protections", "BACK")),
].filter((r) => outcomeGravado(r));

if (!rows.length) {
  console.log(`\nNenhuma proteção liquidada nos últimos ${DIAS} dias.\n`);
  process.exit(0);
}

const matchIds = [...new Set(rows.map((r) => r.match_id).filter(Boolean))];
let matches = [];
if (matchIds.length) {
  const inList = `(${matchIds.map((i) => `"${i}"`).join(",")})`;
  matches = await sb(`/rest/v1/matches?select=*&id=in.${inList}`);
}
const matchById = new Map(matches.map((m) => [String(m.id), m]));

function placarDe(match, row) {
  const pick = (...vals) => {
    for (const v of vals) if (v != null && Number.isFinite(Number(v))) return Number(v);
    return null;
  };
  const live = metaOf(match).live || {};
  const rmeta = metaOf(row);
  return {
    home: pick(match?.final_score_home, match?.home_score, live.home_score, rmeta.final_score_home),
    away: pick(match?.final_score_away, match?.away_score, live.away_score, rmeta.final_score_away),
  };
}

let acerto = 0;
let erro = 0;
let semSugestao = 0;
const invertidos = [];
const detalhes = [];

for (const row of rows) {
  const match = matchById.get(String(row.match_id));
  const sc = placarDe(match, row);
  const gravado = outcomeGravado(row);
  const sug = suggestProtectionOutcome({
    kind: row._kind,
    marketName: metaOf(row).market_name || row.market_name || "",
    home: sc.home,
    away: sc.away,
    finished: true,
    homeTeam: match?.home_team || "",
    awayTeam: match?.away_team || "",
  });

  if (!sug.outcome) {
    semSugestao += 1;
    detalhes.push({ row, match, sc, gravado, sug, veredito: "sem sugestão" });
    continue;
  }
  const ok = sug.outcome === gravado;
  if (ok) acerto += 1;
  else {
    erro += 1;
    const trocado =
      (sug.outcome === "arbishield" && gravado === "exchange") ||
      (sug.outcome === "exchange" && gravado === "arbishield");
    if (trocado) invertidos.push(row.id);
  }
  detalhes.push({ row, match, sc, gravado, sug, veredito: ok ? "acertou" : "ERROU" });
}

console.log(`\nBacktest da sugestão · últimos ${DIAS} dias · SÓ LEITURA\n`);
for (const d of detalhes.slice(0, 40)) {
  const jogo = d.match
    ? [d.match.home_team, d.match.away_team].filter(Boolean).join(" x ")
    : `partida ${d.row.match_id}`;
  const placar =
    d.sc.home != null && d.sc.away != null ? `${d.sc.home}-${d.sc.away}` : "sem placar";
  console.log(
    `  ${pad(d.veredito, 12)} ${pad(String(d.row.id).slice(0, 8), 10)} ${pad(d.row._kind, 5)} ` +
      `${pad(jogo, 30)} ${pad(placar, 11)} ` +
      `sugerido ${pad(d.sug.outcome || d.sug.label, 11)} gravado ${d.gravado}`
  );
  console.log(`               mercado: ${metaOf(d.row).market_name || "(não registrado)"}`);
}
if (detalhes.length > 40) console.log(`  ... e mais ${detalhes.length - 40}`);

const comparaveis = acerto + erro;
const pct = comparaveis ? Math.round((acerto / comparaveis) * 100) : 0;
console.log(
  `\n${rows.length} liquidadas · ${comparaveis} comparáveis · ${acerto} acertos (${pct}%) · ` +
    `${erro} erros · ${semSugestao} sem sugestão\n`
);

if (comparaveis && erro === comparaveis && invertidos.length === erro) {
  console.log("ERRO SISTEMÁTICO: todas invertidas — a direção do outcome está trocada.");
  console.log("Não liquidar pela sugestão; corrigir suggestProtectionOutcome primeiro.\n");
  process.exit(2);
}
if (pct >= 90) {
  console.log("Direção confirmada pelo histórico. Sugestões de pendentes são confiáveis.\n");
} else if (comparaveis) {
  console.log(
    "Acerto abaixo de 90% — conferir os casos marcados ERROU antes de confiar na lista.\n"
  );
}
process.exit(0);
