import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BETBRA_INPLAY_SYNC_VERSION,
  normalizeInplayItem,
  indexInplayFeed,
  coerceInplayFeed,
  matchEligibleForInplaySync,
  buildMatchInplayPatch,
  buildDesafioStepInplayPatch,
  extractBetbraEventIdFromUrl,
  matchBetbraEventId,
  desafioStepEventId,
  formatElapsedLabel,
  parseScoreSide,
  extractScorePair,
  isLiveStatus,
  inferMatchFinished,
  applyFinishedInference,
} from "./lib/betbra-inplay-sync.mjs";

describe("betbra-inplay-sync", () => {
  it("mantém versão", () => {
    assert.equal(BETBRA_INPLAY_SYNC_VERSION, "betbra-inplay-sync-v8");
  });

  it("não trata status open como ao vivo", () => {
    assert.equal(isLiveStatus("open", ""), false);
    assert.equal(isLiveStatus("InPlay", ""), true);
    assert.equal(isLiveStatus("", "SecondHalf"), true);
    const open = normalizeInplayItem({
      eventId: "1",
      status: "open",
      score: { home: { score: "0" }, away: { score: "0" } },
    });
    assert.equal(open.live, false);
  });

  it("parseia placar em string 0-1", () => {
    const p = extractScorePair({ score: "0-1" });
    assert.equal(p.home, 0);
    assert.equal(p.away, 1);
  });

  it("não grava stub live vazio e limpa stub quebrado", () => {
    const feed = indexInplayFeed([
      { eventId: "42", status: "open" },
    ]);
    const match = {
      id: "m1",
      external_id: "42",
      starts_at: "2026-07-25T16:00:00.000Z",
      metadata: {
        betbra_event_id: "42",
        live: {
          live: true,
          score: null,
          elapsed: null,
          home_score: null,
          away_score: null,
          status: "open",
          match_status: "open",
          finished: false,
        },
      },
    };
    const built = buildMatchInplayPatch(
      match,
      feed,
      "2026-07-25T16:05:00.000Z"
    );
    assert.ok(built);
    assert.equal(built.live, null);
    assert.equal(built.patch.metadata.live, null);
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
      extractBetbraEventIdFromUrl(
        "https://betbra.bet.br/b/exchange/sport/soccer/event/33842537216900023/market/33842554997300023"
      ),
      "33842537216900023"
    );
    assert.equal(
      desafioStepEventId({
        external_bet_link: "https://x/event/123456789012",
      }),
      "123456789012"
    );
  });

  it("coerce envelopes do feed inplay", () => {
    assert.equal(coerceInplayFeed({ events: [{ eventId: "1" }] }).length, 1);
    assert.equal(coerceInplayFeed([{ eventId: "1" }]).length, 1);
    const map = indexInplayFeed({
      data: {
        events: [
          {
            eventId: "42",
            status: "InPlay",
            elapsedRegularTime: "10",
            score: { home: { score: "0" }, away: { score: "1" } },
          },
        ],
      },
    });
    assert.equal(map.get("42")?.scoreLabel, "0-1");
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
    assert.equal(result.slimPatch.final_score_home, 1);
    assert.equal(result.slimPatch.final_score_away, 0);
    assert.ok(!("metadata" in result.slimPatch));
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

  it("infere FT quando feed fica preso no 90'", () => {
    const now = Date.parse("2026-07-25T14:55:00.000Z");
    const step = {
      starts_at: "2026-07-25T13:00:00.000Z",
      status: "live",
      final_score_home: 0,
      final_score_away: 1,
      external_bet_link:
        "https://betbra.bet.br/b/exchange/sport/soccer/event/33842537216900023/market/1",
      metadata: {
        live: {
          score: "0-1",
          elapsed: "90",
          finished: false,
          live: true,
        },
      },
    };
    const info = normalizeInplayItem({
      eventId: "33842537216900023",
      status: "IN_PLAY",
      inPlayMatchStatus: "SecondHalfKickOff",
      elapsedRegularTime: "90",
      score: { home: { score: "0" }, away: { score: "1" } },
    });
    assert.equal(info.finished, false);
    assert.equal(inferMatchFinished(step, info, now), true);
    const inferred = applyFinishedInference(info, step, now);
    assert.equal(inferred.finished, true);
    assert.equal(inferred.live, false);

    const feed = indexInplayFeed([
      {
        eventId: "33842537216900023",
        status: "IN_PLAY",
        inPlayMatchStatus: "SecondHalfKickOff",
        elapsedRegularTime: "90",
        score: { home: { score: "0" }, away: { score: "1" } },
      },
    ]);
    const built = buildDesafioStepInplayPatch(
      step,
      feed,
      "2026-07-25T14:55:00.000Z"
    );
    assert.ok(built);
    assert.equal(built.live.finished, true);
    assert.equal(built.live.live, false);
  });

  it("não engole FT quando etapa vem sem metadata no SELECT", () => {
    const feed = indexInplayFeed([
      {
        eventId: "33842537216900023",
        status: "IN_PLAY",
        inPlayMatchStatus: "SecondHalfKickOff",
        elapsedRegularTime: "90",
        score: { home: { score: "0" }, away: { score: "1" } },
      },
    ]);
    const step = {
      starts_at: "2026-07-25T13:00:00.000Z",
      status: "live",
      final_score_home: 0,
      final_score_away: 1,
      external_bet_link:
        "https://betbra.bet.br/b/exchange/sport/soccer/event/33842537216900023/market/1",
      // sem metadata (como no SELECT da VPS)
    };
    const built = buildDesafioStepInplayPatch(
      step,
      feed,
      "2026-07-25T14:55:00.000Z"
    );
    assert.ok(built, "deve gerar patch para popular cache FT");
    assert.equal(built.live.finished, true);
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

  it("resolve eventId do link BetBra quando external_id é null", () => {
    const match = {
      external_id: null,
      starts_at: "2026-07-25T19:30:00.000Z",
      metadata: {
        source: "betbra_prelive_catalog",
        external_bet_link:
          "https://bolsadeaposta.bet.br/b/exchange/sport/soccer/event/33849379243700023/market/1",
      },
      markets: [{ external_id: "33849379243700023" }],
    };
    assert.equal(matchBetbraEventId(match), "33849379243700023");
    const now = Date.parse("2026-07-25T20:00:00.000Z");
    assert.equal(matchEligibleForInplaySync(match, now), true);

    const feed = indexInplayFeed([
      {
        eventId: "33849379243700023",
        status: "InPlay",
        elapsedRegularTime: "25",
        score: { home: { score: "1" }, away: { score: "0" } },
      },
    ]);
    const built = buildMatchInplayPatch(
      match,
      feed,
      "2026-07-25T20:00:00.000Z"
    );
    assert.ok(built);
    assert.equal(built.live.score, "1-0");
    assert.equal(built.live.elapsed_label, "25'");
    assert.equal(built.patch.external_id, "33849379243700023");
    assert.equal(built.patch.metadata.betbra_event_id, "33849379243700023");
  });
});
