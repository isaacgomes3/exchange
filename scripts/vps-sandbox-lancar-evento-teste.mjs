#!/usr/bin/env node
/**
 * Lança um evento MANUAL de teste (publicado) para validar fee_upfront.
 * Odd padrão 1,10 · liquidez R$ 5.000 · começa em ~2h.
 *
 * Na VPS:
 *   node /opt/arbishield-teste/scripts/vps-sandbox-lancar-evento-teste.mjs
 *   # ou:
 *   bash <(curl -fsSL ".../vps-sandbox-lancar-evento-teste.sh?v=1")
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
const HOURS = Number(process.env.TEST_HOURS_AHEAD || 2);
const HOME = process.env.TEST_HOME || "ArbiShield Teste A";
const AWAY = process.env.TEST_AWAY || "ArbiShield Teste B";
const SIDE = String(process.env.TEST_SIDE || "LAY").toUpperCase() === "BACK" ? "BACK" : "LAY";

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

async function main() {
  const liqCents = Math.round(LIQ_BRL * 100);
  const starts = new Date(Date.now() + Math.max(0.5, HOURS) * 3600_000);
  const marketId = randomUUID();
  const externalId = `sandbox-test-${Date.now()}`;

  const marketName =
    SIDE === "BACK" ? "Back · Sandbox Teste" : "Lay · Sandbox Teste";

  const markets = [
    {
      id: marketId,
      name: marketName,
      odd: ODD,
      liquidity: liqCents,
      display_liquidity: null,
      used_liquidity: 0,
      market_type: SIDE,
      external_id: null,
    },
  ];

  const row = {
    home_team: HOME,
    away_team: AWAY,
    league: "SANDBOX · Evento teste fee_upfront",
    starts_at: starts.toISOString(),
    status: "open",
    status_v2: "open",
    is_published: true,
    sport_type: "futebol",
    max_protection_cents: liqCents,
    used_protection_cents: 0,
    protection_odds: { home: ODD, away: ODD },
    external_id: externalId,
    score_sync_enabled: false,
    has_live_stream: false,
    metadata: {
      source: "admin_manual",
      sandbox_test: true,
      billing_model_hint: "fee_upfront_v1",
      release_minutes_before: 0,
      note: "Evento de teste — pode apagar depois",
    },
    markets,
  };

  console.log("==> Lançar evento TESTE (publicado)");
  console.log("    ", HOME, "vs", AWAY);
  console.log("    odd", ODD, "·", SIDE, "· liq", money(liqCents));
  console.log("    começa", starts.toLocaleString("pt-BR"));
  console.log("    external_id", externalId);

  const created = await sb("/rest/v1/matches", {
    method: "POST",
    body: row,
  });
  const match = Array.isArray(created) ? created[0] : created;
  if (!match?.id) throw new Error("match sem id");

  // Exemplo fee: stake 1000 @ 1.10 → 85
  const stake = 100_000;
  const profit = Math.round(stake * (ODD - 1));
  const user = Math.round(stake * 0.015);
  const fee = Math.max(0, profit - user);

  console.log("\nOK — evento criado");
  console.log("  matchId:", match.id);
  console.log("  marketId:", marketId);
  console.log(
    "  Exemplo proteção stake R$ 1.000 → cobra agora",
    money(fee),
    `(seu lucro ${money(user)})`
  );
  console.log("\nAbrir sandbox:");
  console.log("  https://arbishield.app/sandbox/app-proteger.html");
  console.log("  (Ctrl+F5 · saldo DEMO · escolher este jogo)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
