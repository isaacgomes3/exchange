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

function classifyError(error: unknown): {
  status: BetBraConnectionStatus;
  message: string;
} {
  if (error instanceof BetBraFetchError) {
    if (error.code === "BLOCKED") {
      return { status: "blocked", message: error.message };
    }
    if (error.message.includes("Proxy local não está rodando")) {
      return { status: "error", message: error.message };
    }
    return { status: "error", message: error.message };
  }

  const message =
    error instanceof Error ? error.message : "Erro ao consultar BetBra";
  return { status: "error", message };
}

export async function pollLiveGames(
  previousGames: Map<string, LiveGame>
): Promise<PollResult> {
  const lastPollAt = new Date().toISOString();

  const proxyOk = await isLocalProxyAvailable();
  if (!proxyOk) {
    return {
      games: [],
      status: "error",
      error: getLocalProxyErrorMessage(),
      lastPollAt,
    };
  }

  let lastBlocked: BetBraFetchError | null = null;
  let hadSuccess = false;

  try {
    const sportIds = getMonitoredSportIds();
    let inplayList: InplayInfo[] = [];

    try {
      inplayList = await fetchInplayInfo();
      hadSuccess = true;
    } catch (error) {
      if (error instanceof BetBraFetchError && error.code === "BLOCKED") {
        lastBlocked = error;
      }
    }

    const inplayMap = new Map(
      inplayList
        .filter((item) => item.status === "IN_PLAY")
        .map((item) => [item.eventId, item])
    );

    const allEvents: BetBraEvent[] = [];

    for (const sportId of sportIds) {
      try {
        const response = await fetchEvents(sportId, { sortBy: "volume", inRunningOnly: true });
        allEvents.push(...response.events);
        hadSuccess = true;
      } catch (error) {
        if (error instanceof BetBraFetchError && error.code === "BLOCKED") {
          lastBlocked = error;
        }
      }
    }

    if (allEvents.length === 0) {
      for (const sportId of sportIds) {
        try {
          const response = await fetchEvents(sportId, { sortBy: "volume", inRunningOnly: false });
          const candidates = response.events.filter(
            (e) =>
              e["in-running-flag"] ||
              e["allow-live-betting"] ||
              inplayMap.has(e.id)
          );
          allEvents.push(...candidates.slice(0, 20));
          if (candidates.length > 0) hadSuccess = true;
        } catch (error) {
          if (error instanceof BetBraFetchError && error.code === "BLOCKED") {
            lastBlocked = error;
          }
        }
      }
    }

    if (!hadSuccess && lastBlocked) {
      return {
        games: [],
        status: "blocked",
        error: lastBlocked.message,
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
      let detailed = event;

      if (event["in-running-flag"] || inplayMap.has(event.id)) {
        try {
          detailed = await fetchEventDetail(event.id, event["sport-id"]);
          hadSuccess = true;
        } catch {
          detailed = event;
        }
      }

      const prev = previousGames.get(event.id);
      const inplay = inplayMap.get(event.id);
      const game = mapBetBraEventToLiveGame(detailed, inplay, prev);

      if (
        game.status === "LIVE" ||
        game.status === "SUSPENDED" ||
        inplayMap.has(event.id)
      ) {
        if (inplayMap.has(event.id) && game.status === "FINISHED") {
          game.status = "LIVE";
        }
        games.push(game);
      }
    }

    games.sort((a, b) => b.totalVolume - a.totalVolume);

    if (games.length === 0) {
      return {
        games: [],
        status: "connected",
        error: "Nenhum jogo ao vivo no momento na BetBra",
        lastPollAt,
      };
    }

    return {
      games,
      status: "connected",
      lastPollAt,
    };
  } catch (error) {
    const { status, message } = classifyError(error);
    return {
      games: [],
      status,
      error: message,
      lastPollAt,
    };
  }
}

export function getPollIntervalMs(): number {
  return getBetBraConfig().pollIntervalMs;
}
