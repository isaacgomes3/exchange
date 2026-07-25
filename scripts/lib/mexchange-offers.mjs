/**
 * Helpers Mexchange (BetBra exchange) — descobertos no frontend Next.js:
 *   POST   /api/offers   body { odds-type, exchange-type, offers:[{runner-id,event-id,market-id,side,odds,stake,keep-in-play}] }
 *   DELETE /api/offers?offer-ids=...
 *   GET    /api/offers?offset=0&per-page=200
 *   GET    /api/events/{id}?sport-id=15
 *   GET    /api/account/info
 * Auth: cookies (withCredentials) no domínio mexchange-api.*.bet.br
 */

import {
  cookieHeaderFromJar,
  mergeCookieJars,
} from "./betbra-client-api.mjs";

function envStr(name, fallback = "") {
  const v = process.env[name];
  if (v == null || String(v).trim() === "") return fallback;
  return String(v).trim();
}

export function resolveMexchangeApiBase() {
  return envStr(
    "MEXCHANGE_ORDERS_API_BASE",
    envStr(
      "EXCHANGE_ORDERS_BASE_URL",
      envStr("MEXCHANGE_API_BASE_URL", "https://mexchange-api.betbra.bet.br/api")
    )
  ).replace(/\/$/, "");
}

/** side da API Mexchange: "back" | "lay" (minúsculo). */
export function toMexchangeSide(side) {
  const s = String(side || "")
    .toLowerCase()
    .trim();
  if (s === "back" || s === "lay") return s;
  return "";
}

/**
 * Mexchange `stake` no POST /offers = tamanho casado (size).
 * - BACK: usuário informa stake → envia stake
 * - LAY: usuário informa responsabilidade (liability) → stake = liability / (odds - 1)
 *   (igual calculateStake do frontend Mexchange)
 */
export function amountToMexchangeStake({ side, odd, stakeCents, liabilityCents } = {}) {
  const s = toMexchangeSide(side);
  const odds = Number(odd);
  if (!(odds > 1.01)) {
    const err = new Error("odd inválida para converter stake");
    err.status = 400;
    err.code = "INVALID_ODD";
    throw err;
  }
  if (s === "lay") {
    const liabCents =
      liabilityCents != null && Number(liabilityCents) > 0
        ? Math.floor(Number(liabilityCents))
        : Math.floor(Number(stakeCents || 0)); // stakeCents = responsabilidade no LAY
    if (!(liabCents > 0)) {
      const err = new Error("responsabilidade (LAY) inválida");
      err.status = 400;
      err.code = "INVALID_LIABILITY";
      throw err;
    }
    const liabilityBrl = liabCents / 100;
    const stakeBrl = liabilityBrl / (odds - 1);
    return {
      side: s,
      stakeBrl,
      liabilityBrl,
      stakeCents: Math.round(stakeBrl * 100),
      liabilityCents: liabCents,
    };
  }
  // BACK: stakeCents = stake
  const stakeC = Math.floor(Number(stakeCents || 0));
  if (!(stakeC > 0)) {
    const err = new Error("stake (BACK) inválido");
    err.status = 400;
    err.code = "INVALID_STAKE";
    throw err;
  }
  const stakeBrl = stakeC / 100;
  return {
    side: s,
    stakeBrl,
    liabilityBrl: stakeBrl, // risco = stake no back
    stakeCents: stakeC,
    liabilityCents: stakeC,
  };
}

/**
 * Body real de POST /offers (frontend submitOffersFromBetSlip).
 */
export function buildMexchangeOffersBody(payload = {}) {
  const conv = amountToMexchangeStake(payload);
  const offer = {
    "runner-id": String(payload.selectionId || payload.runnerId || ""),
    "event-id": String(payload.eventId || ""),
    "market-id": String(payload.marketId || ""),
    side: conv.side,
    odds: Number(payload.odd),
    stake: Number(conv.stakeBrl.toFixed(4)),
    "keep-in-play": payload.keepInPlay === true,
  };
  const body = {
    "odds-type": "DECIMAL",
    "exchange-type": "back-lay",
    offers: [offer],
  };
  if (payload.clientOrderId) {
    body["customer-ref"] = String(payload.clientOrderId);
  }
  return body;
}

export function sessionCookieHeader(session = {}) {
  if (session.cookieHeader) return String(session.cookieHeader);
  if (session.cookies && typeof session.cookies === "object") {
    return cookieHeaderFromJar(session.cookies);
  }
  return "";
}

