#!/usr/bin/env node
/**
 * Probe (VPS/BR) do feed de movimento/radar BetBra.
 *
 * Uso:
 *   node scripts/vps-probe-betbra-events-radar.mjs
 *   node scripts/vps-probe-betbra-events-radar.mjs --out /tmp/events-radar.json
 */
import { writeFileSync } from "node:fs";
import {
  DEFAULT_EVENTS_RADAR_URL,
  DEFAULT_MRADAR_WIDGET_URL,
  summarizeEventsRadarFeed,
  buildMradarWidgetUrl,
  eventsRadarUrlForSite,
  BETBRA_EVENTS_RADAR_VERSION,
} from "./lib/betbra-events-radar.mjs";

const UA = process.env.MEXCHANGE_BOT_USER_AGENT || "BOT/SOFTWARE;Arbitrex;1.0";
const SITE = process.env.EXCHANGE_SITE_ORIGIN || "https://betbra.bet.br";
const REFERER = process.env.MEXCHANGE_REFERER || "https://mexchange.betbra.bet.br/";
const INPLAY_URL =
  process.env.MEXCHANGE_INPLAY_FEED_URL ||
  "https://betbra.bet.br/client/api/jumper/feedSports/inplay-info";
// Aceita SITE bolsadeaposta/betbra/fulltbet
const RADAR_URL =
  process.env.MEXCHANGE_EVENTS_RADAR_URL || eventsRadarUrlForSite(SITE) || DEFAULT_EVENTS_RADAR_URL;

const outIdx = process.argv.indexOf("--out");
const outPath = outIdx >= 0 ? process.argv[outIdx + 1] : null;

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Language": "pt-BR,pt;q=0.9",
      "User-Agent": UA,
      Referer: REFERER,
      Cookie: "BIAB_LANGUAGE=PT_BR",
    },
  });
  const text = await res.text();
  const blocked =
    res.status === 302 ||
    /countryblock/i.test(res.url || "") ||
    text.trim().startsWith("<!");
  let json = null;
  if (!blocked) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return {
    url,
    status: res.status,
    finalUrl: res.url,
    blocked,
    bytes: text.length,
    preview: text.slice(0, 180),
    json,
  };
}

function summarizeInplay(feed) {
  const list = Array.isArray(feed)
    ? feed
    : Array.isArray(feed?.events)
      ? feed.events
      : Array.isArray(feed?.data)
        ? feed.data
        : [];
  const sample = list[0] && typeof list[0] === "object" ? list[0] : null;
  return {
    count: list.length,
    sampleKeys: sample ? Object.keys(sample).sort() : [],
    sample: sample
      ? {
          eventId: sample.eventId ?? sample.event_id ?? sample.id ?? null,
          status: sample.status ?? null,
          inPlayMatchStatus: sample.inPlayMatchStatus ?? null,
          elapsedRegularTime: sample.elapsedRegularTime ?? sample.timeElapsed ?? null,
          score: sample.score ?? null,
        }
      : null,
  };
}

const radar = await fetchJson(RADAR_URL);
const inplay = await fetchJson(INPLAY_URL);

const radarSummary = radar.json
  ? summarizeEventsRadarFeed(radar.json)
  : { error: "sem json", blocked: radar.blocked, status: radar.status };

const firstSp =
  radarSummary.sample?.[0]?.eventIdStatsPerform ||
  radarSummary.sample?.[0]?.raw?.eventIdStatsPerform ||
  null;

const report = {
  ok: Boolean(radar.json) && !radar.blocked,
  version: BETBRA_EVENTS_RADAR_VERSION,
  at: new Date().toISOString(),
  site: SITE,
  endpoints: {
    eventsRadar: RADAR_URL,
    inplayInfo: INPLAY_URL,
    mradarWidget: DEFAULT_MRADAR_WIDGET_URL,
    mradarExample: buildMradarWidgetUrl(firstSp),
  },
  radarFetch: {
    status: radar.status,
    blocked: radar.blocked,
    bytes: radar.bytes,
    finalUrl: radar.finalUrl,
    preview: radar.blocked ? radar.preview : undefined,
  },
  radar: radarSummary,
  inplayFetch: {
    status: inplay.status,
    blocked: inplay.blocked,
    bytes: inplay.bytes,
  },
  inplay: inplay.json ? summarizeInplay(inplay.json) : { error: "sem json" },
  notes: [
    "eventsRadar mapeia eventIdMbook (exchange) → eventIdStatsPerform (Opta/Stats Perform).",
    "O campo 2D / momentum da FulltBet é o widget /widget/mradar (não o /api/events).",
    "Coordenadas/momentum brutos ficam no widget Stats Perform; este feed é o índice.",
  ],
};

const text = JSON.stringify(report, null, 2);
console.log(text);
if (outPath) {
  writeFileSync(outPath, text);
  console.error(`wrote ${outPath}`);
}
process.exit(report.ok ? 0 : 2);
