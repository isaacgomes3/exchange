/**
 * Sync de placar/tempo BetBra (inplay-info) → matches ArbiShield.
 * Lógica pura (testável) + helpers de normalização.
 */

export const BETBRA_INPLAY_SYNC_VERSION = "betbra-inplay-sync-v8";

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
 * EventId BetBra de um match da Proteção (external_id, metadata ou markets).
 * Muitos jogos publicados só têm o id no link BetBra / mercado — sem isso o sync
 * não grava metadata.live e a grade fica só com "AO VIVO".
 * @param {any} match
 * @returns {string}
 */
export function matchBetbraEventId(match) {
  if (!match) return "";
  const fromCol = normalizeEventId(match.external_id);
  if (fromCol) return fromCol;
  const meta =
    match.metadata && typeof match.metadata === "object" ? match.metadata : {};
  const fromMeta = normalizeEventId(
    meta.betbra_event_id ||
      meta.external_id ||
      meta.event_id ||
      meta.eventId
  );
  if (fromMeta) return fromMeta;
  const fromLink = extractBetbraEventIdFromUrl(
    meta.external_bet_link ||
      meta.betbra_link ||
      meta.external_link ||
      match.external_bet_link
  );
  if (fromLink) return fromLink;
  const markets = Array.isArray(match.markets) ? match.markets : [];
  for (const mk of markets) {
    if (!mk) continue;
    const fromMk = normalizeEventId(
      mk.external_id || mk.event_id || mk.eventId || mk.betbra_event_id
    );
    if (fromMk) return fromMk;
    const fromMkLink = extractBetbraEventIdFromUrl(
      mk.external_bet_link || mk.external_link || mk.betbra_link || mk.url
    );
    if (fromMkLink) return fromMkLink;
  }
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
 * @returns {null|{
 *   patch: Record<string, unknown>,
 *   slimPatch: Record<string, unknown>,
 *   live: Record<string, unknown>
 * }}
 */
export function buildDesafioStepInplayPatch(step, inplayByEventId, nowIso) {
  const ext = desafioStepEventId(step);
  if (!ext) return null;
  const nowMs = nowIso ? Date.parse(nowIso) : Date.now();
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();

  let info = inplayByEventId.get(ext) || null;
  if (info) {
    info = applyFinishedInference(info, step, now);
  } else if (inferMatchFinished(step, null, now)) {
    // Saiu do feed inplay — fecha com último placar conhecido
    const prevMeta0 =
      step.metadata && typeof step.metadata === "object" ? step.metadata : {};
    const prev0 =
      prevMeta0.live && typeof prevMeta0.live === "object" ? prevMeta0.live : {};
    const home =
      step.final_score_home != null
        ? Number(step.final_score_home)
        : prev0.home_score != null
          ? Number(prev0.home_score)
          : null;
    const away =
      step.final_score_away != null
        ? Number(step.final_score_away)
        : prev0.away_score != null
          ? Number(prev0.away_score)
          : null;
    info = {
      eventId: ext,
      homeScore: Number.isFinite(home) ? home : null,
      awayScore: Number.isFinite(away) ? away : null,
      scoreLabel:
        Number.isFinite(home) && Number.isFinite(away)
          ? `${home}-${away}`
          : prev0.score || null,
      elapsed: String(prev0.elapsed || "90"),
      elapsedLabel: String(prev0.elapsed_label || prev0.elapsed || "90'"),
      status: "Finished",
      inPlayMatchStatus: "Finished",
      finished: true,
      live: false,
    };
  }
  if (!info) return null;

  const live = buildLiveMetadata(info, nowIso);
  if (!live) return null;
  if (info.finished) {
    live.finished = true;
    live.live = false;
    live.inferred_finished = true;
  }

  const prevMeta =
    step.metadata && typeof step.metadata === "object" ? { ...step.metadata } : {};
  const prev =
    prevMeta.live && typeof prevMeta.live === "object" ? prevMeta.live : {};

  const prevHome =
    step.final_score_home != null ? Number(step.final_score_home) : null;
  const prevAway =
    step.final_score_away != null ? Number(step.final_score_away) : null;

  const sameMeta =
    String(prev.score || "") === String(live.score || "") &&
    String(prev.elapsed || "") === String(live.elapsed || "") &&
    Boolean(prev.finished) === Boolean(live.finished);
  const sameScores =
    prevHome === (info.homeScore != null ? Number(info.homeScore) : null) &&
    prevAway === (info.awayScore != null ? Number(info.awayScore) : null);
  const finishedChanged = Boolean(prev.finished) !== Boolean(live.finished);
  // Não engolir FT quando o SELECT da etapa não traz metadata
  if (sameScores && sameMeta && !finishedChanged) return null;
  if (
    sameScores &&
    !step.metadata &&
    !finishedChanged &&
    String(prev.elapsed || "") === String(live.elapsed || "")
  ) {
    return null;
  }

  const slimPatch = {
    updated_at: nowIso,
  };
  if (info.homeScore != null) slimPatch.final_score_home = info.homeScore;
  if (info.awayScore != null) slimPatch.final_score_away = info.awayScore;
  if (info.live) slimPatch.status = "live";

  const patch = {
    ...slimPatch,
    metadata: {
      ...prevMeta,
      betbra_event_id: ext,
      score_sync_enabled: true,
      live,
    },
  };
  return { patch, slimPatch, live };
}

const FINISHED_RE =
  /finished|\bended\b|full[\s_-]?time|\bft\b|after[\s_-]?f\.?t\.?|match[\s_-]?finished|match[\s_-]?ended|game[\s_-]?finished|second[\s_-]?half[\s_-]?ended|\bcompleted?\b|\bclosed\b|finalizado|resultado\s*final|abandoned|walkover|\bawarded\b/i;
// Word-boundary em tokens curtos: "pen" não pode casar dentro de "open".
const LIVE_RE =
  /in[\s_-]?play|\blive\b|1st|2nd|first\s*half|second\s*half|\bfirsthalf\b|\bsecondhalf\b|\bhalf\b|\bht\b|\bet\b|\bextra\b|\bpen(?:alty|alties)?\b|\bbreak\b|\bpause\b|\bkick/i;

/**
 * Infere encerramento quando o feed atrasa (ex.: 90' + SecondHalfKickOff)
 * ou o evento some do inplay-info após ter ido ao vivo.
 * @param {any} stepOrMatch
 * @param {ReturnType<typeof normalizeInplayItem>|null|undefined} info
 * @param {number} [nowMs]
 */
export function inferMatchFinished(stepOrMatch, info, nowMs = Date.now()) {
  if (info?.finished) return true;
  const startRaw = stepOrMatch?.starts_at || stepOrMatch?.startsAt;
  const start = startRaw ? new Date(startRaw).getTime() : NaN;
  if (!Number.isFinite(start)) return false;
  const ageMin = (nowMs - start) / 60000;
  if (ageMin < 100) return false;

  const meta =
    stepOrMatch?.metadata && typeof stepOrMatch.metadata === "object"
      ? stepOrMatch.metadata
      : {};
  const prev =
    meta.live && typeof meta.live === "object" ? meta.live : null;

  const elapsedRaw = info?.elapsed || prev?.elapsed || "";
  const elapsedNum = Number(String(elapsedRaw).match(/\d+/)?.[0] || NaN);
  const finalHome =
    stepOrMatch?.final_score_home != null
      ? Number(stepOrMatch.final_score_home)
      : null;
  const finalAway =
    stepOrMatch?.final_score_away != null
      ? Number(stepOrMatch.final_score_away)
      : null;
  const hasScore =
    (info?.homeScore != null && info?.awayScore != null) ||
    (Number.isFinite(finalHome) && Number.isFinite(finalAway)) ||
    (prev &&
      ((prev.home_score != null && prev.away_score != null) || prev.score));

  if (!hasScore) return false;

  // Com placar + ≥105 min do início → FT (não depende do minuto do feed)
  if (ageMin >= 105) return true;

  // Fora do feed, já foi live
  if (!info) {
    if (prev?.finished) return true;
    if (prev?.live || String(stepOrMatch?.status || "").toLowerCase() === "live") {
      return ageMin >= 100;
    }
    return false;
  }

  // Feed preso no 90'+ um pouco antes dos 105'
  if (Number.isFinite(elapsedNum) && elapsedNum >= 90 && ageMin >= 100) {
    return true;
  }
  return false;
}

/**
 * @param {ReturnType<typeof normalizeInplayItem>} info
 * @param {any} stepOrMatch
 * @param {number} [nowMs]
 */
export function applyFinishedInference(info, stepOrMatch, nowMs = Date.now()) {
  if (!info) return null;
  if (info.finished || !inferMatchFinished(stepOrMatch, info, nowMs)) {
    return info;
  }
  return {
    ...info,
    finished: true,
    live: false,
    inPlayMatchStatus: info.inPlayMatchStatus || "Finished",
    status: info.status && !/^in[\s_-]?play$/i.test(info.status)
      ? info.status
      : "Finished",
  };
}

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
    const nested = raw.score ?? raw.value ?? raw.goals ?? raw.total;
    return parseScoreSide(nested);
  }
  const s = String(raw).trim();
  // "0-1" / "0:1" → não é um lado só
  if (/^\d+\s*[-:x×]\s*\d+$/i.test(s)) return null;
  const n = Number(s.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

/**
 * Aceita score em formatos comuns Soft2Bet/Mexchange.
 * @param {any} item
 * @returns {{ home: number|null, away: number|null }}
 */
export function extractScorePair(item) {
  if (!item || typeof item !== "object") return { home: null, away: null };
  const score = item.score && typeof item.score === "object" ? item.score : null;
  let home = parseScoreSide(
    score?.home?.score ??
      score?.home ??
      item.homeScore ??
      item.home_score ??
      item["home-score"] ??
      item.homeGoals ??
      item.home_goals
  );
  let away = parseScoreSide(
    score?.away?.score ??
      score?.away ??
      item.awayScore ??
      item.away_score ??
      item["away-score"] ??
      item.awayGoals ??
      item.away_goals
  );
  if (home != null && away != null) return { home, away };

  const combined =
    item.scoreLabel ??
    item.score_label ??
    item.matchScore ??
    item["match-score"] ??
    (typeof item.score === "string" ? item.score : null) ??
    (typeof score === "string" ? score : null);
  const m = String(combined || "").trim().match(
    /^(\d+)\s*[-:x×]\s*(\d+)$/i
  );
  if (m) {
    home = parseScoreSide(m[1]);
    away = parseScoreSide(m[2]);
  }
  return { home, away };
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
  // NÃO tratar status genérico ("open", "scheduled") como ao vivo —
  // isso gravava metadata.live vazio e travava o sync (same → skip).
  return LIVE_RE.test(a) || LIVE_RE.test(b);
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

  const { home: homeScore, away: awayScore } = extractScorePair(item);
  const scoreLabel =
    homeScore != null && awayScore != null ? `${homeScore}-${awayScore}` : null;

  const elapsedRaw =
    item.elapsedRegularTime ??
    item["elapsed-regular-time"] ??
    item.timeElapsed ??
    item.time_elapsed ??
    item.elapsed ??
    item.minute ??
    item.clock ??
    item.matchTime ??
    item["match-time"] ??
    "";
  const elapsed = String(elapsedRaw || "").trim();
  const elapsedLabel = formatElapsedLabel(elapsed);

  const status = String(item.status || "").trim();
  const inPlayMatchStatus = String(
    item.inPlayMatchStatus ||
      item.in_play_match_status ||
      item["in-play-match-status"] ||
      ""
  ).trim();
  const finished = isFinishedStatus(status, inPlayMatchStatus);
  const flaggedLive = Boolean(
    item["in-running-flag"] ||
      item.inRunning ||
      item.in_running ||
      item.inPlay ||
      item.in_play
  );
  const live =
    !finished &&
    (isLiveStatus(status, inPlayMatchStatus) ||
      (flaggedLive && (scoreLabel != null || Boolean(elapsed))));

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
 * Item útil para gravar no match? Evita stub "AO VIVO" sem placar/minuto.
 * @param {ReturnType<typeof normalizeInplayItem>} info
 */
export function inplayInfoHasDisplayData(info) {
  if (!info) return false;
  if (info.finished) return true;
  if (info.scoreLabel) return true;
  if (info.elapsed) return true;
  return Boolean(info.live);
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

  const ext = matchBetbraEventId(match);
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
    Boolean(meta.market_id) ||
    Boolean(meta.external_bet_link) ||
    Boolean(meta.betbra_link) ||
    Boolean(meta.betbra_event_id) ||
    Boolean(match.external_bet_link);

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
  const ext = matchBetbraEventId(match);
  if (!ext) return null;
  const nowMs = nowIso ? Date.parse(nowIso) : Date.now();
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  let info = inplayByEventId.get(ext) || null;
  if (info) info = applyFinishedInference(info, match, now);
  if (!info) return null;

  const prevMeta =
    match.metadata && typeof match.metadata === "object" ? match.metadata : {};
  const prevLive =
    prevMeta.live && typeof prevMeta.live === "object" ? prevMeta.live : {};
  const prevBrokenStub =
    Boolean(prevLive.live) &&
    !prevLive.score &&
    !prevLive.elapsed &&
    prevLive.home_score == null &&
    prevLive.away_score == null &&
    !prevLive.finished;

  // Não gravar stub "live" sem placar/minuto (status open virava AO VIVO vazio).
  if (!inplayInfoHasDisplayData(info)) {
    if (!prevBrokenStub) return null;
    // Limpa stub ruim anterior
    const patch = {
      metadata: {
        ...prevMeta,
        betbra_event_id: ext,
        score_sync_enabled: true,
        live: null,
      },
      updated_at: nowIso,
    };
    return { patch, live: null };
  }

  const live = buildLiveMetadata(info, nowIso);
  if (!live) return null;
  if (info.finished) {
    live.finished = true;
    live.live = false;
    live.inferred_finished = true;
  }

  const hadExternal = Boolean(normalizeEventId(match.external_id));
  const hadBetbraMeta = Boolean(normalizeEventId(prevMeta.betbra_event_id));

  // evita writes inúteis — mas nunca engolir stub quebrado
  const same =
    !prevBrokenStub &&
    String(prevLive.score || "") === String(live.score || "") &&
    String(prevLive.elapsed || "") === String(live.elapsed || "") &&
    Boolean(prevLive.finished) === Boolean(live.finished) &&
    Boolean(prevLive.live) === Boolean(live.live) &&
    String(prevLive.match_status || "") === String(live.match_status || "") &&
    hadExternal &&
    hadBetbraMeta;
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
  if (!hadExternal) {
    patch.external_id = ext;
  }

  if (info.live) {
    patch.status_v2 = "live";
  } else if (info.finished) {
    // não marca settled — settle continua manual; só sinaliza fim no metadata
    patch.status_v2 = String(match.status_v2 || match.status || "open");
  }

  return { patch, live };
}
