#!/usr/bin/env node
/**
 * Lança OU revive evento MANUAL de teste (publicado) — visível na grade.
 *
 * - Odd 1,10 em BACK e LAY (filtro "Todos" / LAY / BACK)
 * - Horário perto (+45 min por padrão) para aparecer no topo
 * - Revive até eventos unpublished/deleted com sandbox_test
 * - Imprime diagnóstico de por que aparece ou não
 *
 * Na VPS:
 *   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/protecao-fee-upfront-3cf9/scripts/vps-sandbox-lancar-evento-teste.sh?$(date +%s)")
 *
 * Forçar novo (não revive):
 *   FORCE_NEW=1 bash <(curl ...)
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

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

const ODD = Number(process.env.TEST_ODD || 1.1);
const LIQ_BRL = Number(process.env.TEST_LIQ_BRL || 5000);
/** Minutos até o kickoff (padrão 45 — aparece no topo da grade). */
const MINUTES = Number(
  process.env.TEST_MINUTES_AHEAD ||
    (process.env.TEST_HOURS_AHEAD
      ? Number(process.env.TEST_HOURS_AHEAD) * 60
      : 45)
);
const HOME = process.env.TEST_HOME || "ArbiShield Teste A";
const AWAY = process.env.TEST_AWAY || "ArbiShield Teste B";
const FORCE_NEW =
  process.env.FORCE_NEW === "1" || process.env.FORCE_NEW === "true";
const LIVE_WINDOW_MS = 9000 * 1000;

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

/** Sempre BACK + LAY — assim não some se o usuário filtrar um lado. */
function buildMarkets(liqCents) {
  return [
    {
      id: randomUUID(),
      name: "Back · Sandbox Teste",
      odd: ODD,
      liquidity: liqCents,
      display_liquidity: null,
      used_liquidity: 0,
      market_type: "BACK",
      external_id: null,
    },
    {
      id: randomUUID(),
      name: "Lay · Sandbox Teste",
      odd: ODD,
      liquidity: liqCents,
      display_liquidity: null,
      used_liquidity: 0,
      market_type: "LAY",
      external_id: null,
    },
  ];
}

function isSandboxRow(m) {
  const meta = m.metadata && typeof m.metadata === "object" ? m.metadata : {};
  if (meta.sandbox_test === true) return true;
  if (/SANDBOX/i.test(String(m.league || ""))) return true;
  if (/ArbiShield Teste/i.test(String(m.home_team || ""))) return true;
  if (/ArbiShield Teste/i.test(String(m.away_team || ""))) return true;
  return false;
}

async function findExisting() {
  // Inclui unpublished/deleted — senão o revive falha e o usuário acha que “não apareceu”
  const rows = await sb(
    `/rest/v1/matches?select=id,home_team,away_team,league,starts_at,status,status_v2,is_published,deleted_at,metadata,markets,max_protection_cents,used_protection_cents&order=updated_at.desc.nullslast&limit=200`
  );
  const list = Array.isArray(rows) ? rows : [];
  return list.filter(isSandboxRow);
}

function visibilityWhy(m, now = Date.now()) {
  const reasons = [];
  if (m.is_published !== true) reasons.push("is_published≠true");
  if (m.deleted_at) reasons.push("deleted_at preenchido");
  const start = new Date(m.starts_at).getTime();
  if (!Number.isFinite(start)) reasons.push("starts_at inválido");
  else if (start + LIVE_WINDOW_MS <= now) reasons.push("fora da janela (+2h30 pós-kickoff)");
  const status = m.status_v2 || m.status || "open";
  if (
    status === "FINISHED" ||
    ["closed", "cancelled", "finished", "settled", "finalizado", "void"].includes(
      String(status).toLowerCase()
    )
  ) {
    reasons.push(`status=${status}`);
  }
  const max = Number(m.max_protection_cents || 0);
  const used = Number(m.used_protection_cents || 0);
  if (!(max > 0 && used < max)) reasons.push(`sem liquidez max=${max} used=${used}`);
  const mks = Array.isArray(m.markets) ? m.markets : [];
  const sides = [
    ...new Set(
      mks.map((mk) => String(mk.market_type || "LAY").toUpperCase())
    ),
  ];
  if (!mks.length) reasons.push("markets vazio");
  return {
    ok: reasons.length === 0,
    reasons,
    sides,
    startsAt: m.starts_at,
    max,
    used,
  };
}

