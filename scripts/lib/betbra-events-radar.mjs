/**
 * Descoberta / normalização do feed BetBra "eventsRadar"
 * (mapa evento exchange → Stats Perform / radar de movimento).
 *
 * Fonte (JS mexchange):
 *   GET {brand}/client/api/jumper/feedSports/inplayInfo/eventsRadar
 * Widget:
 *   https://{brand}/widget/mradar
 * Livestream (mesmo id Stats Perform):
 *   https://{brand}/widget/livestream?id={eventIdStatsPerform}
 */

export const BETBRA_EVENTS_RADAR_VERSION = "betbra-events-radar-v1";

export const DEFAULT_EVENTS_RADAR_URL =
  process.env.MEXCHANGE_EVENTS_RADAR_URL ||
  "https://betbra.bet.br/client/api/jumper/feedSports/inplayInfo/eventsRadar";

export const DEFAULT_MRADAR_WIDGET_URL =
  process.env.MEXCHANGE_MRADAR_WIDGET_URL ||
  "https://betbra.bet.br/widget/mradar";

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
  const base = String(widgetBase || DEFAULT_MRADAR_WIDGET_URL).replace(/\/$/, "");
  // Mesmo padrão do livestream Soft2Bet: ?id={statsPerformEventId}
  return `${base}?id=${encodeURIComponent(id)}`;
}
