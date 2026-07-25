/**
 * Adapter de ordens na exchange.
 * Hoje: stub (NOT_WIRED). Quando a casa liberar a API, implementar
 * `BetbraOrdersAdapter` / `FulltbetOrdersAdapter` e setar
 * EXCHANGE_ORDERS_PROVIDER=betbra|fulltbet e EXCHANGE_ORDERS_LIVE=1.
 */
import {
  EXCHANGE_ORDERS_CONTRACT_VERSION,
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
  }
}

/** Stub — não envia ordem real. */
export class StubOrdersAdapter {
  constructor() {
    this.provider = "stub";
  }

  async placeOrder(_session, _payload) {
    throw new ExchangeOrdersNotWiredError(
      "Adapter stub: configure EXCHANGE_ORDERS_PROVIDER + credenciais da casa."
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
    };
  }
}

/**
 * Skeleton BetBra/Mexchange — preencher URLs/auth quando a doc chegar.
 * Não chamar em produção sem EXCHANGE_ORDERS_LIVE=1 e testes.
 */
export class BetbraOrdersAdapter {
  constructor(opts = {}) {
    this.provider = "betbra";
    this.apiBase = String(
      opts.apiBase ||
        process.env.MEXCHANGE_ORDERS_API_BASE ||
        process.env.MEXCHANGE_API_BASE_URL ||
        "https://mexchange-api.betbra.bet.br/api"
    ).replace(/\/$/, "");
    this.live =
      process.env.EXCHANGE_ORDERS_LIVE === "1" ||
      process.env.EXCHANGE_ORDERS_LIVE === "true";
  }

  async placeOrder(session, payload) {
    if (!this.live) {
      throw new ExchangeOrdersNotWiredError(
        "BetbraOrdersAdapter em modo dry-run (EXCHANGE_ORDERS_LIVE≠1)."
      );
    }
    // Placeholder: a doc da casa define path/headers reais.
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
    const orderId = String(
      data?.id || data?.orderId || data?.order_id || ""
    );
    return {
      orderId,
      status: normalizeOrderStatus(data?.status || "pending"),
      provider: this.provider,
      raw: data,
      wired: true,
    };
  }

  async cancelOrder(session, orderId) {
    if (!this.live) {
      throw new ExchangeOrdersNotWiredError(
        "BetbraOrdersAdapter em modo dry-run (EXCHANGE_ORDERS_LIVE≠1)."
      );
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
    };
  }

  async getOrderStatus(session, orderId) {
    if (!this.live) {
      return {
        orderId: String(orderId),
        status: "unknown",
        provider: this.provider,
        wired: false,
        note: "dry-run",
      };
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
    };
  }
}

export function createOrdersAdapter() {
  const name = String(process.env.EXCHANGE_ORDERS_PROVIDER || "stub")
    .toLowerCase()
    .trim();
  if (name === "betbra" || name === "mexchange" || name === "fulltbet") {
    return new BetbraOrdersAdapter();
  }
  return new StubOrdersAdapter();
}
