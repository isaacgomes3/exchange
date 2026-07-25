/**
 * Sync de placar/tempo BetBra (inplay-info) → matches ArbiShield.
 * Lógica pura (testável) + helpers de normalização.
 */

export const BETBRA_INPLAY_SYNC_VERSION = "betbra-inplay-sync-v1";

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
 * @param {any[]} feed
 * @returns {Map<string, ReturnType<typeof normalizeInplayItem>>}
 */
export function indexInplayFeed(feed) {
  const map = new Map();
  const list = Array.isArray(feed) ? feed : [];
  for (const raw of list) {
    const n = normalizeInplayItem(raw);
    if (!n) continue;
    map.set(n.eventId, n);
  }
  return map;
}

/**
 * Monta o bloco metadata.live a partir do item normalizado.
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
