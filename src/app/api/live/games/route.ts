import { NextResponse } from "next/server";
import { getLiveGames, startSimulator } from "@/lib/exchange/store";

export const dynamic = "force-dynamic";

export async function GET() {
  startSimulator();
  const games = getLiveGames();
  return NextResponse.json({ games, timestamp: new Date().toISOString() });
}
