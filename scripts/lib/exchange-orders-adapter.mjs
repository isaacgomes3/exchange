/**
 * Adapter de ordens na exchange (BetBra / Mexchange / Fulltbet).
 *
 * Mexchange (frontend real):
 *   POST   /offers  — place
 *   DELETE /offers?offer-ids=… — cancel
 *   GET    /offers — list/status
 * Auth: cookies (withCredentials) + opcional Bearer houseToken.
 *
 * - demo (padrão seguro): simula place/cancel/status.
 * - stub: rejeita com EXCHANGE_ORDERS_NOT_WIRED.
 * - betbra: chama a API quando EXCHANGE_ORDERS_LIVE=1; senão demo.
 *
 * Env:
 *   EXCHANGE_ORDERS_BASE_URL / MEXCHANGE_API_BASE_URL
 *   EXCHANGE_ORDERS_PLACE_PATH   (default /offers)
 *   EXCHANGE_ORDERS_CANCEL_PATH  (default /offers)
 *   EXCHANGE_ORDERS_STATUS_PATH  (default /offers)
 *   EXCHANGE_ORDERS_PAYLOAD      mexchange | exchange | snake
 */
import {
  EXCHANGE_ORDERS_CONTRACT_VERSION,
  EXCHANGE_ORDERS_LOCK,
  normalizeOrderStatus,
} from "./exchange-orders-contract.mjs";
import {
  buildMexchangeAuthHeaders,
  buildMexchangeOffersBody,
  extractOfferId,
  extractOfferStatus,
  fetchMexchangeAccountInfo,
  hasTradingSession,
  resolveMexchangeApiBase,
} from "./mexchange-offers.mjs";
import {
  bridgeCancelOrder,
  bridgePlaceOrder,
  isLocalBridgeEnabled,
} from "./exchange-local-bridge.mjs";

/** Marker: API pública autenticada da exchange existe (não só catálogo). */
export const EXCHANGE_PUBLIC_TRADING_API = "mexchange-public-trading-api-v1";

export class ExchangeOrdersNotWiredError extends Error {
  constructor(message) {
    super(
      message ||
        "API de ordens da exchange ainda não configurada (EXCHANGE_ORDERS_LIVE=0)."
    );
    this.name = "ExchangeOrdersNotWiredError";
    this.status = 503;
    this.code = "EXCHANGE_ORDERS_NOT_WIRED";
    this.lock = EXCHANGE_ORDERS_LOCK;
  }
}

