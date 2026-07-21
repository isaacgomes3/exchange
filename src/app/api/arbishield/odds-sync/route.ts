import { NextResponse } from "next/server";
import { syncArbiShieldOddsFromExchange } from "@/lib/arbishield/odds-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sincroniza cotações BetBra (exchange) → matches abertos da ArbiShield.
 * GET/POST /api/arbishield/odds-sync?dryRun=1
 */
export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}

async function run(request: Request) {
  const url = new URL(request.url);
  const dryRun =
    url.searchParams.get("dryRun") === "1" ||
    url.searchParams.get("dry") === "1";

  try {
    const { results, updated } = await syncArbiShieldOddsFromExchange({ dryRun });
    return NextResponse.json({
      ok: true,
      dryRun,
      updated,
      total: results.length,
      results,
    });
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
