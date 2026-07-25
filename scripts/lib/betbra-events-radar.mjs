/**
 * Feed BetBra/Soft2Bet "eventsRadar" — mapa exchange → Stats Perform / mradar.
 *
 *   GET {brand}/client/api/jumper/feedSports/inplayInfo/eventsRadar
 *   Widget: https://{brand}/widget/mradar?id={eventIdStatsPerform}
 */

export const BETBRA_EVENTS_RADAR_VERSION = "betbra-events-radar-v3";

export const KNOWN_SOFT2BET_HOSTS = [
  "betbra.bet.br",
  "bolsadeaposta.bet.br",
  "fulltbet.bet.br",
  "betespecial.bet.br",
  "matchbook.bet.br",
];

export const DEFAULT_SITE_HOST =
  process.env.EXCHANGE_SITE_HOST ||
  (process.env.EXCHANGE_SITE_ORIGIN || "https://betbra.bet.br")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "") ||
  "betbra.bet.br";

export const DEFAULT_EVENTS_RADAR_URL =
  process.env.MEXCHANGE_EVENTS_RADAR_URL ||
  `https://${DEFAULT_SITE_HOST}/client/api/jumper/feedSports/inplayInfo/eventsRadar`;

export const DEFAULT_MRADAR_WIDGET_URL =
  process.env.MEXCHANGE_MRADAR_WIDGET_URL ||
  `https://${DEFAULT_SITE_HOST}/widget/mradar`;

/**
 * @param {unknown} siteOrUrl
 * @returns {string} hostname sem protocolo
 */
