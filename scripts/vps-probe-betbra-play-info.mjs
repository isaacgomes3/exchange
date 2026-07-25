#!/usr/bin/env node
/**
 * Probe dos feeds "play info" BetBra — verifica se existe série de pressão/momentum.
 *
 * Uso na VPS (IP BR):
 *   node scripts/vps-probe-betbra-play-info.mjs
 *   node scripts/vps-probe-betbra-play-info.mjs --eventId 33875328076300023
 *   node scripts/vps-probe-betbra-play-info.mjs --out /tmp/play-info-probe.json
 */
import { writeFileSync } from "node:fs";
import { coerceInplayFeed } from "./lib/betbra-inplay-sync.mjs";
import {
  coerceEventsRadarFeed,
  summarizeEventsRadarFeed,
  resolveMradarForEventId,
} from "./lib/betbra-events-radar.mjs";

const UA = process.env.MEXCHANGE_BOT_USER_AGENT || "BOT/SOFTWARE;Arbitrex;1.0";
const SITE = process.env.EXCHANGE_SITE_ORIGIN || "https://betbra.bet.br";
const REFERER = process.env.MEXCHANGE_REFERER || "https://mexchange.betbra.bet.br/";
const API_BASE =
  process.env.MEXCHANGE_API_BASE || "https://mexchange-api.betbra.bet.br/api";
const SOCCER_ID =
  process.env.FULLTBET_SOCCER_SPORT_ID ||
  process.env.MEXCHANGE_SOCCER_ID ||
  "15";

const INPLAY_URL =
  process.env.MEXCHANGE_INPLAY_FEED_URL ||
  `${SITE.replace(/\/$/, "")}/client/api/jumper/feedSports/inplay-info`;
const RADAR_URL =
  process.env.MEXCHANGE_EVENTS_RADAR_URL ||
  `${SITE.replace(/\/$/, "")}/client/api/jumper/feedSports/inplayInfo/eventsRadar`;

const PRESSURE_RE =
  /momentum|pressure|press[aã]o|attack|pulse|timeline|intensity|possession|grafico|graph|winprob/i;

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

const eventId =
  argValue("--eventId") ||
  argValue("--event") ||
  process.env.PROBE_EVENT_ID ||
  "";
const outPath = argValue("--out");

async function fetchJson(url, extraHeaders = {}) {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Language": "pt-BR,pt;q=0.9",
      "User-Agent": UA,
      Referer: REFERER,
      Cookie: "BIAB_LANGUAGE=PT_BR",
      ...extraHeaders,
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
    preview: text.slice(0, 160),
    json,
  };
}

