import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BETBRA_EVENTS_RADAR_VERSION,
  coerceEventsRadarFeed,
  normalizeEventsRadarItem,
  summarizeEventsRadarFeed,
  buildMradarWidgetUrl,
  resolveSoft2BetHost,
  eventsRadarUrlForSite,
  resolveMradarForEventId,
} from "./lib/betbra-events-radar.mjs";

describe("betbra-events-radar", () => {
  it("mantém versão", () => {
    assert.equal(BETBRA_EVENTS_RADAR_VERSION, "betbra-events-radar-v2");
  });

  it("resolve host Soft2Bet a partir do link", () => {
    assert.equal(
      resolveSoft2BetHost("https://bolsadeaposta.bet.br/event/123"),
      "bolsadeaposta.bet.br"
    );
    assert.equal(
      resolveSoft2BetHost("https://mexchange.betbra.bet.br/exchange"),
      "betbra.bet.br"
    );
  });

  it("monta URL eventsRadar por marca", () => {
    assert.equal(
      eventsRadarUrlForSite("https://bolsadeaposta.bet.br/x"),
      "https://bolsadeaposta.bet.br/client/api/jumper/feedSports/inplayInfo/eventsRadar"
    );
  });

  it("normaliza item com eventIdMbook + StatsPerform", () => {
    const n = normalizeEventsRadarItem({
      eventIdMbook: "33874869253600023",
      eventIdStatsPerform: "1234567",
      extra: true,
    });
    assert.equal(n.eventIdMbook, "33874869253600023");
    assert.equal(n.eventIdStatsPerform, "1234567");
    assert.ok(n.rawKeys.includes("eventIdStatsPerform"));
  });

  it("resume feed array", () => {
    const s = summarizeEventsRadarFeed([
      { eventIdMbook: "1", eventIdStatsPerform: "a" },
      { eventIdMbook: "2", eventIdStatsPerform: "b" },
      { eventIdMbook: "3" },
    ]);
    assert.equal(s.count, 3);
    assert.equal(s.withStatsPerform, 2);
    assert.equal(s.sample.length, 3);
  });

  it("coerce envelope", () => {
    assert.equal(
      coerceEventsRadarFeed({ data: [{ eventIdMbook: "9" }] }).length,
      1
    );
  });

  it("resolve mradar por eventId", () => {
    const r = resolveMradarForEventId(
      "111",
      [{ eventIdMbook: "111", eventIdStatsPerform: "999" }],
      "https://bolsadeaposta.bet.br/event/111"
    );
    assert.equal(r.found, true);
    assert.equal(
      r.mradarUrl,
      "https://bolsadeaposta.bet.br/widget/mradar?id=999"
    );
  });

  it("monta URL do widget mradar", () => {
    assert.equal(
      buildMradarWidgetUrl("999", "https://betbra.bet.br/widget/mradar"),
      "https://betbra.bet.br/widget/mradar?id=999"
    );
    assert.equal(buildMradarWidgetUrl(""), null);
  });
});
