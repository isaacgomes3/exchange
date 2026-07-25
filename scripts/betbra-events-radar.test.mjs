import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BETBRA_EVENTS_RADAR_VERSION,
  coerceEventsRadarFeed,
  normalizeEventsRadarItem,
  summarizeEventsRadarFeed,
  buildMradarWidgetUrl,
} from "./lib/betbra-events-radar.mjs";

describe("betbra-events-radar", () => {
  it("mantém versão", () => {
    assert.equal(BETBRA_EVENTS_RADAR_VERSION, "betbra-events-radar-v1");
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

  it("monta URL do widget mradar", () => {
    assert.equal(
      buildMradarWidgetUrl("999", "https://betbra.bet.br/widget/mradar"),
      "https://betbra.bet.br/widget/mradar?id=999"
    );
    assert.equal(buildMradarWidgetUrl(""), null);
  });
});
