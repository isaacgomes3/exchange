import { getBetBraConfig } from "./config";
import { getEventDeepLink } from "./urls";
import type { BetBraEvent, BetBraMarket, BetBraRunner, InplayInfo } from "./types";
import type { GameStatus, LiveGame, Market, Selection, Sport } from "@/types/exchange";

const SPORT_MAP: Record<number, Sport> = {
  15: "futebol",
  9: "tenis",
};

function parseTeams(event: BetBraEvent): { home: string; away: string } {
  const participants = event["event-participants"];
  if (participants && participants.length >= 2) {
    const sorted = [...participants].sort(
      (a, b) => (a.number ?? 0) - (b.number ?? 0)
    );
    return {
      home:
        sorted[0]["participant-name"] ?? sorted[0].name ?? "Casa",
      away:
        sorted[1]["participant-name"] ?? sorted[1].name ?? "Fora",
    };
  }

  const parts = event.name.split(/\s+vs\.?\s+/i);
  if (parts.length >= 2) {
    return { home: parts[0].trim(), away: parts[1].trim() };
  }

  return { home: event.name, away: "—" };
}

function extractCompetition(event: BetBraEvent): string {
  const tags = event["meta-tags"] ?? [];
  for (const tag of tags) {
    if (tag.type === "COMPETITION" || tag.type === "competition") {
      return tag.name ?? "Competição";
    }
    if (tag["meta-tags"]) {
      for (const sub of tag["meta-tags"]) {
        if (sub.name) return sub.name;
      }
    }
    if (tag.name && tag.name !== event.name) {
      return tag.name;
    }
  }
  return "Exchange BetBra";
}

function bestPrice(
  prices: BetBraRunner["prices"],
  side: "back" | "lay"
): { odds: number; amount: number } {
  const filtered = (prices ?? []).filter((p) => p.side === side);
  if (filtered.length === 0) {
    return { odds: 0, amount: 0 };
  }

  if (side === "back") {
    const best = filtered.reduce((a, b) =>
      a["decimal-odds"] > b["decimal-odds"] ? a : b
    );
    return {
      odds: best["decimal-odds"],
      amount: best["available-amount"],
    };
  }

  const best = filtered.reduce((a, b) =>
    a["decimal-odds"] < b["decimal-odds"] ? a : b
  );
  return {
    odds: best["decimal-odds"],
    amount: best["available-amount"],
  };
}

function mapRunner(runner: BetBraRunner, prev?: Selection): Selection {
  const back = bestPrice(runner.prices, "back");
  const lay = bestPrice(runner.prices, "lay");

  return {
    id: runner.id,
    name: runner.name,
    backOdds: back.odds || 0,
    layOdds: lay.odds || back.odds + 0.02,
    volume: runner.volume ?? back.amount + lay.amount,
    prevBackOdds: prev?.backOdds,
  };
}

function findMainMarket(markets: BetBraMarket[]): BetBraMarket | undefined {
  const priority = [
    "one_x_two",
    "match_odds",
    "moneyline",
    "winner",
  ];

  for (const type of priority) {
    const found = markets.find(
      (m) =>
        m["market-type"]?.toLowerCase() === type ||
        m.name.toLowerCase().includes("resultado") ||
        m.name.toLowerCase().includes("match odds") ||
        m.name.toLowerCase().includes("winner") ||
        m.name.toLowerCase().includes("vencedor")
    );
    if (found) return found;
  }

  return markets.find((m) => m.runners && m.runners.length > 0);
}

function mapMarkets(
  markets: BetBraMarket[] | undefined,
  prevMarkets?: Market[]
): Market[] {
  if (!markets || markets.length === 0) return [];

  const main = findMainMarket(markets);
  if (!main || !main.runners) return [];

  const prevSelections = prevMarkets?.[0]?.selections ?? [];

  return [
    {
      id: main.id,
      name: main.name,
      selections: main.runners.map((runner) => {
        const prev = prevSelections.find((s) => s.id === runner.id);
        return mapRunner(runner, prev);
      }),
    },
  ];
}

function mapStatus(
  event: BetBraEvent,
  inplay?: InplayInfo
): GameStatus {
  if (inplay?.status === "IN_PLAY" || event["in-running-flag"]) {
    const mainMarket = findMainMarket(event.markets ?? []);
    if (mainMarket?.status === "suspended") return "SUSPENDED";
    if (event.status === "suspended") return "SUSPENDED";
    return "LIVE";
  }

  if (event.status === "closed" || inplay?.status === "ENDED") {
    return "FINISHED";
  }

  if (event.status === "suspended") return "SUSPENDED";

  return event["in-running-flag"] ? "LIVE" : "FINISHED";
}

function parseMinute(inplay?: InplayInfo): number {
  const raw = inplay?.elapsedRegularTime ?? inplay?.timeElapsed ?? "0";
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseScore(inplay?: InplayInfo): { home: number; away: number } {
  if (inplay?.score) {
    return {
      home: parseInt(inplay.score.home.score, 10) || 0,
      away: parseInt(inplay.score.away.score, 10) || 0,
    };
  }
  return { home: 0, away: 0 };
}

export function mapBetBraEventToLiveGame(
  event: BetBraEvent,
  inplay?: InplayInfo,
  prev?: LiveGame
): LiveGame {
  const teams = parseTeams(event);
  const sport = SPORT_MAP[event["sport-id"]] ?? "futebol";

  return {
    id: event.id,
    externalId: event.id,
    sport,
    competition: extractCompetition(event),
    homeTeam: inplay?.score?.home.name ?? teams.home,
    awayTeam: inplay?.score?.away.name ?? teams.away,
    status: mapStatus(event, inplay),
    score: parseScore(inplay),
    minute: parseMinute(inplay),
    markets: mapMarkets(event.markets, prev?.markets),
    totalVolume: event.volume ?? 0,
    currency: "BRL",
    deepLink: getEventDeepLink(event["sport-id"], event.id),
    lastUpdated: new Date().toISOString(),
  };
}

export function getSportId(sport: Sport): number | null {
  const config = getBetBraConfig();
  if (sport === "futebol") return config.soccerSportId;
  if (sport === "tenis") return config.tennisSportId;
  return null;
}

export function getMonitoredSportIds(): number[] {
  const config = getBetBraConfig();
  return [config.soccerSportId, config.tennisSportId];
}
