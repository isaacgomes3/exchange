import { NextResponse } from "next/server";
import { searchFootballTeams } from "@/lib/arbishield/football-teams";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = String(searchParams.get("q") || searchParams.get("name") || "").trim();
    if (q.length < 2) {
      return NextResponse.json({
        ok: true,
        teams: [],
        providers: [],
        hint: "Digite pelo menos 2 caracteres",
      });
    }

    const result = await searchFootballTeams(q);
    return NextResponse.json({ ok: true, query: q, ...result });
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
