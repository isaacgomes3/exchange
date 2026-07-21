import { NextResponse } from "next/server";
import {
  getPreliveEventMarkets,
  listPreliveEventsForDay,
} from "@/lib/arbishield/prelive-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Jogos pré-live do dia (BetBra).
 * GET /api/arbishield/prelive-events
 * GET /api/arbishield/prelive-events?eventId=...&sportId=...
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const eventId = url.searchParams.get("eventId");

  try {
    if (eventId) {
      const sportId = url.searchParams.get("sportId");
      const result = await getPreliveEventMarkets(
        eventId,
        sportId ? Number(sportId) : undefined
      );
      return NextResponse.json({ ok: true, ...result });
    }

    const result = await listPreliveEventsForDay();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
