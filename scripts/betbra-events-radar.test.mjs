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
  normalizeSportRadarMatchId,
  pickMradarWidgetId,
} from "./lib/betbra-events-radar.mjs";

describe("betbra-events-radar", () => {
  it("mantém versão", () => {
    assert.equal(BETBRA_EVENTS_RADAR_VERSION, "betbra-events-radar-v4");
  });

  it("normaliza URN SportRadar", () => {
    assert.equal(
      normalizeSportRadarMatchId("sr:sport_event:71770176"),
      "sr:match:71770176"
    );
    assert.equal(
      normalizeSportRadarMatchId("sr:match:71770176"),
      "sr:match:71770176"
    );
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

  it("normaliza item com SportRadar sem StatsPerform", () => {
    const n = normalizeEventsRadarItem({
      eventIdMbook: "33842537216900023",
      eventIdSportRadar: "sr:sport_event:67817764",
    });
    assert.equal(n.eventIdMbook, "33842537216900023");
    assert.equal(n.eventIdStatsPerform, null);
    assert.equal(n.eventIdSportRadar, "sr:match:67817764");
  });

  it("prefere StatsPerform, senão SportRadar URN", () => {
    assert.equal(
      pickMradarWidgetId({
        eventIdStatsPerform: "99",
        eventIdSportRadar: "sr:match:1",
      }).source,
      "statsPerform"
    );
    const sr = pickMradarWidgetId({
      eventIdStatsPerform: null,
      eventIdSportRadar: "sr:sport_event:72082946",
    });
    assert.equal(sr.source, "sportRadar");
    assert.equal(sr.id, "sr:match:72082946");
  });

  it("resolve mradar por SportRadar URN quando StatsPerform falta", () => {
    const r = resolveMradarForEventId(
      "33842537216900023",
      [
        {
          eventIdMbook: "33842537216900023",
          eventIdSportRadar: "sr:sport_event:67817764",
        },
      ],
      "https://betbra.bet.br/event/33842537216900023"
    );
    assert.equal(r.found, true);
    assert.equal(r.widgetIdSource, "sportRadar");
    assert.equal(
      r.mradarUrl,
      "https://betbra.bet.br/widget/mradar?id=sr%3Amatch%3A67817764"
    );
    assert.equal(r.mradarUrlCandidates[0], r.mradarUrl);
  });

  it("resume feed array", () => {
    const s = summarizeEventsRadarFeed([
      { eventIdMbook: "1", eventIdStatsPerform: "a" },
      { eventIdMbook: "2", eventIdSportRadar: "sr:sport_event:9" },
      { eventIdMbook: "3" },
    ]);
    assert.equal(s.count, 3);
    assert.equal(s.withStatsPerform, 1);
    assert.equal(s.withSportRadar, 1);
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
