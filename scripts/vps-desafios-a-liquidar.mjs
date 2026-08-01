#!/usr/bin/env node
/**
 * Desafios abertos com etapa pendente de liquidação — e qual botão usar.
 *
 * SÓ LEITURA: não liquida, não escreve, não move saldo. Serve para o admin
 * abrir a Gestão de Desafios sabendo exatamente o que fazer em cada etapa.
 *
 * Na VPS:
 *   node /opt/arbishield/scripts/vps-desafios-a-liquidar.mjs
 */
import fs from "node:fs";
import path from "node:path";
import {
  SETTLE_SUGGEST_VERSION,
  suggestSettle,
} from "./lib/desafio-settle-suggest.mjs";
import { inferMatchFinished } from "./lib/betbra-inplay-sync.mjs";

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

/** Etapa já liquidada? Mesma regra do card e do admin. */
function stepSettled(step) {
  if (step.settled_at) return true;
  const st = String(step.status || "").toLowerCase();
  if (["done", "settled", "closed", "cancelled", "canceled"].includes(st)) return true;
  const res = String(step.result || "").toLowerCase();
  return ["win", "zebra_protected", "lost", "bateu", "void", "empate_anula"].includes(res);
}

/**
 * Sinal de "encerrado", em ordem de confiança:
 *   1. `metadata.live.finished` — o próprio feed dizendo fim de jogo. Vem da API
 *      `/api/arbishield/desafios`, que enriquece as etapas com o cache ao vivo
 *      (a coluna `metadata` não existe no banco, então direto do Postgres isso
 *      nunca aparece);
 *   2. `status = done`;
 *   3. inferência por tempo — **só serve se `starts_at` for o kickoff real**. Em
 *      desafios lançados em lote o `starts_at` é o horário do lançamento, e aí a
 *      inferência não vale nada; o relatório avisa quando detecta isso.
 */
function scoreOf(step, nowMs, trustStartsAt = true) {
  const meta = step.metadata && typeof step.metadata === "object" ? step.metadata : {};
  const live = meta.live && typeof meta.live === "object" ? meta.live : null;
  const home =
    step.final_score_home != null
      ? Number(step.final_score_home)
      : live && live.home_score != null
        ? Number(live.home_score)
        : null;
  const away =
    step.final_score_away != null
      ? Number(step.final_score_away)
      : live && live.away_score != null
        ? Number(live.away_score)
        : null;

  const status = String(step.status || "").toLowerCase();
  let finished = false;
  let why = "";
  if (live && live.finished) {
    finished = true;
    why = "feed marcou fim de jogo" + (live.elapsed ? ` (${live.elapsed})` : "");
  } else if (status === "done") {
    finished = true;
    why = "etapa marcada como done";
  } else if (live && live.live) {
    why = `ainda ao vivo${live.elapsed ? ` (${live.elapsed})` : ""}`;
  } else if (trustStartsAt && inferMatchFinished(step, null, nowMs)) {
    finished = true;
    const mins = step.starts_at
      ? Math.floor((nowMs - new Date(step.starts_at).getTime()) / 60000)
      : null;
    why = mins != null ? `${mins} min desde o início` : "inferido pelo horário";
  } else if (!trustStartsAt) {
    why = "feed não confirmou e o horário de início não é confiável";
  } else {
    why = status === "live" ? "ainda ao vivo" : "sem sinal de encerramento";
  }

  return {
    home: Number.isFinite(home) ? home : null,
    away: Number.isFinite(away) ? away : null,
    finished,
    why,
  };
}

const PRELIVE = (process.env.ARBISHIELD_PRELIVE || "http://127.0.0.1:3098").replace(
  /\/$/,
  ""
);

/**
 * A API enriquece as etapas com o cache ao vivo (placar + fim de jogo do feed),
 * que é o mesmo que o card do cliente mostra. Sem ela, sobra só o banco — onde
 * `metadata` não existe e o fim de jogo não aparece.
 */