function collectKeys(value, prefix = "", into = new Map(), depth = 0) {
  if (depth > 4 || value == null) return into;
  if (Array.isArray(value)) {
    if (value.length) collectKeys(value[0], `${prefix}[]`, into, depth + 1);
    return into;
  }
  if (typeof value !== "object") {
    into.set(prefix || "(root)", typeof value);
    return into;
  }
  for (const [k, v] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${k}` : k;
    const t = Array.isArray(v) ? "array" : v == null ? "null" : typeof v;
    into.set(path, t);
    if (v && typeof v === "object") collectKeys(v, path, into, depth + 1);
  }
  return into;
}

function pressureHits(keyMap) {
  return [...keyMap.keys()].filter((k) => PRESSURE_RE.test(k));
}

function summarizeFeed(label, fetched, list) {
  const keyMap = new Map();
  for (const item of list.slice(0, 8)) collectKeys(item, "", keyMap, 0);
  const hits = pressureHits(keyMap);
  const sample = list[0] && typeof list[0] === "object" ? list[0] : null;
  const sampleFlat = sample
    ? Object.fromEntries(
        Object.entries(sample).map(([k, v]) => [
          k,
          v != null && typeof v === "object" ? (Array.isArray(v) ? `array(${v.length})` : "object") : v,
        ])
      )
    : null;
  return {
    label,
    url: fetched.url,
    status: fetched.status,
    blocked: fetched.blocked,
    bytes: fetched.bytes,
    count: list.length,
    topLevelKeys: sample ? Object.keys(sample).sort() : [],
    nestedKeysSample: [...keyMap.entries()]
      .slice(0, 80)
      .map(([key, type]) => ({ key, type })),
    pressureLikeKeys: hits,
    hasPressureGraphData: hits.length > 0,
    sampleFlat,
    previewIfBlocked: fetched.blocked ? fetched.preview : undefined,
  };
}

const inplayFetch = await fetchJson(INPLAY_URL, { Referer: `${SITE}/` });
const radarFetch = await fetchJson(RADAR_URL, { Referer: `${SITE}/` });

const inplayList = inplayFetch.json ? coerceInplayFeed(inplayFetch.json) : [];
const radarList = radarFetch.json
  ? coerceEventsRadarFeed(radarFetch.json)
  : [];

let pickedEventId = String(eventId || "").trim();
if (!pickedEventId && inplayList[0]) {
  pickedEventId = String(
    inplayList[0].eventId || inplayList[0].event_id || inplayList[0].id || ""
  );
}

let eventDetail = null;
if (pickedEventId) {
  const detailUrl = `${API_BASE}/events/${pickedEventId}?sport-id=${SOCCER_ID}`;
  const detailFetch = await fetchJson(detailUrl, {
    Referer: `${REFERER.replace(/\/$/, "")}/exchange/sport/soccer/event/${pickedEventId}`,
    "Accept-Encoding": "identity",
  });
  const detailObj =
    detailFetch.json && typeof detailFetch.json === "object"
      ? detailFetch.json
      : null;
  const detailKeys = new Map();
  if (detailObj) collectKeys(detailObj, "", detailKeys, 0);
  const hits = pressureHits(detailKeys);
  eventDetail = {
    label: "mexchange-api /events/{id}",
    url: detailUrl,
    status: detailFetch.status,
    blocked: detailFetch.blocked,
    bytes: detailFetch.bytes,
    eventId: pickedEventId,
    topLevelKeys: detailObj ? Object.keys(detailObj).sort() : [],
    nestedKeysSample: [...detailKeys.entries()]
      .slice(0, 120)
      .map(([key, type]) => ({ key, type })),
    pressureLikeKeys: hits,
    hasPressureGraphData: hits.length > 0,
    sampleFlat: detailObj
      ? Object.fromEntries(
          Object.entries(detailObj).map(([k, v]) => [
            k,
            v != null && typeof v === "object"
              ? Array.isArray(v)
                ? `array(${v.length})`
                : "object"
              : v,
          ])
        )
      : null,
    previewIfBlocked: detailFetch.blocked ? detailFetch.preview : undefined,
  };
}

const radarSummary = radarFetch.json
  ? summarizeEventsRadarFeed(radarFetch.json)
  : null;
const radarResolved =
  pickedEventId && radarFetch.json
    ? resolveMradarForEventId(pickedEventId, radarFetch.json, SITE)
    : null;

const report = {
  ok: Boolean(inplayFetch.json || radarFetch.json),
  at: new Date().toISOString(),
  site: SITE,
  eventId: pickedEventId || null,
  endpoints: {
    inplayInfo: summarizeFeed("inplay-info", inplayFetch, inplayList),
    eventsRadar: {
      ...summarizeFeed("inplayInfo/eventsRadar", radarFetch, radarList),
      summary: radarSummary
        ? {
            count: radarSummary.count,
            keys: radarSummary.keys,
            withStatsPerform: radarSummary.withStatsPerform,
            withSportRadar: radarSummary.withSportRadar,
          }
        : null,
      resolvedForEvent: radarResolved,
    },
    eventDetail,
  },
  verdict: {
    inplayHasPressureGraph: false,
    eventsRadarHasPressureGraph: false,
    eventDetailHasPressureGraph: false,
    note:
      "O gráfico de pressão da BetBra é o widget Soft2Bet/SportRadar (mradar momentum), não uma série JSON nestes feeds.",
  },
};

report.verdict.inplayHasPressureGraph = Boolean(
  report.endpoints.inplayInfo.pressureLikeKeys.length
);
report.verdict.eventsRadarHasPressureGraph = Boolean(
  report.endpoints.eventsRadar.pressureLikeKeys.length
);
report.verdict.eventDetailHasPressureGraph = Boolean(
  report.endpoints.eventDetail?.pressureLikeKeys?.length
);

const text = JSON.stringify(report, null, 2);
console.log(text);
if (outPath) {
  writeFileSync(outPath, text);
  console.error(`wrote ${outPath}`);
}
process.exit(report.ok ? 0 : 2);
