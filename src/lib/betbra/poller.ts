import { getBetBraConfig } from "./config";
import {
  fetchEventDetail,
  fetchEvents,
  fetchInplayInfo,
} from "./client";
import { mapBetBraEventToLiveGame, getMonitoredSportIds } from "./mapper";
import {
  getLocalProxyErrorMessage,
  isLocalProxyAvailable,
} from "./proxy-health";
import type { BetBraEvent, InplayInfo } from "./types";
import { BetBraFetchError } from "./types";
import type { LiveGame } from "@/types/exchange";

export type BetBraConnectionStatus =
  | "idle"
  | "polling"
  | "connected"
  | "blocked"
  | "error";

export interface PollResult {
  games: LiveGame[];
  status: BetBraConnectionStatus;
  error?: string;
  lastPollAt: string;
}

function trackBlocked(
  error: unknown,
  current: BetBraFetchError | null
): BetBraFetchError | null {
  if (error instanceof BetBraFetchError && error.code === "BLOCKED") {
    return error;
  }
  return current;
}

export async function pollLiveGames(
  previousGames: Map<string, LiveGame>
): Promise<PollResult> {
  const lastPollAt = new Date().toISOString();
  const config = getBetBraConfig();

  if (config.useLocalProxy) {
    const proxyOk = await isLocalProxyAvailable();
    if (!proxyOk) {
      return {
        games: [],
        status: "error",
        error: getLocalProxyErrorMessage(),
        lastPollAt,
      };
    }
  }

  let blockedError: BetBraFetchError | null = null;
  let eventsReachable = false;
  let inplayReachable = false;

  try {
    const sportIds = getMonitoredSportIds();
    let inplayList: InplayInfo[] = [];

    try {
      inplayList = await fetchInplayInfo();
      inplayReachable = true;
    } catch (error) {
      blockedError = trackBlocked(error, blockedError);
    }

    const inplayMap = new Map(
      inplayList
        .filter((item) => item.status === "IN_PLAY")
        .map((item) => [item.eventId, item])
    );

    const allEvents: BetBraEvent[] = [];

    for (const sportId of sportIds) {
      try {
        const response = await fetchEvents(sportId, {
          sortBy: "volume",
          inRunningOnly: true,
        });
        allEvents.push(...response.events);
        eventsReachable = true;
      } catch (error) {
        blockedError = trackBlocked(error, blockedError);
      }
    }

    if (allEvents.length === 0) {
      for (const sportId of sportIds) {
        try {
          const response = await fetchEvents(sportId, {
            sortBy: "volume",
            inRunningOnly: false,
          });
          const candidates = response.events.filter(
            (e) =>
              e["in-running-flag"] ||
              e["allow-live-betting"] ||
              inplayMap.has(e.id)
          );
          allEvents.push(...candidates.slice(0, 30));
          eventsReachable = true;
        } catch (error) {
          blockedError = trackBlocked(error, blockedError);
        }
      }
    }

    if (!eventsReachable && !inplayReachable && blockedError) {
      return {
        games: [],
        status: "blocked",
        error: blockedError.message,
        lastPollAt,
      };
    }

    if (!eventsReachable && blockedError && allEvents.length === 0 && inplayMap.size === 0) {
      return {
        games: [],
        status: "blocked",
        error: blockedError.message,
        lastPollAt,
      };
    }

    for (const [eventId, inplay] of inplayMap) {
      if (!allEvents.find((e) => e.id === eventId)) {
        allEvents.push({
          id: eventId,
          name: `${inplay.score?.home.name ?? "Casa"} vs ${inplay.score?.away.name ?? "Fora"}`,
          start: new Date().toISOString(),
          status: "open",
          "sport-id": 15,
          volume: 0,
          "in-running-flag": true,
          markets: [],
        });
      }
    }

    const games: LiveGame[] = [];

    for (const event of allEvents) {
      const inplay = inplayMap.get(event.id);
      const isLiveCandidate =
        event["in-running-flag"] ||
        inplayMap.has(event.id) ||
        event["allow-live-betting"];

      if (!isLiveCandidate) continue;

      let detailed = event;
      if (event["in-running-flag"] || inplayMap.has(event.id)) {
        try {
          detailed = await fetchEventDetail(event.id, event["sport-id"]);
        } catch {
          detailed = event;
        }
      }

      const prev = previousGames.get(event.id);
      const game = mapBetBraEventToLiveGame(detailed, inplay, prev);

      if (inplayMap.has(event.id)) {
        game.status = "LIVE";
      }

      if (
        game.status === "LIVE" ||
        game.status === "SUSPENDED" ||
        inplayMap.has(event.id) ||
        event["in-running-flag"]
      ) {
        games.push(game);
      }
    }

    games.sort((a, b) => b.totalVolume - a.totalVolume);

    if (games.length === 0) {
      const message = eventsReachable || inplayReachable
        ? "Nenhum jogo ao vivo no momento na BetBra"
        : blockedError?.message ?? "Não foi possível carregar jogos";

      return {
        games: [],
        status: eventsReachable || inplayReachable ? "connected" : "blocked",
        error: message,
        lastPollAt,
      };
    }

    return {
      games,
      status: "connected",
      lastPollAt,
    };
  } catch (error) {
    if (error instanceof BetBraFetchError && error.code === "BLOCKED") {
      return {
        games: [],
        status: "blocked",
        error: error.message,
        lastPollAt,
      };
    }

    const message =
      error instanceof Error ? error.message : "Erro ao consultar BetBra";
    return {
      games: [],
      status: "error",
      error: message,
      lastPollAt,
    };
  }
}

export function getPollIntervalMs(): number {
  return getBetBraConfig().pollIntervalMs;
}
