#!/usr/bin/env node
/**
 * Proteções abertas por partida — e qual outcome cada uma pede.
 *
 * SÓ LEITURA: não liquida, não escreve, não move saldo. O fluxo de proteção é
 * contrato travado (`stake_lock_v1`); este script apenas mostra o que está aberto
 * e sugere o outcome para o admin conferir antes de liquidar.
 *
 * Regra usada (v10 · stake_lock_v1):
 * Termos (protection-result-terms-v1) — nomeados pela indicação da proteção:
 *   Ganho     (arbishield) → indicação ganhou: credita no Saldo Reembolso
 *   Reembolso (exchange)   → indicação perdeu: devolve o stake à origem,
 *                            cobra só a dedução
 *   Anula     (void)       → empate anula: destrava e devolve à origem
 *
 * BACK ganha quando o mercado acontece; LAY ganha quando NÃO acontece.
 *
 * Na VPS:
 *   node /opt/arbishield/scripts/vps-protecoes-a-liquidar.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { marketStatus } from "./lib/desafio-settle-suggest.mjs";

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

if (!SERVICE_KEY) {
  console.error("ERRO: SERVICE_ROLE_KEY ausente (rode na VPS ou informe ENV_FILE)");
  process.exit(1);
}

const OPEN_STATUS = ["active", "pending", "review_odd"];

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

const money = (cents) =>
  (Number(cents || 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const pad = (s, w) => {
  s = String(s ?? "");
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
};
const metaOf = (row) =>
  row && row.metadata && typeof row.metadata === "object" ? row.metadata : {};

async function openRows(table, kind) {
  const filter = `status=in.(${OPEN_STATUS.join(",")})`;
  try {
    const rows = await sb(`/rest/v1/${table}?select=*&${filter}`);
    return (Array.isArray(rows) ? rows : []).map((r) => ({ ...r, _kind: kind }));
  } catch (err) {
    console.warn(`aviso: não li ${table} (${err.message})`);
    return [];
  }
}

const lay = await openRows("protections", "LAY");
const back = await openRows("back_protections", "BACK");
const all = [...lay, ...back].filter((r) => !r.deleted_at);

if (!all.length) {
  console.log("\nNenhuma proteção aberta.\n");
  process.exit(0);
}

const matchIds = [...new Set(all.map((r) => r.match_id).filter(Boolean))];
let matches = [];
if (matchIds.length) {
  const inList = `(${matchIds.map((i) => `"${i}"`).join(",")})`;
  matches = await sb(`/rest/v1/matches?select=*&id=in.${inList}`);
}
const matchById = new Map(matches.map((m) => [String(m.id), m]));

/** Placar da partida — o campo varia conforme quem gravou. */
function scoreOfMatch(match) {
  if (!match) return { home: null, away: null, finished: false, why: "partida não encontrada" };
  const meta = metaOf(match);
  const live = meta.live && typeof meta.live === "object" ? meta.live : null;
  const pick = (...vals) => {
    for (const v of vals) if (v != null && Number.isFinite(Number(v))) return Number(v);
    return null;
  };
  const home = pick(match.final_score_home, match.home_score, live?.home_score);
  const away = pick(match.final_score_away, match.away_score, live?.away_score);
  const status = String(match.status_v2 || match.status || "").toLowerCase();
  let finished = false;
  let why = "";
  if (live?.finished) {
    finished = true;
    why = "feed marcou fim de jogo";
  } else if (/finish|encerrad|settled|done|ft/.test(status)) {
    finished = true;
    why = `status ${status}`;
  } else {
    why = status ? `status ${status}` : "sem sinal de encerramento";
  }
  return { home, away, finished, why };
}

