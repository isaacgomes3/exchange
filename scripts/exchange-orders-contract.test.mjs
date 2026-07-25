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
import {
  createOrdersAdapter,
  buildExchangeAuthHeaders,
  buildExchangePlaceBody,
  EXCHANGE_PUBLIC_TRADING_API,
  BetbraOrdersAdapter,
} from "./lib/exchange-orders-adapter.mjs";

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

describe("public trading API adapter", () => {
  it("marca API pública autenticada", () => {
    assert.equal(EXCHANGE_PUBLIC_TRADING_API, "mexchange-public-trading-api-v1");
    const a = new BetbraOrdersAdapter({ live: false });
    assert.equal(a.publicApi, EXCHANGE_PUBLIC_TRADING_API);
  });

  it("monta Cookie + Bearer (auto/mexchange)", () => {
    const h = buildExchangeAuthHeaders(
      { houseToken: "tok-abc", cookieHeader: "SESSION=abc" },
      "auto"
    );
    assert.equal(h.Authorization, "Bearer tok-abc");
    assert.match(h.Cookie, /SESSION=abc/);
    assert.ok(h.Referer.includes("mexchange"));
  });

  it("monta X-Auth-Token quando style=x-auth-token", () => {
    const h = buildExchangeAuthHeaders(
      { accessToken: "tok-xyz" },
      "x-auth-token"
    );
    assert.equal(h["X-Auth-Token"], "tok-xyz");
  });

  it("body mexchange usa POST /offers shape", () => {
    const b = buildExchangePlaceBody(
      {
        side: "LAY",
        odd: 65,
        stakeCents: 100,
        eventId: "e1",
        marketId: "m1",
        selectionId: "s1",
      },
      "mexchange"
    );
    assert.equal(b["odds-type"], "DECIMAL");
    assert.equal(b["exchange-type"], "back-lay");
    assert.equal(b.offers.length, 1);
    assert.equal(b.offers[0].side, "lay");
    assert.equal(b.offers[0].odds, 65);
    assert.equal(b.offers[0].stake, 1);
    assert.equal(b.offers[0]["runner-id"], "s1");
    assert.equal(b.offers[0]["market-id"], "m1");
  });

  it("body exchange legado inclui side LAY e price", () => {
    const b = buildExchangePlaceBody(
      {
        side: "LAY",
        odd: 2,
        stakeCents: 20000,
        eventId: "e1",
        marketId: "m1",
        selectionId: "s1",
      },
      "exchange"
    );
    assert.equal(b.side, "LAY");
    assert.equal(b.price, 2);
    assert.equal(b.size, 200);
    assert.equal(b.marketId, "m1");
  });
});
