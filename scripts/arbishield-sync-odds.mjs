#!/usr/bin/env node
/**
 * Sincroniza cotações BetBra → matches abertos da ArbiShield (standalone, para VPS).
 *
 * Env:
 *   ARBISHIELD_SUPABASE_URL   (ex.: http://127.0.0.1:8000)
 *   ARBISHIELD_SERVICE_ROLE_KEY
 *   MEXCHANGE_*  (opcional; defaults iguais ao projeto exchange)
 *   DRY_RUN=1
 *
 * Uso:
 *   node scripts/arbishield-sync-odds.mjs
 *   DRY_RUN=1 node scripts/arbishield-sync-odds.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!(k in process.env)) process.env[k] = v;
  }
}

loadEnvFile(resolve(root, ".env.local"));
loadEnvFile(resolve(root, ".env"));
// VPS paths
loadEnvFile("/opt/arbishield/deploy/vps-supabase/.env");
loadEnvFile("/opt/arbishield/.arbishield-odds-sync.env");

const UA = process.env.MEXCHANGE_BOT_USER_AGENT || "BOT/SOFTWARE;Arbitrex;1.0";
const API_BASE =
  process.env.MEXCHANGE_API_BASE_URL ||
  "https://mexchange-api.betbra.bet.br/api";
const REFERER =
  process.env.MEXCHANGE_REFERER || "https://mexchange.betbra.bet.br/";
const SPACING = Number(process.env.MEXCHANGE_REQUEST_SPACING_MS || 200);
const DRY_RUN = process.env.DRY_RUN === "1";

const SUPABASE_URL =
  process.env.ARBISHIELD_SUPABASE_URL ||
  process.env.API_EXTERNAL_URL ||
  process.env.SUPABASE_PUBLIC_URL ||
  "http://127.0.0.1:8000";
const SERVICE_KEY =
  process.env.ARBISHIELD_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error("Falta ARBISHIELD_SERVICE_ROLE_KEY / SERVICE_ROLE_KEY");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastReq = 0;
async function spaced(fn) {
  const wait = Math.max(0, SPACING - (Date.now() - lastReq));
  if (wait) await sleep(wait);
  lastReq = Date.now();
  return fn();
}

async function sb(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function fetchEvent(eventId, sportId = 15, attempt = 1) {
  const url = `${API_BASE.replace(/\/$/, "")}/events/${eventId}?sport-id=${sportId}`;
  const res = await spaced(() =>
    fetch(url, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "identity",
        "User-Agent": UA,
        Referer: `${REFERER.replace(/\/$/, "")}/exchange/sport/soccer/event/${eventId}`,
        Cookie: `BIAB_LANGUAGE=${process.env.MEXCHANGE_BIAB_LANGUAGE || "PT_BR"}`,
      },
      redirect: "manual",
    })
  );
  const text = await res.text();
  if (res.status === 429 || (res.ok && !text.trim() && attempt < 3)) {
    await sleep(500 * attempt);
    return fetchEvent(eventId, sportId, attempt + 1);
  }
  if (!text.trim()) {
    const err = new Error(`BetBra evento vazio (${res.status}) — sem cotação disponível`);
    err.code = "EMPTY_EVENT";
    throw err;
  }
  if (!res.ok || text.trim().startsWith("<")) {
    throw new Error(`BetBra ${res.status}: ${text.slice(0, 120)}`);
  }
  return JSON.parse(text);
}

function parseLink(link) {
  if (!link) return null;
  const eventMatch = link.match(/\/event\/(\d+)/i);
  if (!eventMatch) return null;
  const marketMatch = link.match(/\/market\/(\d+)/i);
  const sportMatch = link.match(/\/sport\/([a-z0-9_-]+)\//i);
  return {
    eventId: eventMatch[1],
    marketId: marketMatch?.[1] || null,
    sportId: (sportMatch?.[1] || "").includes("tennis") ? 9 : 15,
  };
}

function layToScore(name) {
  const m = String(name || "")
    .trim()
    .match(/^lay\s+(\d+)\s*[x×:-]\s*(\d+)$/i);
  return m ? `${m[1]}-${m[2]}` : null;
}

function bestOdds(runner, side) {
  const prices = (runner.prices || []).filter((p) => p.side === side);
  if (prices.length) {
    if (side === "lay") {
      return prices.reduce((a, b) =>
        a["decimal-odds"] < b["decimal-odds"] ? a : b
      )["decimal-odds"];
    }
    return prices.reduce((a, b) =>
      a["decimal-odds"] > b["decimal-odds"] ? a : b
    )["decimal-odds"];
  }
  const last = runner["last-matched-odds"];
  return typeof last === "number" && last > 1 ? last : null;
}

function extractOdd(event, ref, arbiMarket) {
  const markets = event.markets || [];
  let market = ref.marketId
    ? markets.find((m) => String(m.id) === String(ref.marketId))
    : null;
  if (!market) {
    market =
      markets.find(
        (m) =>
          String(m["market-type"] || "").toLowerCase() === "correct_score" ||
          String(m.name || "")
            .toLowerCase()
            .includes("placar")
      ) || markets[0];
  }
  if (!market) return null;

  const score = layToScore(arbiMarket.name);
  const runners = market.runners || [];
  let runner;
  if (score) {
    runner = runners.find((r) => {
      const n = String(r.name || "").replace(/\s/g, "");
      return n === score || n === score.replace("-", "x");
    });
  } else {
    const token = String(arbiMarket.name || "")
      .replace(/^lay\s+/i, "")
      .trim()
      .toLowerCase();
    runner = runners.find((r) =>
      String(r.name || "")
        .toLowerCase()
        .includes(token)
    );
  }
  if (!runner) return null;

  const prefer =
    String(arbiMarket.market_type || "LAY").toUpperCase() === "BACK"
      ? "back"
      : "lay";
  const odd =
    bestOdds(runner, prefer) ??
    bestOdds(runner, prefer === "lay" ? "back" : "lay");
  if (odd == null || odd <= 1) return null;
  return { odd: Number(Number(odd).toFixed(3)), marketId: String(market.id) };
}

async function main() {
  console.log(
    `==> ArbiShield odds sync  url=${SUPABASE_URL} dryRun=${DRY_RUN}`
  );

  const matches = await sb(
    "/rest/v1/matches?status=eq.open&deleted_at=is.null&select=id,home_team,away_team,protection_odds,markets,metadata&order=starts_at.asc"
  );

  console.log(`open matches: ${matches.length}`);
  const cache = new Map();
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  let errors = 0;

  for (const match of matches) {
    const link = match.metadata?.external_bet_link;
    const ref = parseLink(link);
    const primary = (match.markets || [])[0];
    const label = `${match.home_team} vs ${match.away_team}`;

    if (!ref || !primary) {
      skipped++;
      console.log(`skip  ${label} — ${!ref ? "sem link" : "sem market"}`);
      continue;
    }

    try {
      let event = cache.get(ref.eventId);
      if (!event) {
        event = await fetchEvent(ref.eventId, ref.sportId);
        cache.set(ref.eventId, event);
      }
      const extracted = extractOdd(event, ref, primary);
      if (!extracted) {
        skipped++;
        console.log(`skip  ${label} (${primary.name}) — odd não encontrada`);
        continue;
      }

      const oldOdd = Number(primary.odd);
      const newOdd = extracted.odd;
      if (Math.abs(oldOdd - newOdd) < 0.001) {
        unchanged++;
        console.log(`same  ${label} ${primary.name} @ ${newOdd}`);
        continue;
      }

      const nextMarkets = (match.markets || []).map((m, idx) =>
        idx === 0
          ? { ...m, odd: newOdd, external_id: extracted.marketId }
          : m
      );
      const nextProtection = { home: newOdd, away: newOdd };

      if (!DRY_RUN) {
        await sb(`/rest/v1/matches?id=eq.${match.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            markets: nextMarkets,
            protection_odds: nextProtection,
            updated_at: new Date().toISOString(),
          }),
        });
        try {
          await sb("/rest/v1/match_odds_history", {
            method: "POST",
            body: JSON.stringify({
              match_id: match.id,
              admin_id:
                process.env.ARBISHIELD_SYNC_ADMIN_ID ||
                "9f8fadcb-face-4620-bbd6-e56722695822",
              old_odds: match.protection_odds || {
                home: oldOdd,
                away: oldOdd,
              },
              new_odds: nextProtection,
            }),
          });
        } catch (histErr) {
          console.warn(`  hist warn: ${histErr.message}`);
        }
      }

      updated++;
      console.log(
        `upd   ${label} ${primary.name}: ${oldOdd} → ${newOdd}${DRY_RUN ? " (dry)" : ""}`
      );
    } catch (err) {
      if (err.code === "EMPTY_EVENT") {
        skipped++;
        console.log(`skip  ${label} — ${err.message}`);
      } else {
        errors++;
        console.error(`err   ${label}: ${err.message}`);
      }
    }
  }

  console.log(
    `done updated=${updated} unchanged=${unchanged} skipped=${skipped} errors=${errors}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