function envLive() {
  const v = String(process.env.EXCHANGE_ORDERS_LIVE || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function envStr(name, fallback = "") {
  const v = process.env[name];
  if (v == null || String(v).trim() === "") return fallback;
  return String(v).trim();
}

export function resolveOrdersProviderName() {
  const raw = String(process.env.EXCHANGE_ORDERS_PROVIDER || "demo")
    .trim()
    .toLowerCase();
  if (raw === "betbra" || raw === "mexchange" || raw === "fulltbet" || raw === "live") {
    return "betbra";
  }
  if (raw === "stub") return "stub";
  return "demo";
}

export function resolveOrdersApiBase() {
  return resolveMexchangeApiBase();
}

/**
 * Headers para a API Mexchange (cookies + Bearer opcional).
 * @param {object} session
 * @param {string} [style] cookie | bearer | x-auth-token | auto
 */
export function buildExchangeAuthHeaders(session = {}, style) {
  const mode = String(
    style || envStr("EXCHANGE_ORDERS_AUTH_STYLE", "auto")
  )
    .toLowerCase()
    .trim();
  if (mode === "auto" || mode === "cookie" || mode === "mexchange") {
    return buildMexchangeAuthHeaders(session);
  }
  const token = String(
    session.houseToken || session.accessToken || session.sessionToken || ""
  ).trim();
  const headers = buildMexchangeAuthHeaders({ ...session, houseToken: null });
  if (!token || token.startsWith("cred:")) {
    return { ...headers, ...(session.extraHeaders || {}) };
  }
  if (mode === "x-auth-token" || mode === "x_auth_token") {
    delete headers.Authorization;
    headers["X-Auth-Token"] = token;
  } else {
    headers.Authorization = `Bearer ${token}`;
  }
  return { ...headers, ...(session.extraHeaders || {}) };
}

/**
 * Body de place. Default = payload real Mexchange (`/offers`).
 * @param {object} payload validatePlaceOrderBody result
 */
export function buildExchangePlaceBody(payload = {}, style) {
  const mode = String(style || envStr("EXCHANGE_ORDERS_PAYLOAD", "mexchange"))
    .toLowerCase()
    .trim();
  const stakeBrl = Number(payload.stakeCents || 0) / 100;
  const side = String(payload.side || "").toUpperCase();
  if (mode === "mexchange" || mode === "offers" || mode === "auto") {
    return buildMexchangeOffersBody(payload);
  }
  if (mode === "snake") {
    return {
      side,
      odd: payload.odd,
      price: payload.odd,
      stake_cents: payload.stakeCents,
      stake: stakeBrl,
      size: stakeBrl,
      event_id: payload.eventId,
      market_id: payload.marketId,
      selection_id: payload.selectionId,
      client_order_id: payload.clientOrderId,
    };
  }
  // legado "exchange"
  return {
    side,
    price: payload.odd,
    odd: payload.odd,
    size: stakeBrl,
    stake: stakeBrl,
    stakeCents: payload.stakeCents,
    eventId: payload.eventId,
    marketId: payload.marketId,
    selectionId: payload.selectionId,
    runnerId: payload.selectionId,
    clientOrderId: payload.clientOrderId,
    persistenceType: "LAPSE",
    orderType: "LIMIT",
  };
}

function expandPath(template, vars = {}) {
  return String(template || "").replace(/\{(\w+)\}/g, (_, k) =>
    encodeURIComponent(String(vars[k] ?? ""))
  );
}

async function parseJsonResponse(res) {
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { text, data };
}

function extractOrderId(data, fallback = "") {
  const fromOffer = extractOfferId(data, "");
  if (fromOffer) return fromOffer;
  return String(
    data?.id ||
      data?.orderId ||
      data?.order_id ||
      data?.betId ||
      data?.bet_id ||
      data?.data?.id ||
      data?.data?.orderId ||
      data?.result?.orderId ||
      fallback ||
      ""
  );
}

function extractStatus(data, fallback = "pending") {
  return normalizeOrderStatus(
    extractOfferStatus(data, "") ||
      data?.status ||
      data?.orderStatus ||
      data?.order_status ||
      data?.data?.status ||
      data?.result?.status ||
      fallback
  );
}

/** Stub — não envia ordem. */
export class StubOrdersAdapter {
  constructor() {
    this.provider = "stub";
  }

  async placeOrder(_session, _payload) {
    throw new ExchangeOrdersNotWiredError(
      "Adapter stub: use provider=demo ou EXCHANGE_ORDERS_PROVIDER=betbra + LIVE=1."
    );
  }

  async cancelOrder(_session, _orderId) {
    throw new ExchangeOrdersNotWiredError(
      "Adapter stub: cancel ainda não ligado à API da casa."
    );
  }

  async getOrderStatus(_session, orderId) {
    return {
      orderId: String(orderId),
      status: normalizeOrderStatus("unknown"),
      provider: this.provider,
      contract: EXCHANGE_ORDERS_CONTRACT_VERSION,
      wired: false,
      demo: false,
    };
  }
}

/** Simula aceitação/cancelamento; nada é enviado à exchange. */
export class DemoOrdersAdapter {
  constructor() {
    this.provider = "demo";
    /** @type {Map<string, string>} */
    this._status = new Map();
  }

  async placeOrder(_session, payload = {}) {
    const orderId = `demo_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const status = "matched";
    this._status.set(orderId, status);
    return {
      orderId,
      status,
      side: payload.side,
      odd: payload.odd,
      stakeCents: payload.stakeCents,
      eventId: payload.eventId,
      marketId: payload.marketId,
      selectionId: payload.selectionId,
      provider: this.provider,
      demo: true,
      wired: false,
      message: "Ordem simulada (demo). Nenhuma aposta real foi enviada à exchange.",
      contract: EXCHANGE_ORDERS_CONTRACT_VERSION,
    };
  }

  async cancelOrder(_session, orderId) {
    const id = String(orderId || "");
    this._status.set(id, "cancelled");
    return {
      orderId: id,
      status: "cancelled",
      provider: this.provider,
      demo: true,
      wired: false,
      message: "Cancelamento simulado (demo).",
      contract: EXCHANGE_ORDERS_CONTRACT_VERSION,
    };
  }

  async getOrderStatus(_session, orderId) {
    const id = String(orderId || "");
    const status = this._status.get(id) || "matched";
    return {
      orderId: id,
      status: normalizeOrderStatus(status),
      provider: this.provider,
      demo: true,
      wired: false,
      contract: EXCHANGE_ORDERS_CONTRACT_VERSION,
    };
  }
}

/**
 * Adapter da API pública autenticada Mexchange/BetBra.
 * LIVE só com sessão do cliente + EXCHANGE_ORDERS_LIVE=1.
 */
export class BetbraOrdersAdapter {
  constructor(opts = {}) {
    this.provider = "betbra";
    this.apiBase = String(opts.apiBase || resolveOrdersApiBase()).replace(
      /\/$/,
      ""
    );
    this.live = Boolean(opts.live) || envLive();
    this.demo = new DemoOrdersAdapter();
    this.placePath = envStr("EXCHANGE_ORDERS_PLACE_PATH", "/offers");
    this.cancelPath = envStr("EXCHANGE_ORDERS_CANCEL_PATH", "/offers");
    this.statusPath = envStr("EXCHANGE_ORDERS_STATUS_PATH", "/offers");
    this.publicApi = EXCHANGE_PUBLIC_TRADING_API;
  }

  url(pathTemplate, vars) {
    const path = expandPath(pathTemplate, vars);
    if (/^https?:\/\//i.test(path)) return path;
    return `${this.apiBase}${path.startsWith("/") ? path : `/${path}`}`;
  }

  async placeOrder(session, payload) {
    if (!this.live) {
      const r = await this.demo.placeOrder(session, payload);
      return {
        ...r,
        provider: this.provider,
        publicApi: this.publicApi,
        message:
          "Betbra em modo demo (EXCHANGE_ORDERS_LIVE≠1). Ordem simulada — nenhuma aposta real. Ligue LIVE + Conta BetBra com cookies/token.",
      };
    }
    if (!hasTradingSession(session)) {
      throw new ExchangeOrdersNotWiredError(
        `${EXCHANGE_ORDERS_LOCK}: sessão do cliente obrigatória (cookies/token da BetBra). Atualize saldo em Conta BetBra.`
      );
    }
    if (!payload?.selectionId) {
      const err = new Error(
        "selectionId/runner-id obrigatório para place real (ex. placar 3-3)"
      );
      err.status = 400;
      err.code = "SELECTION_REQUIRED";
      throw err;
    }
    // IP residencial: VPS delega place ao agente no PC
    if (isLocalBridgeEnabled()) {
      const out = await bridgePlaceOrder(session, payload);
      return {
        ...out,
        provider: this.provider,
        publicApi: this.publicApi,
        via: "local-bridge",
        wired: true,
        demo: false,
      };
    }
    // Pré-checagem: sessão precisa resolver accountId (igual ao frontend)
    try {
      const acc = await fetchMexchangeAccountInfo(session);
      if (!acc.ok || !acc.accountId) {
        const err = new Error(
          "AccountId not found — cookies da sessão não autenticaram na Mexchange. " +
            "Em Conta BetBra clique em Testar sessão. Se falhar: Cookie do Chrome " +
            "não vale no IP da VPS — use login/senha + aprovação do device (Atualizar saldo)."
        );
        err.status = 401;
        err.code = "MEXCHANGE_ACCOUNT_MISSING";
        err.details = acc.raw;
        throw err;
      }
    } catch (e) {
      if (e?.code === "MEXCHANGE_ACCOUNT_MISSING") throw e;
      // se account/info falhar por rede, ainda tenta place
      if (e?.code === "MEXCHANGE_ACCOUNT_REDIRECT") throw e;
    }
    const url = this.url(this.placePath, {});
    const body = buildExchangePlaceBody(payload);
    const res = await fetch(url, {
      method: "POST",
      headers: buildExchangeAuthHeaders(session),
      body: JSON.stringify(body),
      redirect: "manual",
    });
    const { data } = await parseJsonResponse(res);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location") || "";
      const err = new Error(
        /countryblock/i.test(loc)
          ? "Mexchange countryblock — place só na VPS com IP BR"
          : `Redirect no place: ${loc.slice(0, 100)}`
      );
      err.status = 403;
      err.code = "EXCHANGE_PLACE_REDIRECT";
      err.url = url;
      throw err;
    }
    if (!res.ok) {
      let msg =
        (data && (data.message || data.error || data.title)) ||
        `Exchange place HTTP ${res.status}`;
      if (/accountid not found/i.test(String(msg))) {
        msg =
          "AccountId not found — a Mexchange não reconheceu a sessão na VPS. " +
          "Conta BetBra → Testar sessão. Se accountId vier vazio, aprove o device da VPS " +
          "(login/senha + e-mail/SMS) em vez de reutilizar Cookie do Chrome.";
      }
      const err = new Error(String(msg));
      err.status = res.status;
      err.code = "EXCHANGE_PLACE_FAILED";
      err.details = data;
      err.url = url;
      err.requestBody = body;
      throw err;
    }
    const orderId = extractOrderId(data);
    return {
      orderId,
      status: extractStatus(data, "pending"),
      provider: this.provider,
      publicApi: this.publicApi,
      raw: data,
      wired: true,
      demo: false,
      url,
      requestBody: body,
    };
  }

  async cancelOrder(session, orderId) {
    if (!this.live) {
      const r = await this.demo.cancelOrder(session, orderId);
      return { ...r, provider: this.provider, publicApi: this.publicApi };
    }
    if (isLocalBridgeEnabled()) {
      const out = await bridgeCancelOrder(session, orderId);
      return {
        ...out,
        provider: this.provider,
        publicApi: this.publicApi,
        via: "local-bridge",
      };
    }
    const id = String(orderId || "");
    // Mexchange: DELETE /offers?offer-ids=ID
    const base = this.url(this.cancelPath, { id, orderId: id });
    const url = /offer-ids=/.test(base)
      ? base
      : `${base}${base.includes("?") ? "&" : "?"}offer-ids=${encodeURIComponent(id)}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: buildExchangeAuthHeaders(session),
      redirect: "manual",
    });
    const { data } = await parseJsonResponse(res);
    if (!res.ok) {
      const err = new Error(
        (data && (data.message || data.error || data.title)) ||
          `Exchange cancel HTTP ${res.status}`
      );
      err.status = res.status;
      err.code = "EXCHANGE_CANCEL_FAILED";
      err.details = data;
      err.url = url;
      throw err;
    }
    return {
      orderId: extractOrderId(data, id),
      status: extractStatus(data, "cancelled"),
      provider: this.provider,
      publicApi: this.publicApi,
      raw: data,
      wired: true,
      demo: false,
      url,
    };
  }

  async getOrderStatus(session, orderId) {
    if (!this.live) {
      const r = await this.demo.getOrderStatus(session, orderId);
      return { ...r, provider: this.provider, publicApi: this.publicApi };
    }
    const id = String(orderId || "");
    const listUrl = this.url(this.statusPath, { id, orderId: id });
    const url = /[?]/.test(listUrl)
      ? listUrl
      : `${listUrl}?offset=0&per-page=200`;
    const res = await fetch(url, {
      method: "GET",
      headers: buildExchangeAuthHeaders(session),
      redirect: "manual",
    });
    const { data } = await parseJsonResponse(res);
    if (!res.ok) {
      const err = new Error(
        (data && (data.message || data.error || data.title)) ||
          `Exchange status HTTP ${res.status}`
      );
      err.status = res.status;
      err.code = "EXCHANGE_STATUS_FAILED";
      err.details = data;
      err.url = url;
      throw err;
    }
    const offers = Array.isArray(data?.offers) ? data.offers : [];
    const hit = offers.find(
      (o) => String(o.id || o.offerId || o["offer-id"]) === id
    );
    return {
      orderId: id,
      status: extractStatus(hit || data, hit ? hit.status : "unknown"),
      provider: this.provider,
      publicApi: this.publicApi,
      raw: hit || data,
      wired: true,
      demo: false,
      url,
    };
  }
}

export function createOrdersAdapter(name = resolveOrdersProviderName()) {
  const n = String(name || "demo").toLowerCase().trim();
  if (n === "betbra" || n === "mexchange" || n === "fulltbet" || n === "live") {
    return new BetbraOrdersAdapter({ live: envLive() });
  }
  if (n === "stub") return new StubOrdersAdapter();
  return new DemoOrdersAdapter();
}
