#!/usr/bin/env node
/**
 * Lança um evento manual de teste para validar Proteção/Reembolso/Exchange.
 *
 * Simular:
 *   REQUEST_ID=teste-protecao-20260728 node /opt/arbishield/scripts/vps-lancar-jogo-teste.mjs
 * Aplicar:
 *   APPLY=1 REQUEST_ID=teste-protecao-20260728 node /opt/arbishield/scripts/vps-lancar-jogo-teste.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const APPLY = process.env.APPLY === "1";
const REQUEST_ID = String(process.env.REQUEST_ID || "").trim();
const HOME = String(process.env.HOME_TEAM || "ArbiShield Teste Casa").trim();
const AWAY = String(process.env.AWAY_TEAM || "ArbiShield Teste Fora").trim();
const ODD = Number(process.env.ODD || 10);
const LIQUIDITY_CENTS = Math.round(Number(process.env.LIQUIDITY_CENTS || 2_000_000));

for (const file of ["/opt/arbishield/deploy/vps-supabase/.env", "/opt/arbishield/.env", path.resolve(".env")]) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i < 1 || line.trimStart().startsWith("#")) continue;
    const key = line.slice(0, i).trim();
    if (!process.env[key]) process.env[key] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
  }
}
const key = process.env.ARBISHIELD_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const base = String(process.env.ARBISHIELD_SUPABASE_URL || process.env.SUPABASE_URL || process.env.API_EXTERNAL_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
if (!key || !REQUEST_ID || !(ODD > 1) || !(LIQUIDITY_CENTS > 0)) throw new Error("Informe REQUEST_ID, ODD > 1, LIQUIDITY_CENTS > 0 e SERVICE_ROLE_KEY");

async function api(route, { method = "GET", body } = {}) {
  const response = await fetch(base + route, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, ...(body ? { "Content-Type": "application/json", Prefer: "return=representation" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${route}: ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  const externalId = `manual-test-${REQUEST_ID}`;
  const existing = await api(`/rest/v1/matches?select=id,home_team,away_team&external_id=eq.${encodeURIComponent(externalId)}&limit=1`);
  if (Array.isArray(existing) && existing.length) throw new Error(`REQUEST_ID já usado no jogo ${existing[0].id}`);

  const startsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const market = {
    id: randomUUID(),
    name: "LAY Teste 0x0",
    odd: ODD,
    liquidity: LIQUIDITY_CENTS,
    display_liquidity: LIQUIDITY_CENTS,
    used_liquidity: 0,
    market_type: "LAY",
    external_id: null,
  };
  const row = {
    home_team: HOME,
    away_team: AWAY,
    league: "TESTE INTERNO — NÃO OPERAR",
    starts_at: startsAt,
    status: "open",
    status_v2: "open",
    is_published: true,
    sport_type: "futebol",
    max_protection_cents: LIQUIDITY_CENTS,
    used_protection_cents: 0,
    protection_odds: { home: ODD, away: ODD },
    external_id: externalId,
    score_sync_enabled: false,
    has_live_stream: false,
    metadata: { source: "admin_manual_test", request_id: REQUEST_ID, test_only: true, release_minutes_before: 0 },
    markets: [market],
  };
  console.log(`Jogo teste: ${HOME} x ${AWAY} · LAY @${ODD} · liquidez R$ ${(LIQUIDITY_CENTS / 100).toFixed(2)} · ${startsAt}`);
  if (!APPLY) return console.log("SIMULAÇÃO — repita com APPLY=1 para lançar.");
  const created = await api("/rest/v1/matches", { method: "POST", body: row });
  console.log(`OK — lançado id=${created?.[0]?.id || created?.id || "desconhecido"}`);
}
main().catch((error) => { console.error("FALHA:", error.message || error); process.exit(1); });