async function fetchFromApi() {
  const res = await fetch(`${PRELIVE}/api/arbishield/desafios`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  const rows = Array.isArray(data) ? data : data?.items || data?.desafios || [];
  if (!Array.isArray(rows)) throw new Error("resposta inesperada da API");
  return rows;
}

let apiRows = null;
let liveSource = "banco (sem fim de jogo do feed)";
try {
  apiRows = await fetchFromApi();
  liveSource = `API ${PRELIVE}/api/arbishield/desafios`;
} catch (err) {
  console.warn(`aviso: API de desafios indisponível (${err.message}) — usando só o banco`);
}

const desafios = apiRows
  ? apiRows.filter((d) => d && d.is_active && !d.deleted_at)
  : await sb(
      "/rest/v1/desafios?select=*&deleted_at=is.null&is_active=eq.true&order=number.asc"
    );
desafios.sort((a, b) => Number(a.number || 0) - Number(b.number || 0));

if (!desafios.length) {
  console.log("\nNenhum desafio publicado/ativo.\n");
  process.exit(0);
}

const ids = desafios.map((d) => d.id);
const inList = `(${ids.map((i) => `"${i}"`).join(",")})`;
// select=* de propósito: as tabelas nasceram fora das migrations e o conjunto de
// colunas varia entre bancos (desafio_steps.metadata, por exemplo, não existe).
const steps = apiRows
  ? desafios.flatMap((d) =>
      (Array.isArray(d.desafio_steps) ? d.desafio_steps : []).map((s) => ({
        ...s,
        desafio_id: s.desafio_id || d.id,
      }))
    )
  : await sb(
      `/rest/v1/desafio_steps?select=*&desafio_id=in.${inList}&order=step_index.asc`
    );
const parts = await sb(
  `/rest/v1/desafio_participations?select=*&desafio_id=in.${inList}`
);

// starts_at igual em etapas de jogos diferentes = horário do lançamento, não
// kickoff. Nesse caso a inferência por tempo não vale e o relatório avisa.
const kickoffs = new Set(
  steps.filter((s) => !stepSettled(s) && !s.deleted_at).map((s) => String(s.starts_at || ""))
);
const trustStartsAt = kickoffs.size !== 1 || steps.length <= 1;

if (process.env.DEBUG_COLUNAS === "1" && steps[0]) {
  console.log("\ncolunas de desafio_steps:", Object.keys(steps[0]).sort().join(", "));
  if (parts[0]) {
    console.log("colunas de desafio_participations:", Object.keys(parts[0]).sort().join(", "));
  }
}

const openByDesafio = new Map();
for (const s of steps) {
  if (s.deleted_at) continue;
  if (stepSettled(s)) continue;
  if (!openByDesafio.has(s.desafio_id)) openByDesafio.set(s.desafio_id, []);
  openByDesafio.get(s.desafio_id).push(s);
}

console.log(`\nDesafios a liquidar · ${SETTLE_SUGGEST_VERSION} · SÓ LEITURA`);
console.log(`fonte do placar: ${liveSource}\n`);
if (!trustStartsAt) {
  console.log(
    "ATENÇÃO: todas as etapas abertas têm o MESMO starts_at " +
      `(${[...kickoffs][0] || "?"}) — é o horário do lançamento, não o kickoff real.`
  );
  console.log(
    "         Sem confirmação do feed, nenhuma etapa é dada como encerrada.\n"
  );
}

let totalOpen = 0;
let readyToSettle = 0;
let waiting = 0;
let needsReview = 0;

for (const d of desafios) {
  const open = openByDesafio.get(d.id) || [];
  if (!open.length) continue;

  console.log(`#${d.number ?? "?"} ${d.title || "Desafio"}`);
  for (const s of open) {
    totalOpen += 1;
    const teams = {
      homeTeam: s.home_team || "",
      awayTeam: s.away_team || "",
    };
    const sc = scoreOf(s, Date.now(), trustStartsAt);
    const marketArbi = s.market_name_arbishield || s.market_name || "";
    const marketCasa = s.market_name_casa || s.market_name || "";
    const sug = suggestSettle({
      marketArbi,
      marketCasa,
      home: sc.home,
      away: sc.away,
      finished: sc.finished,
      ...teams,
    });

    const stepParts = parts.filter(
      (p) => String(p.step_id) === String(s.id) && !["cancelled", "canceled"].includes(String(p.result || "").toLowerCase())
    );
    const stake = stepParts.reduce((acc, p) => acc + Number(p.amount_cents || 0), 0);

    if (sug.winningSide) readyToSettle += 1;
    else if (sug.label === "aguardar") waiting += 1;
    else needsReview += 1;

    const score =
      sc.home != null && sc.away != null ? `${sc.home}-${sc.away}` : "sem placar";
    const jogo =
      s.match_label ||
      [teams.homeTeam, teams.awayTeam].filter(Boolean).join(" x ") ||
      "(sem times)";

    console.log(
      `   etapa ${pad(s.step_index ?? "?", 2)} ${pad(jogo, 34)} ${pad(score, 12)} ` +
        `${pad(sug.label, 16)} ${pad(`${stepParts.length} entrada(s) ${money(stake)}`, 26)}`
    );
    console.log(
      `            arbi: ${pad(marketArbi, 32)} → ${sug.arbi ?? "?"}`
    );
    console.log(
      `            casa: ${pad(marketCasa, 32)} → ${sug.casa ?? "?"}`
    );
    const kick = s.starts_at
      ? new Date(s.starts_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
      : "sem horário";
    console.log(
      `            início: ${pad(kick, 22)} encerrado: ${sc.finished ? "sim" : "NÃO"} (${sc.why})`
    );
    if (!sug.winningSide) console.log(`            motivo: ${sug.reason}`);
  }
  console.log();
}

if (!totalOpen) {
  console.log("Nenhuma etapa pendente de liquidação.\n");
  process.exit(0);
}

console.log(
  `${totalOpen} etapa(s) aberta(s) · ${readyToSettle} com botão sugerido · ` +
    `${waiting} aguardando fim do jogo · ${needsReview} para conferir à mão\n`
);
console.log("Liquidar em Gestão de Desafios (admin-desafios.html) ou no Monitor.");
console.log("Nada foi alterado por este relatório.\n");
