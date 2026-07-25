/**
 * Adapter de ordens na exchange (BetBra / Mexchange / Fulltbet).
 *
 * A API de trading autenticada da exchange pública existe
 * (mexchange-api.*.bet.br). Catálogo (events/odds) é anônimo;
 * place/cancel/status exigem sessão do cliente.
 *
 * - demo (padrão seguro): simula place/cancel/status.
 * - stub: rejeita com EXCHANGE_ORDERS_NOT_WIRED.
 * - betbra: chama a API pública com a sessão do cliente quando
 *   EXCHANGE_ORDERS_LIVE=1; senão cai no demo.
 *
 * Paths/auth configuráveis (a casa pode variar o path exato):
 *   EXCHANGE_ORDERS_BASE_URL / MEXCHANGE_API_BASE_URL
 *   EXCHANGE_ORDERS_PLACE_PATH   (default /orders)
 *   EXCHANGE_ORDERS_CANCEL_PATH  (default /orders/{id}/cancel)
 *   EXCHANGE_ORDERS_STATUS_PATH  (default /orders/{id})
 *   EXCHANGE_ORDERS_AUTH_STYLE   bearer | x-auth-token | cookie
 *   EXCHANGE_ORDERS_PAYLOAD      exchange | snake
 */
import {
  EXCHANGE_ORDERS_CONTRACT_VERSION,
  EXCHANGE_ORDERS_LOCK,
  normalizeOrderStatus,
} from "./exchange-orders-contract.mjs";

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
  return envStr(
    "MEXCHANGE_ORDERS_API_BASE",
    envStr(
      "EXCHANGE_ORDERS_BASE_URL",
      envStr("MEXCHANGE_API_BASE_URL", "https://mexchange-api.betbra.bet.br/api")
    )
  ).replace(/\/$/, "");
}

/**
 * Monta headers de auth da sessão do cliente para a API pública.
 * @param {object} session
 * @param {string} [style]
 */
export function buildExchangeAuthHeaders(session = {}, style) {
  const mode = String(
    style || envStr("EXCHANGE_ORDERS_AUTH_STYLE", "bearer")
  )
    .toLowerCase()
    .trim();
  const token = String(session.accessToken || session.sessionToken || "").trim();
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "Accept-Language": "pt-BR,pt;q=0.9",
    Referer: envStr(
      "MEXCHANGE_REFERER",
      "https://mexchange.betbra.bet.br/"
    ),
    "User-Agent": envStr(
      "MEXCHANGE_USER_AGENT",
      "Mozilla/5.0 (compatible; ArbiShieldOrders/1.0)"
    ),
  };
  if (!token) return { ...headers, ...(session.extraHeaders || {}) };

  if (mode === "x-auth-token" || mode === "x_auth_token") {
    headers["X-Auth-Token"] = token;
  } else if (mode === "cookie") {
    const lang = envStr("MEXCHANGE_BIAB_LANGUAGE", "PT_BR");
    headers.Cookie = `BIAB_LANGUAGE=${lang}; ${
      session.cookieName || "SESSION"
    }=${token}${session.cookieExtra ? `; ${session.cookieExtra}` : ""}`;
  } else {
    // bearer (padrão da API autenticada pública)
    headers.Authorization = `Bearer ${token}`;
  }
  return { ...headers, ...(session.extraHeaders || {}) };
}

/**
 * Body de place para a API pública da exchange.
 * @param {object} payload validatePlaceOrderBody result
 */
export function buildExchangePlaceBody(payload = {}, style) {
  const mode = String(style || envStr("EXCHANGE_ORDERS_PAYLOAD", "exchange"))
    .toLowerCase()
    .trim();
  const stakeBrl = Number(payload.stakeCents || 0) / 100;
  const side = String(payload.side || "").toUpperCase();
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
  // exchange: shape típico BACK/LAY (API pública autenticada)
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
    this.placePath = envStr("EXCHANGE_ORDERS_PLACE_PATH", "/orders");
    this.cancelPath = envStr(
      "EXCHANGE_ORDERS_CANCEL_PATH",
      "/orders/{id}/cancel"
    );
    this.statusPath = envStr("EXCHANGE_ORDERS_STATUS_PATH", "/orders/{id}");
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
          "Betbra em modo demo (EXCHANGE_ORDERS_LIVE≠1). Ordem simulada — nenhuma aposta real. A API pública autenticada existe; ligue LIVE com sessão do cliente.",
      };
    }
    if (!session?.accessToken && !session?.sessionToken) {
      throw new ExchangeOrdersNotWiredError(
        `${EXCHANGE_ORDERS_LOCK}: sessão do cliente obrigatória para place na API pública.`
      );
    }
    const url = this.url(this.placePath, {});
    const res = await fetch(url, {
      method: "POST",
      headers: buildExchangeAuthHeaders(session),
      body: JSON.stringify(buildExchangePlaceBody(payload)),
    });
    const { data } = await parseJsonResponse(res);
    if (!res.ok) {
      const err = new Error(
        (data && (data.message || data.error || data.title)) ||
          `Exchange place HTTP ${res.status}`
      );
      err.status = res.status;
      err.code = "EXCHANGE_PLACE_FAILED";
      err.details = data;
      err.url = url;
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
    };
  }

  async cancelOrder(session, orderId) {
    if (!this.live) {
      const r = await this.demo.cancelOrder(session, orderId);
      return { ...r, provider: this.provider, publicApi: this.publicApi };
    }
    const id = String(orderId || "");
    const url = this.url(this.cancelPath, { id, orderId: id });
    const res = await fetch(url, {
      method: "POST",
      headers: buildExchangeAuthHeaders(session),
      body: JSON.stringify({ orderId: id }),
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
    const url = this.url(this.statusPath, { id, orderId: id });
    const res = await fetch(url, {
      method: "GET",
      headers: buildExchangeAuthHeaders(session),
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
    return {
      orderId: extractOrderId(data, id),
      status: extractStatus(data, "unknown"),
      provider: this.provider,
      publicApi: this.publicApi,
      raw: data,
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