export function resolveSoft2BetHost(siteOrUrl) {
  const raw = String(siteOrUrl || "").trim();
  if (!raw) return DEFAULT_SITE_HOST;
  let host = raw;
  try {
    if (/^https?:\/\//i.test(raw)) host = new URL(raw).hostname;
    else host = raw.replace(/^\/\//, "").split("/")[0];
  } catch {
    host = raw.replace(/^https?:\/\//i, "").split("/")[0];
  }
  host = String(host || "")
    .toLowerCase()
    .replace(/^www\./, "");
  if (KNOWN_SOFT2BET_HOSTS.includes(host)) return host;
  // subdomínio mexchange.* → apex brand
  for (const h of KNOWN_SOFT2BET_HOSTS) {
    if (host === h || host.endsWith("." + h) || host.includes(h.split(".")[0])) {
      return h;
    }
  }
  return DEFAULT_SITE_HOST;
}

/**
 * @param {unknown} siteOrUrl
 */
export function eventsRadarUrlForSite(siteOrUrl) {
  const host = resolveSoft2BetHost(siteOrUrl);
  return `https://${host}/client/api/jumper/feedSports/inplayInfo/eventsRadar`;
}

/**
 * @param {unknown} siteOrUrl
 */
export function mradarWidgetBaseForSite(siteOrUrl) {
  const host = resolveSoft2BetHost(siteOrUrl);
  return `https://${host}/widget/mradar`;
}

/**
 * @param {unknown} feed
 * @returns {any[]}
 */
export function coerceEventsRadarFeed(feed) {
  if (Array.isArray(feed)) return feed;
  if (!feed || typeof feed !== "object") return [];
  const obj = /** @type {Record<string, unknown>} */ (feed);
  for (const key of ["events", "data", "items", "results", "payload", "radar"]) {
    const v = obj[key];
    if (Array.isArray(v)) return v;
  }
  const values = Object.values(obj);
  if (
    values.length &&
    values.every((v) => v && typeof v === "object" && !Array.isArray(v))
  ) {
    return values;
  }
  return [];
}

/**
 * Normaliza URN Sportradar para matchId do LMT.
 * Feed Soft2Bet usa `sr:sport_event:N`; widgets costumam `sr:match:N`.
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeSportRadarMatchId(value) {
  const s = String(value || "").trim();
  if (!s) return null;
  const m = s.match(/sr:(?:sport_event|match):(\d+)/i);
  if (m) return `sr:match:${m[1]}`;
  if (/^\d+$/.test(s)) return `sr:match:${s}`;
  return s;
}

/**
 * @param {any} item
 */
export function normalizeEventsRadarItem(item) {
  if (!item || typeof item !== "object") return null;
  const eventIdMbook = String(
    item.eventIdMbook ?? item.event_id_mbook ?? item.eventId ?? item.id ?? ""
  ).trim();
  const eventIdStatsPerform = String(
    item.eventIdStatsPerform ??
      item.event_id_stats_perform ??
      item.statsPerformEventId ??
      item.stats_perform_event_id ??
      ""
  ).trim();
  const eventIdSportRadarRaw = String(
    item.eventIdSportRadar ??
      item.event_id_sport_radar ??
      item.sportRadarEventId ??
      item.sport_radar_event_id ??
      ""
  ).trim();
  const eventIdSportRadar = normalizeSportRadarMatchId(eventIdSportRadarRaw);
  if (!eventIdMbook && !eventIdStatsPerform && !eventIdSportRadar) return null;
  return {
    eventIdMbook: eventIdMbook || null,
    eventIdStatsPerform: eventIdStatsPerform || null,
    eventIdSportRadar: eventIdSportRadar || null,
    eventIdSportRadarRaw: eventIdSportRadarRaw || null,
    rawKeys: Object.keys(item).sort(),
    raw: item,
  };
}

/**
 * @param {unknown} feed
 * @returns {Map<string, ReturnType<typeof normalizeEventsRadarItem>>}
 */
export function indexEventsRadarByMbook(feed) {
  const map = new Map();
  for (const raw of coerceEventsRadarFeed(feed)) {
    const n = normalizeEventsRadarItem(raw);
    if (!n?.eventIdMbook) continue;
    map.set(String(n.eventIdMbook), n);
  }
  return map;
}

/**
 * @param {unknown} feed
 */
export function summarizeEventsRadarFeed(feed) {
  const list = coerceEventsRadarFeed(feed);
  const items = [];
  const keyFreq = new Map();
  for (const raw of list) {
    const n = normalizeEventsRadarItem(raw);
    if (!n) continue;
    for (const k of n.rawKeys) {
      keyFreq.set(k, (keyFreq.get(k) || 0) + 1);
    }
    items.push(n);
  }
  const sample = items.slice(0, 5).map((it) => ({
    eventIdMbook: it.eventIdMbook,
    eventIdStatsPerform: it.eventIdStatsPerform,
    eventIdSportRadar: it.eventIdSportRadar,
    keys: it.rawKeys,
    raw: it.raw,
  }));
  return {
    version: BETBRA_EVENTS_RADAR_VERSION,
    count: items.length,
    keys: [...keyFreq.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([key, count]) => ({ key, count })),
    withStatsPerform: items.filter((i) => i.eventIdStatsPerform).length,
    withSportRadar: items.filter((i) => i.eventIdSportRadar).length,
    sample,
  };
}

/**
 * @param {string|null|undefined} widgetId
 * @param {string} [widgetBase]
 * @param {Record<string, string>} [extraParams]
 */
export function buildMradarWidgetUrl(
  widgetId,
  widgetBase = DEFAULT_MRADAR_WIDGET_URL,
  extraParams = {}
) {
  const id = String(widgetId || "").trim();
  if (!id) return null;
  const base = String(widgetBase || DEFAULT_MRADAR_WIDGET_URL).replace(
    /\/$/,
    ""
  );
  const params = new URLSearchParams({ id });
  for (const [k, v] of Object.entries(extraParams || {})) {
    if (v != null && String(v).trim() !== "") params.set(k, String(v));
  }
  return `${base}?${params.toString()}`;
}

/**
 * Escolhe o melhor id para o widget mradar.
 * Soft2Bet: livestream usa StatsPerform; radar/LMT usa SportRadar na maioria dos jogos.
 * @param {{ eventIdStatsPerform?: string|null, eventIdSportRadar?: string|null, eventIdMbook?: string|null }} hit
 */
export function pickMradarWidgetId(hit) {
  if (!hit) return { id: null, source: null };
  if (hit.eventIdStatsPerform) {
    return { id: String(hit.eventIdStatsPerform), source: "statsPerform" };
  }
  if (hit.eventIdSportRadar) {
    // Soft2Bet /widget/mradar costuma receber id numérico (igual livestream StatsPerform)
    const num = String(hit.eventIdSportRadar).match(/(\d+)$/);
    if (num) return { id: num[1], source: "sportRadar" };
    return { id: String(hit.eventIdSportRadar), source: "sportRadar" };
  }
  if (hit.eventIdMbook) {
    return { id: String(hit.eventIdMbook), source: "mbook" };
  }
  return { id: null, source: null };
}

/**
 * @param {string} eventIdMbook
 * @param {unknown} feed
 * @param {unknown} [siteOrUrl]
 */
export function resolveMradarForEventId(eventIdMbook, feed, siteOrUrl) {
  const id = String(eventIdMbook || "").trim();
  const host = resolveSoft2BetHost(siteOrUrl);
  const base = mradarWidgetBaseForSite(host);
  if (!id) {
    return {
      found: false,
      eventIdMbook: null,
      eventIdStatsPerform: null,
      eventIdSportRadar: null,
      widgetId: null,
      widgetIdSource: null,
      mradarUrl: null,
      mradarUrlCandidates: [],
      host,
    };
  }
  const hit = indexEventsRadarByMbook(feed).get(id) || null;
  const sp = hit?.eventIdStatsPerform || null;
  const sr = hit?.eventIdSportRadar || null;
  const picked = pickMradarWidgetId(
    hit || { eventIdMbook: id, eventIdStatsPerform: null, eventIdSportRadar: null }
  );

  /** @type {string[]} */
  const candidates = [];
  const push = (url) => {
    if (url && !candidates.includes(url)) candidates.push(url);
  };
  // Ordem: StatsPerform → numérico SR → URN match → sport_event raw → mbook
  push(buildMradarWidgetUrl(sp, base));
  const srNum = sr && String(sr).match(/(\d+)$/);
  if (srNum) push(buildMradarWidgetUrl(srNum[1], base));
  push(buildMradarWidgetUrl(sr, base));
  if (hit?.eventIdSportRadarRaw && hit.eventIdSportRadarRaw !== sr) {
    push(buildMradarWidgetUrl(hit.eventIdSportRadarRaw, base));
  }
  if (sr) push(`${base}?matchId=${encodeURIComponent(sr)}`);
  push(buildMradarWidgetUrl(id, base));
  push(`${base}?eventId=${encodeURIComponent(id)}`);

  const mradarUrl = picked.id
    ? buildMradarWidgetUrl(picked.id, base)
    : candidates[0] || null;

  return {
    found: Boolean(hit && (sp || sr)),
    eventIdMbook: id,
    eventIdStatsPerform: sp,
    eventIdSportRadar: sr,
    widgetId: picked.id,
    widgetIdSource: picked.source,
    mradarUrl,
    mradarUrlCandidates: candidates.filter(Boolean),
    host,
    keys: hit?.rawKeys || [],
  };
}
