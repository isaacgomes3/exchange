import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BETBRA_INPLAY_SYNC_VERSION,
  normalizeInplayItem,
  indexInplayFeed,
  matchEligibleForInplaySync,
  buildMatchInplayPatch,
  buildDesafioStepInplayPatch,
  extractBetbraEventIdFromUrl,
  desafioStepEventId,
  formatElapsedLabel,
  parseScoreSide,
} from "./lib/betbra-inplay-sync.mjs";

describe("betbra-inplay-sync", () => {
  it("mantém versão", () => {
    assert.equal(BETBRA_INPLAY_SYNC_VERSION, "betbra-inplay-sync-v2");
  });

  it("extrai eventId de links BetBra", () => {
    assert.equal(
      extractBetbraEventIdFromUrl(
        "https://betbra.bet.br/x?eventId=33874869253600023"
      ),
      "33874869253600023"
    );
    assert.equal(
      extractBetbraEventIdFromUrl(
        "https://betbra.bet.br/cliente/event/33874869253600023/market/1"
      ),
      "33874869253600023"
    );
    assert.equal(
      desafioStepEventId({
        external_bet_link: "https://x/event/123456789012",
      }),
      "123456789012"
    );
  });

  it("gera patch de etapa desafio", () => {
    const feed = indexInplayFeed([
      {
        eventId: "33874869253600023",
        status: "InPlay",
        elapsedRegularTime: "33",
        score: { home: { score: "1" }, away: { score: "0" } },
      },
    ]);
    const result = buildDesafioStepInplayPatch(
      {
        external_bet_link:
          "https://betbra.bet.br/event/33874869253600023",
        metadata: {},
      },
      feed,
      "2026-07-25T20:00:00.000Z"
    );
    assert.ok(result);
    assert.equal(result.live.score, "1-0");
    assert.equal(result.patch.final_score_home, 1);
    assert.equal(result.patch.final_score_away, 0);
  });

  it("parseia placar e minuto", () => {
    assert.equal(parseScoreSide("2"), 2);
    assert.equal(parseScoreSide({ score: "1" }), 1);
    assert.equal(formatElapsedLabel("67"), "67'");
    assert.equal(formatElapsedLabel("45+2"), "45+2'");
    assert.equal(formatElapsedLabel("12'"), "12'");
  });

  it("normaliza item inplay", () => {
    const n = normalizeInplayItem({
      eventId: "999",
      status: "InPlay",
      inPlayMatchStatus: "SecondHalf",
      elapsedRegularTime: "67",
      score: { home: { score: "1" }, away: { score: "0" } },
    });
    assert.equal(n.eventId, "999");
    assert.equal(n.homeScore, 1);
    assert.equal(n.awayScore, 0);
    assert.equal(n.scoreLabel, "1-0");
    assert.equal(n.elapsedLabel, "67'");
    assert.equal(n.live, true);
    assert.equal(n.finished, false);
  });

  it("detecta finished", () => {
    const n = normalizeInplayItem({
      eventId: "1",
      status: "Finished",
      score: { home: { score: "2" }, away: { score: "1" } },
    });
    assert.equal(n.finished, true);
    assert.equal(n.live, false);
    assert.equal(n.scoreLabel, "2-1");
  });

  it("elegibilidade por source BetBra e janela", () => {
    const now = Date.parse("2026-07-25T20:00:00.000Z");
    const ok = matchEligibleForInplaySync(
      {
        external_id: "ev1",
        starts_at: "2026-07-25T19:30:00.000Z",
        score_sync_enabled: false,
        metadata: { source: "betbra_prelive_catalog" },
      },
      now
    );
    assert.equal(ok, true);

    const tooEarly = matchEligibleForInplaySync(
      {
        external_id: "ev1",
        starts_at: "2026-07-25T22:00:00.000Z",
        metadata: { source: "betbra_prelive_catalog" },
      },
      now
    );
    assert.equal(tooEarly, false);
  });

  it("gera patch a partir do feed", () => {
    const feed = indexInplayFeed([
      {
        eventId: "42",
        status: "InPlay",
        elapsedRegularTime: "12",
        score: { home: { score: "0" }, away: { score: "0" } },
      },
    ]);
    const result = buildMatchInplayPatch(
      {
        external_id: "42",
        metadata: { source: "betbra_prelive_catalog" },
        status_v2: "open",
      },
      feed,
      "2026-07-25T20:00:00.000Z"
    );
    assert.ok(result);
    assert.equal(result.live.score, "0-0");
    assert.equal(result.live.elapsed_label, "12'");
    assert.equal(result.patch.status_v2, "live");
    assert.equal(result.patch.metadata.live.source, "betbra_inplay");
  });
});