export function buildMexchangeAuthHeaders(session = {}) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "Accept-Language": "pt-BR,pt;q=0.9",
    Origin: envStr("BETBRA_ORIGIN", "https://betbra.bet.br"),
    Referer: envStr(
      "MEXCHANGE_REFERER",
      "https://mexchange.betbra.bet.br/"
    ),
    "User-Agent": envStr(
      "MEXCHANGE_USER_AGENT",
      "Mozilla/5.0 (compatible; ArbiShieldOrders/1.0)"
    ),
  };
  const jarHeader = sessionCookieHeader(session);
  const lang = envStr("MEXCHANGE_BIAB_LANGUAGE", "PT_BR");
  if (jarHeader) {
    headers.Cookie = jarHeader.includes("BIAB_LANGUAGE=")
      ? jarHeader
      : `BIAB_LANGUAGE=${lang}; ${jarHeader}`;
  } else {
    headers.Cookie = `BIAB_LANGUAGE=${lang}`;
  }
  const token = String(
    session.houseToken ||
      session.accessToken ||
      session.sessionToken ||
      ""
  ).trim();
  // ignora placeholder "cred:..." — não é JWT de exchange
  if (token && !token.startsWith("cred:")) {
    headers.Authorization = `Bearer ${token}`;
  }
  return { ...headers, ...(session.extraHeaders || {}) };
}

export function hasTradingSession(session = {}) {
  if (sessionCookieHeader(session)) return true;
  const token = String(
    session.houseToken || session.accessToken || session.sessionToken || ""
  ).trim();
  if (!token) return false;
  if (token.startsWith("cred:")) return false;
  if (token === "browser-session" || token === "demo") return false;
  return true;
}

export function extractOfferId(data, fallback = "") {
  const first =
    (Array.isArray(data?.offers) && data.offers[0]) ||
    data?.offer ||
    data?.data?.offers?.[0] ||
    null;
  return String(
    first?.id ||
      first?.offerId ||
      first?.["offer-id"] ||
      data?.id ||
      data?.orderId ||
      fallback ||
      ""
  );
}

export function extractOfferStatus(data, fallback = "pending") {
  const first =
    (Array.isArray(data?.offers) && data.offers[0]) ||
    data?.offer ||
    null;
  return String(
    first?.status || data?.status || fallback || "pending"
  ).toLowerCase();
}

function normalizeScoreline(s) {
  const m = String(s || "")
    .trim()
    .match(/(\d+)\s*[x×:\-]\s*(\d+)/i);
  if (!m) return "";
  return `${m[1]}-${m[2]}`;
}

/**
 * Resolve runner-id do placar exato (ex. 3-3) no market do evento.
 */
export async function resolveExactScoreRunner({
  eventId,
  marketId,
  scoreline,
  sportId = 15,
  session = {},
} = {}) {
  const want = normalizeScoreline(scoreline);
  if (!want) {
    const err = new Error("scoreline inválido (use ex. 3-3)");
    err.status = 400;
    err.code = "INVALID_SCORELINE";
    throw err;
  }
  const base = resolveMexchangeApiBase();
  const url = `${base}/events/${encodeURIComponent(eventId)}?sport-id=${encodeURIComponent(sportId)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: buildMexchangeAuthHeaders(session),
    redirect: "manual",
  });
  const text = await res.text();
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location") || "";
    const err = new Error(
      /countryblock/i.test(loc)
        ? "Mexchange countryblock — rode na VPS (IP BR)"
        : `Redirect ao ler evento: ${loc.slice(0, 80)}`
    );
    err.status = 403;
    err.code = "MEXCHANGE_REDIRECT";
    throw err;
  }
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = new Error(
      (data && (data.message || data.error)) ||
        `Evento Mexchange HTTP ${res.status}`
    );
    err.status = res.status;
    err.code = "MEXCHANGE_EVENT_FAILED";
    throw err;
  }
  const markets = data?.markets || data?.event?.markets || [];
  const market =
    markets.find((m) => String(m.id || m["market-id"]) === String(marketId)) ||
    null;
  if (!market) {
    const err = new Error(
      `Mercado ${marketId} não encontrado no evento ${eventId}`
    );
    err.status = 404;
    err.code = "MARKET_NOT_FOUND";
    throw err;
  }
  const runners = market.runners || market.selections || [];
  const hit = runners.find((r) => {
    const name = String(r.name || r["runner-name"] || r.selectionName || "");
    return normalizeScoreline(name) === want;
  });
  if (!hit) {
    const sample = runners
      .slice(0, 8)
      .map((r) => r.name || r["runner-name"])
      .filter(Boolean)
      .join(", ");
    const err = new Error(
      `Runner ${want} não encontrado` + (sample ? ` (ex.: ${sample})` : "")
    );
    err.status = 404;
    err.code = "RUNNER_NOT_FOUND";
    throw err;
  }
  return {
    selectionId: String(hit.id || hit["runner-id"] || hit.selectionId),
    runnerName: hit.name || hit["runner-name"] || want,
    marketId: String(market.id || marketId),
    eventId: String(eventId),
    scoreline: want,
  };
}

export function mergeSessionCookies(session, jar) {
  const merged = mergeCookieJars(session?.cookies || {}, jar || {});
  return {
    ...session,
    cookies: merged,
    cookieHeader: cookieHeaderFromJar(merged) || session?.cookieHeader || null,
  };
}
