import { NextResponse } from "next/server";
import { getBetBraConfig } from "@/lib/betbra/config";
import { fetchEvents, fetchInplayInfo } from "@/lib/betbra/client";
import { isLocalProxyAvailable } from "@/lib/betbra/proxy-health";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getBetBraConfig();
  const proxyHealth = config.useLocalProxy
    ? await isLocalProxyAvailable()
    : null;

  const debug: Record<string, unknown> = {
    config: {
      useLocalProxy: config.useLocalProxy,
      localProxyUrl: config.localProxyUrl,
      userAgent: config.userAgent,
      apiBaseUrl: config.apiBaseUrl,
    },
    proxyHealth,
    tests: {} as Record<string, unknown>,
  };

  try {
    const events = await fetchEvents(config.soccerSportId, {
      sortBy: "volume",
      inRunningOnly: false,
    });
    (debug.tests as Record<string, unknown>).events = {
      ok: true,
      total: events.total,
      count: events.events.length,
      inRunning: events.events.filter((e) => e["in-running-flag"]).length,
      sample: events.events.slice(0, 3).map((e) => ({
        id: e.id,
        name: e.name,
        inRunning: e["in-running-flag"],
        volume: e.volume,
      })),
    };
  } catch (error) {
    (debug.tests as Record<string, unknown>).events = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    const inplay = await fetchInplayInfo();
    (debug.tests as Record<string, unknown>).inplay = {
      ok: true,
      count: inplay.length,
      inPlay: inplay.filter((i) => i.status === "IN_PLAY").length,
      sample: inplay
        .filter((i) => i.status === "IN_PLAY")
        .slice(0, 3)
        .map((i) => ({
          eventId: i.eventId,
          status: i.status,
          score: i.score,
          minute: i.elapsedRegularTime ?? i.timeElapsed,
        })),
    };
  } catch (error) {
    (debug.tests as Record<string, unknown>).inplay = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return NextResponse.json(debug);
}
