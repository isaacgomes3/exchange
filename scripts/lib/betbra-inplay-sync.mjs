/**
 * Sync de placar/tempo BetBra (inplay-info) → matches ArbiShield.
 * Lógica pura (testável) + helpers de normalização.
 */

export const BETBRA_INPLAY_SYNC_VERSION = "betbra-inplay-sync-v3";

/**
 * Extrai eventId BetBra de um link de mercado/evento.
 * @param {unknown} url
 * @returns {string}
 */
export function extractBetbraEventIdFromUrl(url) {
  const s = String(url || "").trim();
  if (!s) return "";
  let m = s.match(/[?&#](?:eventId|event_id|eventID|event)=([0-9]{6,})/i);
  if (m) return normalizeEventId(m[1]);
  m = s.match(/\/(?:event|evento|e)\/([0-9]{6,})(?:\/|$|\?|#)/i);
  if (m) return normalizeEventId(m[1]);
  // IDs longos no path (comum em deeplinks BetBra/Mexchange)
  m = s.match(/(?:^|[^\d])([0-9]{12,})(?:[^\d]|$)/);
  if (m) return normalizeEventId(m[1]);
  return "";
}

/**
 * @param {any} step
 * @returns {string}
 */
export function desafioStepEventId(step) {
  if (!step) return "";
  const meta =
    step.metadata && typeof step.metadata === "object" ? step.metadata : {};
  const fromMeta = normalizeEventId(
    meta.betbra_event_id ||
      meta.external_id ||
      meta.event_id ||
      meta.eventId ||
      step.external_id
  );
  if (fromMeta) return fromMeta;
  return extractBetbraEventIdFromUrl(
    step.external_bet_link || meta.external_bet_link || meta.betbra_link
  );
}

/**
 * @param {any} step
 * @param {number} [nowMs]
 */
export function desafioStepEligibleForInplaySync(step, nowMs = Date.now()) {
  if (!step) return false;
  if (step.settled_at) return false;
  const st = String(step.status || "").toLowerCase();
  if (["done", "settled", "closed", "cancelled", "finalizado"].includes(st)) {
    return false;
  }
  const res = String(step.result || "").toLowerCase();
  if (res && res !== "pending" && res !== "null") return false;
  if (!desafioStepEventId(step)) return false;

  const start = step.starts_at ? new Date(step.starts_at).getTime() : NaN;
  if (!Number.isFinite(start)) return true;
  const before = 30 * 60 * 1000;
  const after = 4 * 60 * 60 * 1000;
  if (nowMs < start - before) return false;
  if (nowMs > start + after) {
    const meta =
      step.metadata && typeof step.metadata === "object" ? step.metadata : {};
    if (meta.live && !meta.live.finished) return true;
    return false;
  }
  return true;
}

/**
 * @returns {null|{ patch: Record<string, unknown>, live: Record<string, unknown> }}
 */
export function buildDesafioStepInplayPatch(step, inplayByEventId, nowIso) {
  const ext = desafioStepEventId(step);
  if (!ext) return null;
  const info = inplayByEventId.get(ext);
  if (!info) return null;
  const live = buildLiveMetadata(info, nowIso);
  if (!live) return null;

  const prevMeta =
    step.metadata && typeof step.metadata === "object" ? { ...step.metadata } : {};
  const prev =
    prevMeta.live && typeof prevMeta.live === "object" ? prevMeta.live : {};

  const same =
    String(prev.score || "") === String(live.score || "") &&
    String(prev.elapsed || "") === String(live.elapsed || "") &&
    Boolean(prev.finished) === Boolean(live.finished);
  if (same) return null;

  const patch = {
    metadata: {
      ...prevMeta,
      betbra_event_id: ext,
      score_sync_enabled: true,
      live,
    },
    updated_at: nowIso,
  };
  if (info.homeScore != null) patch.final_score_home = info.homeScore;
  if (info.awayScore != null) patch.final_score_away = info.awayScore;
  if (info.live) patch.status = "live";
  return { patch, live };
}

const FINISHED_RE =
  /^(finished|ended|ft|full[\s_-]?time|complete[d]?|closed|final|resultado\s*final)$/i;
const LIVE_RE =
  /^(in[\s_-]?play|live|1st|2nd|first|second|half|ht|et|extra|pen|break|pause|kick)/i;

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeEventId(raw) {
  if (raw == null) return "";
  return String(raw).trim();
}

/**
 * @param {unknown} raw
 * @returns {number|null}
 */
export function parseScoreSide(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "object" && raw !== null) {
    const nested = raw.score ?? raw.value ?? raw.goals;
    return parseScoreSide(nested);
  }
  const n = Number(String(raw).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function formatElapsedLabel(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/['′]$/.test(s)) return s;
  if (/^\d+(\+\d+)?$/.test(s)) return `${s}'`;
  return s;
}

/**
 * @param {string} status
 * @param {string} [inPlayMatchStatus]
 */
export function isFinishedStatus(status, inPlayMatchStatus) {
  const a = String(status || "").trim();
  const b = String(inPlayMatchStatus || "").trim();
  return FINISHED_RE.test(a) || FINISHED_RE.test(b);
}

/**
 * @param {string} status
 * @param {string} [inPlayMatchStatus]
 */
export function isLiveStatus(status, inPlayMatchStatus) {
  if (isFinishedStatus(status, inPlayMatchStatus)) return false;
  const a = String(status || "").trim();
  const b = String(inPlayMatchStatus || "").trim();
  if (!a && !b) return false;
  return LIVE_RE.test(a) || LIVE_RE.test(b) || Boolean(a || b);
}

/**
 * Normaliza um item do feed inplay-info BetBra.
 * @param {any} item
 * @returns {null|{
 *   eventId: string,
 *   homeScore: number|null,
 *   awayScore: number|null,
 *   scoreLabel: string|null,
 *   elapsed: string,
 *   elapsedLabel: string,
 *   status: string,
 *   inPlayMatchStatus: string,
 *   finished: boolean,
 *   live: boolean,
 * }}
 */
export function normalizeInplayItem(item) {
  if (!item || typeof item !== "object") return null;
  const eventId = normalizeEventId(
    item.eventId ?? item.event_id ?? item.id ?? item.eventID
  );
  if (!eventId) return null;

  const score = item.score && typeof item.score === "object" ? item.score : {};
  const homeScore = parseScoreSide(
    score.home?.score ?? score.home ?? item.homeScore ?? item.home_score
  );
  const awayScore = parseScoreSide(
    score.away?.score ?? score.away ?? item.awayScore ?? item.away_score
  );
  const scoreLabel =
    homeScore != null && awayScore != null ? `${homeScore}-${awayScore}` : null;

  const elapsedRaw =
    item.elapsedRegularTime ??
    item.timeElapsed ??
    item.elapsed ??
    item.minute ??
    "";
  const elapsed = String(elapsedRaw || "").trim();
  const elapsedLabel = formatElapsedLabel(elapsed);

  const status = String(item.status || "").trim();
  const inPlayMatchStatus = String(
    item.inPlayMatchStatus || item.in_play_match_status || ""
  ).trim();
  const finished = isFinishedStatus(status, inPlayMatchStatus);
  const live = !finished && isLiveStatus(status, inPlayMatchStatus);

  return {
    eventId,
    homeScore,
    awayScore,
    scoreLabel,
    elapsed,
    elapsedLabel,
    status,
    inPlayMatchStatus,
    finished,
    live,
  };
}

/**
 * Aceita array puro ou envelopes comuns do feed BetBra/Mexchange.
 * @param {unknown} feed
 * @returns {any[]}
 */
export function coerceInplayFeed(feed) {
  if (Array.isArray(feed)) return feed;
  if (!feed || typeof feed !== "object") return [];
  const obj = /** @type {Record<string, unknown>} */ (feed);
  for (const key of [
    "events",
    "event",
    "data",
    "items",
    "inplay",
    "inPlay",
    "results",
    "payload",
  ]) {
    const v = obj[key];
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object") {
      const nested = coerceInplayFeed(v);
      if (nested.length) return nested;
    }
  }
  // objeto indexado por eventId
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
 * @param {unknown} feed
 * @returns {Map<string, ReturnType<typeof normalizeInplayItem>>}
 */
export function indexInplayFeed(feed) {
  const map = new Map();
  const list = coerceInplayFeed(feed);
  for (const raw of list) {
    const n = normalizeInplayItem(raw);
    if (!n) continue;
    map.set(n.eventId, n);
  }
  return map;
}

/**
 * Monta o bloco metadata.live a partir do item normalizado.
 * (usado por matches e etapas de Desafio)
 * @param {ReturnType<typeof normalizeInplayItem>} info
 * @param {string} [nowIso]
 */
export function buildLiveMetadata(info, nowIso = new Date().toISOString()) {
  if (!info) return null;
  return {
    home_score: info.homeScore,
    away_score: info.awayScore,
    score: info.scoreLabel,
    elapsed: info.elapsed || null,
    elapsed_label: info.elapsedLabel || null,
    match_status: info.inPlayMatchStatus || info.status || null,
    status: info.status || null,
    finished: Boolean(info.finished),
    live: Boolean(info.live),
    updated_at: nowIso,
    source: "betbra_inplay",
  };
}

/**
 * Decide se o match deve ser candidato a sync.
 * @param {any} match
 * @param {number} nowMs
 * @param {{ beforeKickoffMs?: number, afterKickoffMs?: number }} [opts]
 */
export function matchEligibleForInplaySync(match, nowMs = Date.now(), opts = {}) {
  if (!match || match.deleted_at) return false;
  if (match.settled_at || match.final_score) return false;
  const st = String(match.status || match.status_v2 || "").toLowerCase();
  if (["settled", "finished", "closed", "cancelled", "finalizado"].includes(st)) {
    return false;
  }

  const ext = normalizeEventId(match.external_id);
  if (!ext) return false;

  const meta =
    match.metadata && typeof match.metadata === "object" ? match.metadata : {};
  const source = String(meta.source || "").toLowerCase();
  const syncFlag =
    match.score_sync_enabled === true ||
    match.score_sync_enabled === "true" ||
    meta.score_sync_enabled === true;
  const isBetbra =
    source === "betbra_prelive_catalog" ||
    source === "betbra" ||
    Boolean(meta.market_id);

  if (!syncFlag && !isBetbra) return false;

  const start = match.starts_at ? new Date(match.starts_at).getTime() : NaN;
  if (!Number.isFinite(start)) return true; // sem horário: ainda tenta

  const before = opts.beforeKickoffMs ?? 30 * 60 * 1000;
  const after = opts.afterKickoffMs ?? 4 * 60 * 60 * 1000;
  if (nowMs < start - before) return false;
  if (nowMs > start + after) {
    // mantém se já tinha live e não terminou
    if (meta.live && !meta.live.finished) return true;
    return false;
  }
  return true;
}

/**
 * Calcula o patch a aplicar num match a partir do feed indexado.
 * @returns {null|{ patch: Record<string, unknown>, live: Record<string, unknown> }}
 */
export function buildMatchInplayPatch(match, inplayByEventId, nowIso) {
  const ext = normalizeEventId(match?.external_id);
  if (!ext) return null;
  const info = inplayByEventId.get(ext);
  if (!info) return null;

  const live = buildLiveMetadata(info, nowIso);
  if (!live) return null;

  const prevMeta =
    match.metadata && typeof match.metadata === "object" ? match.metadata : {};
  const prevLive =
    prevMeta.live && typeof prevMeta.live === "object" ? prevMeta.live : {};

  // evita writes inúteis
  const same =
    String(prevLive.score || "") === String(live.score || "") &&
    String(prevLive.elapsed || "") === String(live.elapsed || "") &&
    Boolean(prevLive.finished) === Boolean(live.finished) &&
    String(prevLive.match_status || "") === String(live.match_status || "");
  if (same) return null;

  const patch = {
    metadata: {
      ...prevMeta,
      score_sync_enabled: true,
      live,
    },
    updated_at: nowIso,
  };

  if (info.live) {
    patch.status_v2 = "live";
  } else if (info.finished) {
    // não marca settled — settle continua manual; só sinaliza fim no metadata
    patch.status_v2 = String(match.status_v2 || match.status || "open");
  }

  return { patch, live };
}
