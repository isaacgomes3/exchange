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
function asApiId(v) {
  const s = String(v ?? "").trim();
  if (/^\d+$/.test(s)) {
    // IDs Mexchange cabem em number seguro até ~15–16 dígitos; senão mantém string
    const n = Number(s);
    if (Number.isSafeInteger(n)) return n;
  }
  return s;
}

export function buildMexchangeOffersBody(payload = {}) {
  const conv = amountToMexchangeStake(payload);
  const offer = {
    "runner-id": asApiId(payload.selectionId || payload.runnerId || ""),
    "event-id": asApiId(payload.eventId || ""),
    "market-id": asApiId(payload.marketId || ""),
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

/**
 * Mantém só cookies úteis à exchange (remove analytics / cf_clearance preso ao IP do Chrome).
 */
export function sanitizeTradingCookieHeader(cookieHeader = "") {
  const raw = String(cookieHeader || "").trim();
  if (!raw) return "";
  const allow =
    /^(BIAB_|sb$|SESSION$|C_U_I$|affid$|currency$)/i;
  const parts = [];
  for (const part of raw.split(";")) {
    const p = part.trim();
    if (!p) continue;
    const name = p.split("=")[0].trim();
    if (!name) continue;
    // remove Cloudflare clearance do IP do usuário (quebra na VPS)
    if (/^cf_clearance$/i.test(name)) continue;
    if (/^(_ga|_gid|_fbp|_ttp|_cl|_sp|_gtm|ttcsid|FPID|FPLC)/i.test(name))
      continue;
    if (
      allow.test(name) ||
      /^BIAB_/i.test(name) ||
      /^sb$/i.test(name) ||
      /^SESSION$/i.test(name) ||
      /^C_U_I$/i.test(name) ||
      /^affid$/i.test(name)
    ) {
      parts.push(p);
    }
  }
  // garante idioma
  if (!parts.some((p) => /^BIAB_LANGUAGE=/i.test(p))) {
    parts.unshift("BIAB_LANGUAGE=PT_BR");
  }
  return parts.join("; ");
}

export function sessionCookieHeader(session = {}) {
  const raw = session.cookieHeader
    ? String(session.cookieHeader)
    : session.cookies && typeof session.cookies === "object"
      ? cookieHeaderFromJar(session.cookies)
      : "";
  return sanitizeTradingCookieHeader(raw);
}

/** Cookie de auth Soft2Bet/Mexchange (SESSION ou JWT sb / BIAB_CUSTOMER). */
export function cookieLooksAuthed(cookieHeader = "") {
  const c = String(cookieHeader || "");
  return (
    /(?:^|;\s*)SESSION=/i.test(c) ||
    /(?:^|;\s*)sb=/i.test(c) ||
    /(?:^|;\s*)BIAB_CUSTOMER=/i.test(c)
  );
}

export function buildMexchangeAuthHeaders(session = {}) {
  const jarHeader = sessionCookieHeader(session);
  const browserish = cookieLooksAuthed(jarHeader);
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    Origin: envStr("MEXCHANGE_ORIGIN", "https://mexchange.betbra.bet.br"),
    Referer: envStr(
      "MEXCHANGE_REFERER",
      "https://mexchange.betbra.bet.br/"
    ),
    "User-Agent": envStr(
      "MEXCHANGE_USER_AGENT",
      browserish
        ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
        : "Mozilla/5.0 (compatible; ArbiShieldOrders/1.0)"
    ),
  };
  const lang = envStr("MEXCHANGE_BIAB_LANGUAGE", "PT_BR");
  if (jarHeader) {
    headers.Cookie = jarHeader.includes("BIAB_LANGUAGE=")
      ? jarHeader
      : `BIAB_LANGUAGE=${lang}; ${jarHeader}`;
  } else {
    headers.Cookie = `BIAB_LANGUAGE=${lang}`;
  }
  // Frontend Mexchange: cookies (withCredentials). JWT sb do Chrome como Bearer
  // costuma gerar AccountId not found. Token de Aplicativo Externo (LAYBACK/bot)
  // precisa de Bearer mesmo com EXCHANGE_ORDERS_AUTH_STYLE=cookie.
  const authStyle = envStr("EXCHANGE_ORDERS_AUTH_STYLE", "auto").toLowerCase();
  const isExternalApp =
    session.authMode === "external_app" ||
    session.forceBearer === true ||
    process.env.EXCHANGE_ORDERS_FORCE_BEARER === "1";
  const forceBearer = authStyle === "bearer" || isExternalApp;
  if (forceBearer || (!browserish && authStyle !== "cookie")) {
    let token = String(
      session.houseToken ||
        session.appToken ||
        session.accessToken ||
        session.sessionToken ||
        ""
    ).trim();
    if (
      (!token || token.startsWith("cred:") || token === "browser-session") &&
      jarHeader &&
      !isExternalApp
    ) {
      const m = jarHeader.match(
        /(?:^|;\s*)(?:sb|BIAB_CUSTOMER)=([^;]+)/i
      );
      if (m) token = m[1].trim();
    }
    if (
      token &&
      !token.startsWith("cred:") &&
      token !== "browser-session" &&
      token !== "demo"
    ) {
      headers.Authorization = `Bearer ${token}`;
      // Soft2Bet vendor / apps externos às vezes usam estes headers
      if (isExternalApp) {
        headers["X-Authentication"] = token;
        headers["X-Auth-Token"] = token;
      }
    }
  }
  // UA de bot ajuda em alguns gates de aplicativo externo
  if (isExternalApp) {
    headers["User-Agent"] = envStr(
      "MEXCHANGE_BOT_USER_AGENT",
      "BOT/SOFTWARE;ArbiShield;1.0"
    );
  }
  return { ...headers, ...(session.extraHeaders || {}) };
}

/**
 * Confere se a sessão resolve accountId em GET /account/info.
 */
export async function fetchMexchangeAccountInfo(session = {}) {
  const base = resolveMexchangeApiBase();
  const url = `${base}/account/info`;
  const res = await fetch(url, {
    method: "GET",
    headers: buildMexchangeAuthHeaders(session),
    redirect: "manual",
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text?.slice(0, 200) };
  }
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location") || "";
    const err = new Error(
      /countryblock/i.test(loc)
        ? "Mexchange countryblock ao ler account/info"
        : `Redirect account/info: ${loc.slice(0, 80)}`
    );
    err.status = 403;
    err.code = "MEXCHANGE_ACCOUNT_REDIRECT";
    throw err;
  }
  const accountId =
    data?.accountId != null && String(data.accountId) !== ""
      ? String(data.accountId)
      : data?.id != null
        ? String(data.id)
        : "";
  return {
    ok: res.ok,
    status: res.status,
    accountId,
    currency: data?.currency || null,
    minBet: data?.minBet != null ? Number(data.minBet) : null,
    raw: data,
    url,
  };
}

