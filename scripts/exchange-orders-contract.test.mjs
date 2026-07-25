import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXCHANGE_ORDERS_CONTRACT_VERSION,
  EXCHANGE_ORDERS_LOCK,
  validatePlaceOrderBody,
  validateCancelOrderBody,
  normalizeOrderSide,
} from "./lib/exchange-orders-contract.mjs";
import {
  encryptSessionPayload,
  decryptSessionPayload,
} from "./lib/exchange-orders-service.mjs";
import { createOrdersAdapter } from "./lib/exchange-orders-adapter.mjs";

describe("exchange-orders contract", () => {
  it("mantém versão e lock", () => {
    assert.equal(EXCHANGE_ORDERS_CONTRACT_VERSION, "exchange-orders-contract-v1");
    assert.equal(EXCHANGE_ORDERS_LOCK, "DO_NOT_PLACE_WITHOUT_CLIENT_SESSION");
  });

  it("valida place LAY", () => {
    const p = validatePlaceOrderBody({
      side: "LAY",
      odd: 36,
      stakeCents: 25000,
      eventId: "123",
      marketId: "m1",
    });
    assert.equal(p.side, "LAY");
    assert.equal(p.odd, 36);
    assert.equal(p.stakeCents, 25000);
  });

  it("rejeita place sem side", () => {
    assert.throws(() => validatePlaceOrderBody({ odd: 2, stakeCents: 100 }), /side/);
  });

  it("valida cancel", () => {
    assert.equal(validateCancelOrderBody({ orderId: "abc" }).orderId, "abc");
  });

  it("normalize side", () => {
    assert.equal(normalizeOrderSide("lay"), "LAY");
    assert.equal(normalizeOrderSide("x"), "");
  });
});

describe("exchange session crypto", () => {
  it("roundtrip encrypt/decrypt", () => {
    const payload = { accessToken: "tok-123", extra: true };
    const blob = encryptSessionPayload(payload);
    const back = decryptSessionPayload(blob);
    assert.equal(back.accessToken, "tok-123");
    assert.equal(back.extra, true);
  });
});

describe("adapter default", () => {
  it("usa demo por defeito", () => {
    const a = createOrdersAdapter();
    assert.equal(a.provider, "demo");
  });

  it("place demo gera orderId", async () => {
    const a = createOrdersAdapter();
    const r = await a.placeOrder(
      { accessToken: "demo" },
      {
        side: "LAY",
        odd: 36,
        stakeCents: 25000,
        eventId: "e1",
        marketId: "m1",
      }
    );
    assert.match(r.orderId, /^demo_/);
    assert.equal(r.demo, true);
    assert.equal(r.status, "matched");
    const st = await a.getOrderStatus({}, r.orderId);
    assert.equal(st.status, "matched");
    const c = await a.cancelOrder({}, r.orderId);
    assert.equal(c.status, "cancelled");
  });
});