/** Sugestão de outcome. BACK ganha se o mercado acontece; LAY, se não acontece. */
function suggestOutcome(row, match, sc) {
  const meta = metaOf(row);
  const marketName = meta.market_name || row.market_name || "";
  const teams = { homeTeam: match?.home_team || "", awayTeam: match?.away_team || "" };
  if (!sc.finished) {
    return { outcome: null, label: "aguardar", reason: "partida não encerrada", marketName };
  }
  if (sc.home == null || sc.away == null) {
    return {
      outcome: null,
      label: "sem placar",
      reason: "encerrada sem resultado gravado — buscar o placar",
      marketName,
    };
  }
  const st = marketStatus(marketName, sc.home, sc.away, true, teams);
  if (st === "void") {
    return { outcome: "void", label: "Anula", reason: "empate anula — destrava o stake e devolve à origem", marketName };
  }
  if (st !== "win" && st !== "lose") {
    return {
      outcome: null,
      label: "conferir",
      reason: marketName
        ? `mercado não reconhecido: "${marketName}"`
        : "proteção sem mercado registrado",
      marketName,
    };
  }
  const aconteceu = st === "win";
  const clienteGanhou = row._kind === "BACK" ? aconteceu : !aconteceu;
  return clienteGanhou
    ? {
        outcome: "arbishield",
        label: "Ganho",
        reason: `${row._kind} · mercado ${aconteceu ? "aconteceu" : "não aconteceu"} → indicação ganhou → credita no Saldo Reembolso`,
        marketName,
      }
    : {
        outcome: "exchange",
        label: "Reembolso",
        reason: `${row._kind} · mercado ${aconteceu ? "aconteceu" : "não aconteceu"} → indicação perdeu → devolve o stake à origem e cobra só a dedução`,
        marketName,
      };
}

const byMatch = new Map();
for (const r of all) {
  const key = String(r.match_id || "sem-partida");
  if (!byMatch.has(key)) byMatch.set(key, []);
  byMatch.get(key).push(r);
}

console.log("\nProteções abertas · stake_lock_v1 · SÓ LEITURA");
console.log(`${all.length} proteção(ões) em ${byMatch.size} partida(s)\n`);

let ready = 0;
let waiting = 0;
let review = 0;
let totalCents = 0;

for (const [matchId, rows] of byMatch) {
  const match = matchById.get(matchId);
  const sc = scoreOfMatch(match);
  const jogo = match
    ? [match.home_team, match.away_team].filter(Boolean).join(" x ") || matchId
    : `partida ${matchId} (não encontrada)`;
  const score = sc.home != null && sc.away != null ? `${sc.home}-${sc.away}` : "sem placar";
  const kick = match?.starts_at
    ? new Date(match.starts_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
    : "sem horário";

  console.log(`${jogo}   ${score}   início ${kick}`);
  console.log(`   encerrada: ${sc.finished ? "sim" : "NÃO"} (${sc.why})`);

  for (const r of rows) {
    const sug = suggestOutcome(r, match, sc);
    const valor = Number(r.responsibility_cents || r.amount_cents || 0);
    totalCents += valor;
    if (sug.outcome) ready += 1;
    else if (sug.label === "aguardar") waiting += 1;
    else review += 1;
    console.log(
      `   ${pad(r._kind, 5)} ${pad(String(r.id).slice(0, 8), 10)} ${pad(money(valor), 14)} ` +
        `odd ${pad(r.odd ?? "?", 7)} ${pad(sug.label, 20)}`
    );
    console.log(`         mercado: ${sug.marketName || "(não registrado)"}`);
    console.log(`         ${sug.reason}`);
  }
  console.log();
}

console.log(
  `${all.length} proteção(ões) · ${money(totalCents)} em jogo · ` +
    `${ready} com outcome sugerido · ${waiting} aguardando · ${review} para conferir\n`
);
console.log("Liquidar em Jogos (admin-jogos.html) → outcome por mercado da partida.");
console.log("A sugestão é para conferência — o fluxo de proteção é contrato travado.");
console.log("Nada foi alterado por este relatório.\n");
