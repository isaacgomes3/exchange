import { NextResponse } from "next/server";
import { generateDesafioSuggestions } from "@/lib/arbishield/desafio-suggestions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sugestões automáticas de desafio (surebet BetBra ↔ ArbiShield).
 * GET/POST /api/arbishield/desafio-suggestions
 *
 * Query/body:
 *   casaOddMin, casaOddMax, profitMarginPct, preLiveMinutes,
 *   liquidityCents, fallbackToday
 */
export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}

async function run(request: Request) {
  const url = new URL(request.url);
  let body: Record<string, unknown> = {};
  if (request.method === "POST") {
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
  }

  const num = (key: string, fallback?: number) => {
    const raw = url.searchParams.get(key) ?? body[key];
    if (raw === undefined || raw === null || raw === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };
  const bool = (key: string, fallback: boolean) => {
    const raw = url.searchParams.get(key) ?? body[key];
    if (raw === undefined || raw === null || raw === "") return fallback;
    if (typeof raw === "boolean") return raw;
    return raw === "1" || raw === "true";
  };

  try {
    const result = await generateDesafioSuggestions({
      casaOddMin: num("casaOddMin", 1.6),
      casaOddMax: num("casaOddMax", 1.8),
      profitMarginPct: num("profitMarginPct", 5),
      preLiveMinutes: num("preLiveMinutes", 30),
      liquidityCents: num("liquidityCents", 200_000),
      fallbackToday: bool("fallbackToday", true),
    });
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
