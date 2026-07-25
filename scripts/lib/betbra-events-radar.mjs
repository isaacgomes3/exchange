/**
 * Feed BetBra/Soft2Bet "eventsRadar" — mapa exchange → Stats Perform / mradar.
 *
 *   GET {brand}/client/api/jumper/feedSports/inplayInfo/eventsRadar
 *   Widget: https://{brand}/widget/mradar?id={eventIdStatsPerform}
 */

export const BETBRA_EVENTS_RADAR_VERSION = "betbra-events-radar-v2";

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
  if (!eventIdMbook && !eventIdStatsPerform) return null;
  return {
    eventIdMbook: eventIdMbook || null,
    eventIdStatsPerform: eventIdStatsPerform || null,
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
    sample,
  };
}

/**
 * @param {string|null|undefined} statsPerformEventId
 * @param {string} [widgetBase]
 */
export function buildMradarWidgetUrl(
  statsPerformEventId,
  widgetBase = DEFAULT_MRADAR_WIDGET_URL
) {
  const id = String(statsPerformEventId || "").trim();
  if (!id) return null;
  const base = String(widgetBase || DEFAULT_MRADAR_WIDGET_URL).replace(
    /\/$/,
    ""
  );
  return `${base}?id=${encodeURIComponent(id)}`;
}

/**
 * @param {string} eventIdMbook
 * @param {unknown} feed
 * @param {unknown} [siteOrUrl]
 */
export function resolveMradarForEventId(eventIdMbook, feed, siteOrUrl) {
  const id = String(eventIdMbook || "").trim();
  if (!id) {
    return {
      found: false,
      eventIdMbook: null,
      eventIdStatsPerform: null,
      mradarUrl: null,
      host: resolveSoft2BetHost(siteOrUrl),
    };
  }
  const hit = indexEventsRadarByMbook(feed).get(id) || null;
  const sp = hit?.eventIdStatsPerform || null;
  const base = mradarWidgetBaseForSite(siteOrUrl);
  return {
    found: Boolean(sp),
    eventIdMbook: id,
    eventIdStatsPerform: sp,
    mradarUrl: buildMradarWidgetUrl(sp, base),
    host: resolveSoft2BetHost(siteOrUrl),
    keys: hit?.rawKeys || [],
  };
}