function payload(liqCents, startsIso, prevMeta) {
  return {
    home_team: HOME,
    away_team: AWAY,
    league: "SANDBOX · Evento teste fee_upfront",
    starts_at: startsIso,
    status: "open",
    status_v2: "open",
    is_published: true,
    deleted_at: null,
    sport_type: "futebol",
    max_protection_cents: liqCents,
    used_protection_cents: 0,
    protection_odds: { home: ODD, away: ODD },
    score_sync_enabled: false,
    has_live_stream: false,
    markets: buildMarkets(liqCents),
    metadata: {
      ...(prevMeta && typeof prevMeta === "object" ? prevMeta : {}),
      source: "admin_manual",
      sandbox_test: true,
      billing_model_hint: "fee_upfront_v1",
      release_minutes_before: 0,
      revived_at: new Date().toISOString(),
      note: "Evento de teste — BACK+LAY odd 1.10 — pode apagar depois",
    },
    updated_at: new Date().toISOString(),
  };
}

async function main() {
  const liqCents = Math.round(LIQ_BRL * 100);
  const mins = Math.max(10, Number.isFinite(MINUTES) ? MINUTES : 45);
  const starts = new Date(Date.now() + mins * 60_000);
  const startsIso = starts.toISOString();

  console.log("==> Lançar evento teste (BACK + LAY @", ODD, ")");
  console.log("    kickoff em", mins, "min →", starts.toLocaleString("pt-BR"));
  console.log("    liq", money(liqCents), "· supabase", SUPABASE_URL);

  const existing = FORCE_NEW ? [] : await findExisting();
  const touched = [];

  if (existing.length) {
    console.log("==> Reviver", existing.length, "evento(s) teste (incl. unpublished/deleted)");
    for (const m of existing) {
      const body = payload(liqCents, startsIso, m.metadata);
      const patched = await sb(
        `/rest/v1/matches?id=eq.${encodeURIComponent(m.id)}`,
        { method: "PATCH", body }
      );
      const row = Array.isArray(patched) ? patched[0] : patched;
      touched.push(row || { ...m, ...body });
      console.log(
        "  OK revive",
        (row || m).id,
        "pub=",
        (row || m).is_published,
        "del=",
        (row || m).deleted_at
      );
    }
  } else {
    console.log("==> Criar evento TESTE novo");
    const body = {
      ...payload(liqCents, startsIso, null),
      external_id: `sandbox-test-${Date.now()}`,
    };
    delete body.updated_at;
    const created = await sb("/rest/v1/matches", { method: "POST", body });
    const match = Array.isArray(created) ? created[0] : created;
    if (!match?.id) throw new Error("match sem id");
    touched.push(match);
    console.log("  matchId:", match.id);
  }

  console.log("\n==> Diagnóstico de visibilidade (grade Proteger)");
  let anyOk = false;
  for (const m of touched) {
    const fresh = await sb(
      `/rest/v1/matches?select=id,home_team,away_team,league,starts_at,status,status_v2,is_published,deleted_at,metadata,markets,max_protection_cents,used_protection_cents&id=eq.${encodeURIComponent(m.id)}&limit=1`
    );
    const row = Array.isArray(fresh) ? fresh[0] : null;
    if (!row) {
      console.log("  ✗", m.id, "não encontrado após write");
      continue;
    }
    const v = visibilityWhy(row);
    anyOk = anyOk || v.ok;
    console.log(
      v.ok ? "  ✓ VISÍVEL" : "  ✗ OCULTO",
      row.id,
      "|",
      row.home_team,
      "×",
      row.away_team
    );
    console.log(
      "     lados:",
      v.sides.join("+") || "(nenhum)",
      "| liq",
      money(v.max - v.used),
      "| começa",
      new Date(v.startsAt).toLocaleString("pt-BR")
    );
    if (!v.ok) console.log("     motivos:", v.reasons.join("; "));
  }

  const stake = 100_000;
  const profit = Math.max(0, Math.round(stake * (ODD - 1)));
  const user = Math.round(stake * 0.015);
  const fee = Math.max(0, profit - user);

  console.log("\nOK — evento teste", anyOk ? "deve aparecer na grade" : "AINDA OCULTO (ver motivos)");
  console.log(
    "  Ex.: stake R$ 1.000 @",
    ODD,
    "BACK → dedução",
    money(fee),
    `(seu lucro ${money(user)})`
  );
  console.log("\nAbrir (janela anônima · filtro Todos · buscar “ArbiShield Teste”):");
  console.log("  https://arbishield.app/sandbox/app-proteger.html");
  console.log("  https://arbishield.app/app-proteger.html");
  if (!anyOk) process.exit(2);
}

main().catch((e) => {
  console.error("ERRO:", e.message || e);
  process.exit(1);
});
