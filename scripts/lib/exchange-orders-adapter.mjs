/**
 * Adapter de ordens na exchange.
 *
 * - demo (padrão): simula place/cancel/status sem chamar a casa.
 * - stub: rejeita com EXCHANGE_ORDERS_NOT_WIRED.
 * - betbra: esqueleto; sem EXCHANGE_ORDERS_LIVE=1 cai no demo.
 *
 * Quando a casa enviar a doc oficial, mapear paths em BetbraOrdersAdapter
 * e setar EXCHANGE_ORDERS_PROVIDER=betbra + EXCHANGE_ORDERS_LIVE=1.
 */
import {
  EXCHANGE_ORDERS_CONTRACT_VERSION,
  EXCHANGE_ORDERS_LOCK,
  normalizeOrderStatus,
} from "./exchange-orders-contract.mjs";

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

/** Stub — não envia ordem. */
export class StubOrdersAdapter {
  constructor() {
    this.provider = "stub";
  }

  async placeOrder(_session, _payload) {
    throw new ExchangeOrdersNotWiredError(
      "Adapter stub: use provider=demo ou configure a API da casa."
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
 * Skeleton BetBra/Mexchange — preencher URLs/auth quando a doc chegar.
 * Sem EXCHANGE_ORDERS_LIVE=1 usa DemoOrdersAdapter (sem aposta real).
 */
export class BetbraOrdersAdapter {
  constructor(opts = {}) {
    this.provider = "betbra";
    this.apiBase = String(
      opts.apiBase ||
        process.env.MEXCHANGE_ORDERS_API_BASE ||
        process.env.EXCHANGE_ORDERS_BASE_URL ||
        process.env.MEXCHANGE_API_BASE_URL ||
        "https://mexchange-api.betbra.bet.br/api"
    ).replace(/\/$/, "");
    this.live = Boolean(opts.live) || envLive();
    this.demo = new DemoOrdersAdapter();
  }

  async placeOrder(session, payload) {
    if (!this.live) {
      const r = await this.demo.placeOrder(session, payload);
      return {
        ...r,
        provider: this.provider,
        message:
          "Betbra em modo demo (EXCHANGE_ORDERS_LIVE≠1). Ordem simulada — nenhuma aposta real.",
      };
    }
    if (!session?.accessToken) {
      throw new ExchangeOrdersNotWiredError(
        `${EXCHANGE_ORDERS_LOCK}: sessão do cliente obrigatória para place live.`
      );
    }
    const url = `${this.apiBase}/orders`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessToken}`,
        ...(session.extraHeaders || {}),
      },
      body: JSON.stringify({
        side: payload.side,
        odd: payload.odd,
        stake_cents: payload.stakeCents,
        event_id: payload.eventId,
        market_id: payload.marketId,
        selection_id: payload.selectionId,
        client_order_id: payload.clientOrderId,
      }),
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      const err = new Error(
        (data && (data.message || data.error)) ||
          `Exchange place HTTP ${res.status}`
      );
      err.status = res.status;
      err.code = "EXCHANGE_PLACE_FAILED";
      err.details = data;
      throw err;
    }
    const orderId = String(data?.id || data?.orderId || data?.order_id || "");
    return {
      orderId,
      status: normalizeOrderStatus(data?.status || "pending"),
      provider: this.provider,
      raw: data,
      wired: true,
      demo: false,
    };
  }

  async cancelOrder(session, orderId) {
    if (!this.live) {
      const r = await this.demo.cancelOrder(session, orderId);
      return { ...r, provider: this.provider };
    }
    const url = `${this.apiBase}/orders/${encodeURIComponent(orderId)}/cancel`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${session.accessToken}`,
        ...(session.extraHeaders || {}),
      },
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      const err = new Error(
        (data && (data.message || data.error)) ||
          `Exchange cancel HTTP ${res.status}`
      );
      err.status = res.status;
      err.code = "EXCHANGE_CANCEL_FAILED";
      throw err;
    }
    return {
      orderId: String(orderId),
      status: normalizeOrderStatus(data?.status || "cancelled"),
      provider: this.provider,
      raw: data,
      wired: true,
      demo: false,
    };
  }

  async getOrderStatus(session, orderId) {
    if (!this.live) {
      const r = await this.demo.getOrderStatus(session, orderId);
      return { ...r, provider: this.provider };
    }
    const url = `${this.apiBase}/orders/${encodeURIComponent(orderId)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${session.accessToken}`,
        ...(session.extraHeaders || {}),
      },
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      const err = new Error(
        (data && (data.message || data.error)) ||
          `Exchange status HTTP ${res.status}`
      );
      err.status = res.status;
      err.code = "EXCHANGE_STATUS_FAILED";
      throw err;
    }
    return {
      orderId: String(data?.id || orderId),
      status: normalizeOrderStatus(data?.status),
      provider: this.provider,
      raw: data,
      wired: true,
      demo: false,
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