export function hasTradingSession(session = {}) {
  const cookie = sessionCookieHeader(session);
  if (cookieLooksAuthed(cookie)) return true;
  const token = String(
    session.houseToken ||
      session.appToken ||
      session.accessToken ||
      session.sessionToken ||
      ""
  ).trim();
  if (!token) return false;
  if (token.startsWith("cred:")) return false;
  if (token === "browser-session" || token === "demo") return false;
  return true;
}

/**
 * Extrai Cookie de um "Copy as cURL" (Chrome Windows/Linux/macOS).
 */
export function extractCookieFromCurl(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return "";
  // já é só o cookie
  if (!/^curl\b/i.test(raw) && /(?:^|;\s*)(?:sb|BIAB_CUSTOMER|SESSION)=/i.test(raw)) {
    return decodeWindowsCurlEscapes(raw.replace(/^cookie:\s*/i, "").trim());
  }
  // -b / --cookie
  let m = raw.match(/(?:^|\s)(?:-b|--cookie)\s+(?:\$)?'([^']+)'/i);
  if (!m) m = raw.match(/(?:^|\s)(?:-b|--cookie)\s+(?:\$)?"([^"]+)"/i);
  if (!m) {
    // Windows cmd: -b ^"....^"
    m = raw.match(/(?:^|\s)-b\s+\^?"([\s\S]*?)\^?"/i);
  }
  if (!m) {
    m = raw.match(/-H\s+\^?"[Cc]ookie:\s*([\s\S]*?)\^?"/i);
  }
  if (!m) {
    m = raw.match(/-H\s+'[Cc]ookie:\s*([^']+)'/i);
  }
  if (!m) {
    m = raw.match(/-H\s+"[Cc]ookie:\s*([^"]+)"/i);
  }
  if (!m) return "";
  return decodeWindowsCurlEscapes(m[1].trim());
}

function decodeWindowsCurlEscapes(s) {
  let out = String(s || "");
  out = out.replace(/\^%\^/g, "%");
  out = out.replace(/\^\$/g, "$");
  out = out.replace(/\^&/g, "&");
  out = out.replace(/\^"/g, '"');
  out = out.replace(/\^\^/g, "^");
  out = out.replace(/\^(.)/g, "$1");
  return out.trim();
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
