import { NextResponse } from "next/server";
import { getLiveGames, getBetBraStatus, startBetBraPoller } from "@/lib/exchange/store";

export const dynamic = "force-dynamic";

export async function GET() {
  startBetBraPoller();
  const games = getLiveGames();
  const betbraStatus = getBetBraStatus();
  return NextResponse.json({
    games,
    betbraStatus,
    timestamp: new Date().toISOString(),
  });
}
