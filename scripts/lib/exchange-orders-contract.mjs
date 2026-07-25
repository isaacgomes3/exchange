/**
 * Contrato da API de ordens ArbiShield ↔ exchange (BetBra / Fulltbet / Mexchange).
 *
 * A API de trading autenticada da exchange pública existe
 * (mexchange-api). ArbiShield espelha place/cancel/status com a
 * sessão do cliente — nunca com credencial da plataforma sozinha.
 *
 * Marker: DO_NOT_PLACE_WITHOUT_CLIENT_SESSION
 */
export const EXCHANGE_ORDERS_CONTRACT_VERSION = "exchange-orders-contract-v1";
export const EXCHANGE_ORDERS_LOCK = "DO_NOT_PLACE_WITHOUT_CLIENT_SESSION";

export function normalizeOrderSide(side) {
  const s = String(side || "")
    .toUpperCase()
    .trim();
  if (s === "LAY" || s === "BACK") return s;
  return "";
}

export function normalizeOrderStatus(status) {
  const s = String(status || "")
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_");
  const map = {
    pending: "pending",
    open: "open",
    matched: "matched",
    partial: "partial",
    filled: "matched",
    cancelled: "cancelled",
    canceled: "cancelled",
    failed: "failed",
    rejected: "rejected",
    settled: "settled",
    void: "void",
  };
  return map[s] || s || "unknown";
}

/**
 * Valida payload de place. stakeCents = responsabilidade (LAY) ou stake (BACK).
 */
export function validatePlaceOrderBody(body) {
  const side = normalizeOrderSide(body?.side || body?.marketType);
  const odd = Number(String(body?.odd ?? "").replace(",", "."));
  const stakeCents = Math.floor(Number(body?.stakeCents ?? body?.amountCents ?? 0));
  const eventId = String(body?.eventId || body?.externalEventId || "").trim();
  const marketId = String(body?.marketId || body?.externalMarketId || "").trim();
  const selectionId = String(
    body?.selectionId || body?.runnerId || body?.selection || ""
  ).trim();
  if (!side) {
    const err = new Error("side obrigatório (LAY ou BACK)");
    err.status = 400;
    err.code = "INVALID_SIDE";
    throw err;
  }
  if (!(odd > 1.01)) {
    const err = new Error("odd inválida");
    err.status = 400;
    err.code = "INVALID_ODD";
    throw err;
  }
  if (!(stakeCents > 0)) {
    const err = new Error("stakeCents / amountCents inválido");
    err.status = 400;
    err.code = "INVALID_STAKE";
    throw err;
  }
  if (!eventId && !marketId) {
    const err = new Error("eventId ou marketId obrigatório");
    err.status = 400;
    err.code = "INVALID_MARKET";
    throw err;
  }
  return {
    side,
    odd,
    stakeCents,
    eventId: eventId || null,
    marketId: marketId || null,
    selectionId: selectionId || null,
    clientOrderId: body?.clientOrderId ? String(body.clientOrderId) : null,
    mirrorProtection: body?.mirrorProtection !== false,
    metadata:
      body?.metadata && typeof body.metadata === "object" ? body.metadata : {},
  };
}

export function validateCancelOrderBody(body) {
  const orderId = String(
    body?.orderId || body?.externalOrderId || body?.id || ""
  ).trim();
  if (!orderId) {
    const err = new Error("orderId obrigatório");
    err.status = 400;
    err.code = "INVALID_ORDER_ID";
    throw err;
  }
  return {
    orderId,
    reason: body?.reason ? String(body.reason).slice(0, 200) : null,
  };
}
