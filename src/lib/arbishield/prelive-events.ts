import { fetchEventDetail, fetchEvents } from "@/lib/betbra/client";
import { getBetBraConfig } from "@/lib/betbra/config";
import { getEventDeepLink } from "@/lib/betbra/urls";
import type { BetBraEvent, BetBraMarket, BetBraRunner } from "@/lib/betbra/types";

export type PreliveEventSummary = {
  eventId: string;
  eventName: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  startsAt: string;
  minutesToKickoff: number;
  sportId: number;
  betbraLink: string;
};

export type PreliveMarketRunner = {
  runnerId: string;
  name: string;
  odd: number | null;
};

export type PreliveMarket = {
  marketId: string;
  name: string;
  marketType?: string;
  status?: string;
  runners: PreliveMarketRunner[];
};

export type PreliveDayResult = {
  events: PreliveEventSummary[];
  window: { from: string; to: string; timezone: string };
  total: number;
};

function endOfDaySaoPaulo(from = Date.now()): number {
  const brDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(from));
  return Date.parse(`${brDay}T23:59:59.999-03:00`);
}

function parseTeams(event: BetBraEvent): { home: string; away: string } {
  const participants = event["event-participants"];
  if (participants && participants.length >= 2) {
    const sorted = [...participants].sort(
      (a, b) => (a.number ?? 0) - (b.number ?? 0)
    );
    return {
      home: sorted[0]["participant-name"] ?? sorted[0].name ?? "Casa",
      away: sorted[1]["participant-name"] ?? sorted[1].name ?? "Fora",
    };
  }
  const parts = event.name.split(/\s+vs\.?\s+/i);
  if (parts.length >= 2) {
    return { home: parts[0].trim(), away: parts[1].trim() };
  }
  return { home: event.name, away: "—" };
}

function extractLeague(event: BetBraEvent): string {
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
    if (tag.name && tag.name !== event.name) return tag.name;
  }
  return "Exchange BetBra";
}

function runnerBackOdd(runner: BetBraRunner): number | null {
  const prices = runner.prices ?? [];
  const backs = prices
    .filter((p) => String(p.side || "").toLowerCase() === "back")
    .map((p) => Number(p["decimal-odds"] ?? p.odds))
    .filter((n) => Number.isFinite(n) && n > 1);
  if (backs.length) {
    return Number(Math.max(...backs).toFixed(3));
  }
  const lays = prices
    .filter((p) => String(p.side || "").toLowerCase() === "lay")
    .map((p) => Number(p["decimal-odds"] ?? p.odds))
    .filter((n) => Number.isFinite(n) && n > 1);
  if (lays.length) {
    return Number(Math.min(...lays).toFixed(3));
  }
  const last = runner["last-matched-odds"];
  return typeof last === "number" && last > 1 ? Number(last.toFixed(3)) : null;
}

function mapMarket(market: BetBraMarket): PreliveMarket | null {
  const runners = (market.runners ?? [])
    .map((runner) => ({
      runnerId: String(runner.id),
      name: runner.name || "—",
      odd: runnerBackOdd(runner),
    }))
    .filter((r) => r.name !== "—");

  if (!runners.length) return null;

  return {
    marketId: String(market.id),
    name: market.name || "Mercado",
    marketType: market["market-type"] || market.type,
    status: market.status,
    runners,
  };
}

function toSummary(event: BetBraEvent): PreliveEventSummary | null {
  if (event["in-running-flag"]) return null;
  if (!/vs\.?/i.test(event.name)) return null;

  const startMs = new Date(event.start).getTime();
  if (!Number.isFinite(startMs) || startMs < Date.now()) return null;

  const teams = parseTeams(event);
  return {
    eventId: String(event.id),
    eventName: event.name,
    homeTeam: teams.home,
    awayTeam: teams.away,
    league: extractLeague(event),
    startsAt: event.start,
    minutesToKickoff: Math.max(
      0,
      Math.round((startMs - Date.now()) / 60_000)
    ),
    sportId: event["sport-id"],
    betbraLink: getEventDeepLink(event["sport-id"], event.id),
  };
}

export async function listPreliveEventsForDay(): Promise<PreliveDayResult> {
  const config = getBetBraConfig();
  const now = Date.now();
  const end = endOfDaySaoPaulo(now);
  const after = Math.floor(now / 1000);
  const before = Math.floor(end / 1000);

  const response = await fetchEvents(config.soccerSportId, {
    sortBy: "start-time",
    sortDirection: "asc",
    after,
    before,
  });

  const events = (response.events ?? [])
    .map(toSummary)
    .filter((e): e is PreliveEventSummary => e !== null)
    .sort(
      (a, b) =>
        new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
    );

  return {
    events,
    total: events.length,
    window: {
      from: new Date(now).toISOString(),
      to: new Date(end).toISOString(),
      timezone: "America/Sao_Paulo",
    },
  };
}

export async function getPreliveEventMarkets(
  eventId: string,
  sportId?: number
): Promise<{
  event: PreliveEventSummary;
  markets: PreliveMarket[];
}> {
  const config = getBetBraConfig();
  const sid = sportId ?? config.soccerSportId;
  const detail = await fetchEventDetail(eventId, sid);
  const summary = toSummary(detail);
  if (!summary) {
    throw new Error("Evento indisponível ou já iniciado");
  }

  const markets = (detail.markets ?? [])
    .map(mapMarket)
    .filter((m): m is PreliveMarket => m !== null)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return { event: summary, markets };
}

export function buildBetbraMarketLink(
  sportId: number,
  eventId: string,
  marketId: string
): string {
  return `${getEventDeepLink(sportId, eventId)}/market/${marketId}`;
}
