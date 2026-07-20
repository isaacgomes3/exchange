import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateMatchBody = {
  eventId: string;
  sportId: number;
  homeTeam: string;
  awayTeam: string;
  league: string;
  startsAt: string;
  marketId: string;
  marketName: string;
  runnerId?: string;
  runnerName?: string;
  odd: number;
  betbraLink: string;
  liquidityCents?: number;
  isPublished?: boolean;
};

function adminClient() {
  const url =
    process.env.ARBISHIELD_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL;
  const key =
    process.env.ARBISHIELD_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase admin não configurado");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Cria match ArbiShield a partir de mercado BetBra selecionado.
 * POST /api/arbishield/matches
 */
export async function POST(request: Request) {
  let body: CreateMatchBody;
  try {
    body = (await request.json()) as CreateMatchBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "JSON inválido" },
      { status: 400 }
    );
  }

  const required: (keyof CreateMatchBody)[] = [
    "eventId",
    "sportId",
    "homeTeam",
    "awayTeam",
    "league",
    "startsAt",
    "marketId",
    "marketName",
    "odd",
    "betbraLink",
  ];
  for (const key of required) {
    if (body[key] === undefined || body[key] === null || body[key] === "") {
      return NextResponse.json(
        { ok: false, error: `Campo obrigatório: ${key}` },
        { status: 400 }
      );
    }
  }

  const odd = Number(body.odd);
  if (!Number.isFinite(odd) || odd <= 1) {
    return NextResponse.json(
      { ok: false, error: "Odd inválida" },
      { status: 400 }
    );
  }

  const liquidityCents = Number(body.liquidityCents ?? 200_000);
  const marketLabel = body.runnerName
    ? `${body.marketName} · ${body.runnerName}`
    : body.marketName;
  const marketId = crypto.randomUUID();

  const row = {
    home_team: body.homeTeam,
    away_team: body.awayTeam,
    league: body.league,
    starts_at: new Date(body.startsAt).toISOString(),
    status: "open",
    status_v2: "open",
    is_published: Boolean(body.isPublished),
    sport_type: "futebol",
    max_protection_cents: liquidityCents,
    used_protection_cents: 0,
    protection_odds: { home: odd, away: odd },
    external_id: String(body.eventId),
    score_sync_enabled: false,
    has_live_stream: false,
    metadata: {
      external_bet_link: body.betbraLink,
      external_bet_name: "BetBra",
      external_bet_logo: "https://betbra.bet.br/favicon.ico",
      market_id: body.marketId,
      runner_id: body.runnerId || null,
      source: "betbra_prelive_catalog",
    },
    markets: [
      {
        id: marketId,
        name: marketLabel,
        odd,
        liquidity: liquidityCents,
        display_liquidity: null,
        used_liquidity: 0,
        market_type: "LAY",
        external_id: String(body.marketId),
      },
    ],
  };

  try {
    const admin = adminClient();
    const { data, error } = await admin
      .from("matches")
      .insert(row)
      .select("id,home_team,away_team,league,starts_at,is_published,markets")
      .single();

    if (error) {
      const msg = error.message || "Erro ao criar jogo";
      const status = msg.includes("duplicate") ? 409 : 500;
      return NextResponse.json({ ok: false, error: msg }, { status });
    }

    return NextResponse.json({ ok: true, match: data });
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
