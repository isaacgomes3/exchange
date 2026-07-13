import {
  fetchEventDetail,
  fetchEvents,
  fetchInplayInfo,
} from "./client";
import { getBetBraConfig } from "./config";
import { mapBetBraEventToLiveGame, getMonitoredSportIds } from "./mapper";
import type { BetBraFetchError } from "./types";
import { BetBraFetchError as BetBraError } from "./types";
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

export async function pollLiveGames(
  previousGames: Map<string, LiveGame>
): Promise<PollResult> {
  const lastPollAt = new Date().toISOString();

  try {
    const sportIds = getMonitoredSportIds();
    const allEvents = [];

    for (const sportId of sportIds) {
      const response = await fetchEvents(sportId, {
        sortBy: "volume",
        inRunningOnly: true,
      });
      allEvents.push(...response.events);
    }

    if (allEvents.length === 0) {
      for (const sportId of sportIds) {
        const response = await fetchEvents(sportId, { sortBy: "volume" });
        const liveCandidates = response.events.filter(
          (e) => e["in-running-flag"] || e["allow-live-betting"]
        );
        allEvents.push(...liveCandidates.slice(0, 10));
      }
    }

    const inplayList = await fetchInplayInfo();
    const inplayMap = new Map(
      inplayList.map((item) => [item.eventId, item])
    );

    const games: LiveGame[] = [];

    for (const event of allEvents) {
      let detailed = event;

      if (event["in-running-flag"] || inplayMap.has(event.id)) {
        try {
          detailed = await fetchEventDetail(event.id, event["sport-id"]);
        } catch {
          detailed = event;
        }
      }

      const prev = previousGames.get(event.id);
      const inplay = inplayMap.get(event.id);
      const game = mapBetBraEventToLiveGame(detailed, inplay, prev);

      if (game.status === "LIVE" || game.status === "SUSPENDED") {
        games.push(game);
      }
    }

    games.sort((a, b) => b.totalVolume - a.totalVolume);

    return {
      games,
      status: "connected",
      lastPollAt,
    };
  } catch (error) {
    const err = error as BetBraFetchError;
    const status: BetBraConnectionStatus =
      err instanceof BetBraError && err.code === "BLOCKED"
        ? "blocked"
        : "error";

    return {
      games: [],
      status,
      error: err.message ?? "Erro ao consultar BetBra",
      lastPollAt,
    };
  }
}

export function getPollIntervalMs(): number {
  return getBetBraConfig().pollIntervalMs;
}
