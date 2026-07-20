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
  __retried?: boolean;
  adminId?: string;
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

async function createMatchFromMarket(body: CreateMatchBody) {
  const odd = Number(body.odd);
  if (!Number.isFinite(odd) || odd <= 1) {
    throw new Error("Odd inválida");
  }

  const admin = adminClient();
  const liquidityCents = Number(body.liquidityCents ?? 200_000);
  const marketLabel = body.runnerName
    ? `${body.marketName} · ${body.runnerName}`
    : body.marketName;
  const eventExternalId = String(body.eventId);
  const betbraMarketId = String(body.marketId);

  const newMarket = {
    id: crypto.randomUUID(),
    name: marketLabel,
    odd,
    liquidity: liquidityCents,
    display_liquidity: null,
    used_liquidity: 0,
    market_type: "LAY" as const,
    external_id: betbraMarketId,
  };

  const { data: existingRows } = await admin
    .from("matches")
    .select(
      "id,home_team,away_team,markets,max_protection_cents,used_protection_cents,is_published"
    )
    .eq("external_id", eventExternalId)
    .is("deleted_at", null)
    .limit(1);

  const existing = existingRows?.[0];

  if (existing?.id) {
    const markets = Array.isArray(existing.markets) ? existing.markets : [];
    const dup = markets.find(
      (m: { external_id?: string; name?: string }) =>
        String(m.external_id || "") === betbraMarketId ||
        String(m.name || "").toLowerCase() === marketLabel.toLowerCase()
    );
    if (dup) {
      const err = new Error(
        `Este mercado já está cadastrado em ${existing.home_team} vs ${existing.away_team}.`
      );
      (err as Error & { status?: number }).status = 409;
      throw err;
    }

    const nextMarkets = [...markets, newMarket];
    const nextMax = nextMarkets.reduce(
      (sum, m) => sum + Number((m as { liquidity?: number }).liquidity || 0),
      0
    );

    const { data: updated, error } = await admin
      .from("matches")
      .update({
        markets: nextMarkets,
        max_protection_cents: nextMax,
        updated_by: body.adminId || null,
        metadata: {
          external_bet_link: body.betbraLink,
          external_bet_name: "BetBra",
          external_bet_logo: "https://betbra.bet.br/favicon.ico",
          market_id: body.marketId,
          runner_id: body.runnerId || null,
          source: "betbra_prelive_catalog",
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("id,home_team,away_team,league,starts_at,is_published,markets")
      .single();

    if (error) throw new Error(error.message);
    return { action: "market_added" as const, match: updated };
  }

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
    external_id: eventExternalId,
    score_sync_enabled: false,
    has_live_stream: false,
    created_by: body.adminId || null,
    updated_by: body.adminId || null,
    metadata: {
      external_bet_link: body.betbraLink,
      external_bet_name: "BetBra",
      external_bet_logo: "https://betbra.bet.br/favicon.ico",
      market_id: body.marketId,
      runner_id: body.runnerId || null,
      source: "betbra_prelive_catalog",
    },
    markets: [newMarket],
  };

  const { data, error } = await admin
    .from("matches")
    .insert(row)
    .select("id,home_team,away_team,league,starts_at,is_published,markets")
    .single();

  if (error) {
    const msg = error.message || "Erro ao criar jogo";
    if (
      !body.__retried &&
      (msg.includes("matches_external_id_key") ||
        msg.toLowerCase().includes("duplicate key"))
    ) {
      return createMatchFromMarket({ ...body, __retried: true });
    }
    throw new Error(msg);
  }

  return { action: "created" as const, match: data };
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

  const auth = request.headers.get("authorization") || "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1];
  let adminId: string | null = null;
  if (bearer) {
    try {
      const parts = bearer.split(".");
      if (parts.length >= 2) {
        const json = Buffer.from(
          parts[1].replace(/-/g, "+").replace(/_/g, "/"),
          "base64"
        ).toString("utf8");
        const payload = JSON.parse(json) as { sub?: string };
        adminId = payload.sub ? String(payload.sub) : null;
      }
    } catch {
      adminId = null;
    }
  }
  if (!adminId) {
    return NextResponse.json(
      { ok: false, error: "Login admin necessário para lançar evento" },
      { status: 401 }
    );
  }

  try {
    const result = await createMatchFromMarket({ ...body, adminId });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      (err as Error & { status?: number }).status ||
      (message.includes("já está cadastrado") ? 409 : 500);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
