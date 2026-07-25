#!/usr/bin/env node
/**
 * Lança OU revive evento MANUAL de teste (publicado).
 * - Odd 1,10 BACK (dedução R$ 85 em stake R$ 1.000)
 * - Se já existir sandbox_test, só empurra o horário e republica
 *
 * Na VPS:
 *   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/protecao-fee-upfront-3cf9/scripts/vps-sandbox-lancar-evento-teste.sh?$(date +%s)")
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
const HOURS = Number(process.env.TEST_HOURS_AHEAD || 6);
const HOME = process.env.TEST_HOME || "ArbiShield Teste A";
const AWAY = process.env.TEST_AWAY || "ArbiShield Teste B";
const SIDE =
  String(process.env.TEST_SIDE || "BACK").toUpperCase() === "LAY"
    ? "LAY"
    : "BACK";
const FORCE_NEW =
  process.env.FORCE_NEW === "1" || process.env.FORCE_NEW === "true";

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

function buildMarkets(liqCents) {
  const marketId = randomUUID();
  const marketName =
    SIDE === "BACK" ? "Back · Sandbox Teste" : "Lay · Sandbox Teste";
  return [
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
}

async function findExisting() {
  const rows = await sb(
    `/rest/v1/matches?select=id,home_team,away_team,starts_at,is_published,deleted_at,metadata,markets,max_protection_cents,used_protection_cents&is_published=eq.true&deleted_at=is.null&order=starts_at.desc&limit=80`
  );
  const list = Array.isArray(rows) ? rows : [];
  return list.filter((m) => {
    const meta = m.metadata && typeof m.metadata === "object" ? m.metadata : {};
    if (meta.sandbox_test === true) return true;
    const league = String(m.league || "");
    return /SANDBOX/i.test(league) || /ArbiShield Teste/i.test(m.home_team || "");
  });
}

async function main() {
  const liqCents = Math.round(LIQ_BRL * 100);
  const starts = new Date(Date.now() + Math.max(1, HOURS) * 3600_000);

  const existing = FORCE_NEW ? [] : await findExisting();
  if (existing.length) {
    console.log("==> Reviver", existing.length, "evento(s) teste existente(s)");
    for (const m of existing) {
      const markets = buildMarkets(liqCents);
      const patched = await sb(
        `/rest/v1/matches?id=eq.${encodeURIComponent(m.id)}`,
        {
          method: "PATCH",
          body: {
            home_team: HOME,
            away_team: AWAY,
            league: "SANDBOX · Evento teste fee_upfront",
            starts_at: starts.toISOString(),
            status: "open",
            status_v2: "open",
            is_published: true,
            deleted_at: null,
            max_protection_cents: liqCents,
            used_protection_cents: 0,
            protection_odds: { home: ODD, away: ODD },
            markets,
            metadata: {
              ...(m.metadata && typeof m.metadata === "object" ? m.metadata : {}),
              source: "admin_manual",
              sandbox_test: true,
              billing_model_hint: "fee_upfront_v1",
              release_minutes_before: 0,
              revived_at: new Date().toISOString(),
            },
            updated_at: new Date().toISOString(),
          },
        }
      );
      const row = Array.isArray(patched) ? patched[0] : patched;
      console.log("  OK revive", row?.id || m.id, "→", starts.toLocaleString("pt-BR"));
    }
  } else {
    const markets = buildMarkets(liqCents);
    const externalId = `sandbox-test-${Date.now()}`;
    console.log("==> Criar evento TESTE novo");
    console.log("   ", HOME, "vs", AWAY);
    console.log("    odd", ODD, "·", SIDE, "· liq", money(liqCents));
    console.log("    começa", starts.toLocaleString("pt-BR"));

    const created = await sb("/rest/v1/matches", {
      method: "POST",
      body: {
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
      },
    });
    const match = Array.isArray(created) ? created[0] : created;
    if (!match?.id) throw new Error("match sem id");
    console.log("  matchId:", match.id);
  }

  const stake = 100_000;
  const profit = Math.max(0, Math.round(stake * (ODD - 1)));
  const user = Math.round(stake * 0.015);
  const fee = Math.max(0, profit - user);

  console.log("\nOK — evento teste disponível");
  console.log(
    "  Ex.: stake R$ 1.000 @",
    ODD,
    SIDE,
    "→ dedução",
    money(fee),
    `(seu lucro ${money(user)})`
  );
  console.log("\nAbrir:");
  console.log("  https://arbishield.app/app-proteger.html");
  console.log("  https://arbishield.app/sandbox/app-proteger.html");
  console.log("  (janela anônima · saldo DEMO · ArbiShield Teste A vs B)");
}

main().catch((e) => {
  console.error("ERRO:", e.message || e);
  process.exit(1);
});
