import { fetchEventDetail } from "@/lib/betbra/client";
import { getBetBraConfig } from "@/lib/betbra/config";
import { scheduleRequest } from "@/lib/betbra/rate-limiter";
import type { BetBraEvent, BetBraMarket, BetBraRunner } from "@/lib/betbra/types";
import {
  layLabelToScoreline,
  parseBetBraLink,
  sportSlugToId,
} from "@/lib/arbishield/betbra-link";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type ArbiMatchMarket = {
  id: string;
  name: string;
  odd: number;
  liquidity?: number;
  used_liquidity?: number;
  display_liquidity?: number | null;
  market_type?: string;
  external_id?: string | null;
  settled_outcome?: string;
  settled_at?: string;
  settled_by?: string;
  [key: string]: unknown;
};

export type ArbiMatchRow = {
  id: string;
  home_team: string;
  away_team: string;
  status: string;
  protection_odds: { home?: number; away?: number };
  markets: ArbiMatchMarket[] | null;
  metadata: {
    external_bet_link?: string;
    [key: string]: unknown;
  } | null;
  sport_type?: string | null;
};

export type OddsSyncResult = {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  eventId: string | null;
  marketName: string | null;
  oldOdd: number | null;
  newOdd: number | null;
  status: "updated" | "unchanged" | "skipped" | "error";
  reason?: string;
};

function bestSideOdds(
  runner: BetBraRunner,
  side: "back" | "lay"
): number | null {
  const prices = (runner.prices ?? []).filter((p) => p.side === side);
  if (prices.length > 0) {
    if (side === "lay") {
      return prices.reduce((a, b) =>
        a["decimal-odds"] < b["decimal-odds"] ? a : b
      )["decimal-odds"];
    }
    return prices.reduce((a, b) =>
      a["decimal-odds"] > b["decimal-odds"] ? a : b
    )["decimal-odds"];
  }
  const last = runner["last-matched-odds"];
  return typeof last === "number" && last > 1 ? last : null;
}

function findMarket(
  event: BetBraEvent,
  marketId: string | null
): BetBraMarket | undefined {
  const markets = event.markets ?? [];
  if (marketId) {
    const byId = markets.find((m) => String(m.id) === String(marketId));
    if (byId) return byId;
  }
  return (
    markets.find(
      (m) =>
        (m["market-type"] || "").toLowerCase() === "correct_score" ||
        (m.name || "").toLowerCase().includes("placar")
    ) || markets[0]
  );
}

function findRunnerOdd(
  market: BetBraMarket,
  arbiMarketName: string,
  preferSide: "lay" | "back"
): number | null {
  const runners = market.runners ?? [];
  const scoreline = layLabelToScoreline(arbiMarketName);

  let runner: BetBraRunner | undefined;
  if (scoreline) {
    runner = runners.find(
      (r) =>
        (r.name || "").replace(/\s/g, "") === scoreline ||
        (r.name || "").replace(/\s/g, "") === scoreline.replace("-", "x") ||
        (r.name || "").replace(/[x×]/gi, "-") === scoreline
    );
  } else {
    // e.g. Lay Goleada Casa — fuzzy match on remaining tokens
    const token = arbiMarketName.replace(/^lay\s+/i, "").trim().toLowerCase();
    runner = runners.find((r) => (r.name || "").toLowerCase().includes(token));
  }

  if (!runner) return null;

  return (
    bestSideOdds(runner, preferSide) ??
    bestSideOdds(runner, preferSide === "lay" ? "back" : "lay")
  );
}

export function extractOddForArbiMarket(
  event: BetBraEvent,
  betLink: string | null | undefined,
  arbiMarket: ArbiMatchMarket
): { odd: number; betbraMarketId: string } | null {
  const ref = parseBetBraLink(betLink);
  if (!ref) return null;
  const market = findMarket(event, ref.marketId);
  if (!market) return null;

  const preferSide =
    (arbiMarket.market_type || "LAY").toUpperCase() === "BACK" ? "back" : "lay";
  const odd = findRunnerOdd(market, arbiMarket.name, preferSide);
  if (odd == null || odd <= 1) return null;

  return { odd: Number(odd.toFixed(3)), betbraMarketId: String(market.id) };
}

function getArbiShieldAdmin(): SupabaseClient {
  const url =
    process.env.ARBISHIELD_SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.ARBISHIELD_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error(
      "Defina ARBISHIELD_SUPABASE_URL + ARBISHIELD_SERVICE_ROLE_KEY (ou NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)"
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function loadOpenMatches(admin: SupabaseClient): Promise<ArbiMatchRow[]> {
  const { data, error } = await admin
    .from("matches")
    .select(
      "id, home_team, away_team, status, protection_odds, markets, metadata, sport_type"
    )
    .eq("status", "open")
    .is("deleted_at", null)
    .order("starts_at", { ascending: true });

  if (error) throw new Error(`matches query: ${error.message}`);
  return (data ?? []) as ArbiMatchRow[];
}

export async function syncArbiShieldOddsFromExchange(options?: {
  dryRun?: boolean;
  adminId?: string;
}): Promise<{ results: OddsSyncResult[]; updated: number }> {
  const dryRun = options?.dryRun ?? false;
  const admin = getArbiShieldAdmin();
  const matches = await loadOpenMatches(admin);
  const config = getBetBraConfig();
  const results: OddsSyncResult[] = [];
  let updated = 0;

  // Cache event details by id
  const eventCache = new Map<string, BetBraEvent>();

  async function getEvent(eventId: string, sportId: number): Promise<BetBraEvent> {
    const cached = eventCache.get(eventId);
    if (cached) return cached;
    const detail = await scheduleRequest(
      () => fetchEventDetail(eventId, sportId),
      config.requestSpacingMs
    );
    eventCache.set(eventId, detail);
    return detail;
  }

  for (const match of matches) {
    const link = match.metadata?.external_bet_link ?? null;
    const ref = parseBetBraLink(link);
    const primary = (match.markets ?? [])[0] ?? null;

    if (!ref || !primary) {
      results.push({
        matchId: match.id,
        homeTeam: match.home_team,
        awayTeam: match.away_team,
        eventId: ref?.eventId ?? null,
        marketName: primary?.name ?? null,
        oldOdd: primary?.odd ?? null,
        newOdd: null,
        status: "skipped",
        reason: !ref ? "sem link BetBra" : "sem markets",
      });
      continue;
    }

    try {
      const sportId = sportSlugToId(ref.sportSlug);
      const event = await getEvent(ref.eventId, sportId || config.soccerSportId);
      const extracted = extractOddForArbiMarket(event, link, primary);

      if (!extracted) {
        results.push({
          matchId: match.id,
          homeTeam: match.home_team,
          awayTeam: match.away_team,
          eventId: ref.eventId,
          marketName: primary.name,
          oldOdd: primary.odd,
          newOdd: null,
          status: "skipped",
          reason: "cotação não encontrada no evento BetBra",
        });
        continue;
      }

      const oldOdd = Number(primary.odd);
      const newOdd = extracted.odd;
      if (Math.abs(oldOdd - newOdd) < 0.001) {
        results.push({
          matchId: match.id,
          homeTeam: match.home_team,
          awayTeam: match.away_team,
          eventId: ref.eventId,
          marketName: primary.name,
          oldOdd,
          newOdd,
          status: "unchanged",
        });
        continue;
      }

      const nextMarkets = (match.markets ?? []).map((m, idx) => {
        if (idx !== 0 && m.id !== primary.id) return m;
        return {
          ...m,
          odd: newOdd,
          external_id: extracted.betbraMarketId,
        };
      });

      const nextProtection = {
        home: newOdd,
        away: newOdd,
      };

      if (!dryRun) {
        const { error: updErr } = await admin
          .from("matches")
          .update({
            markets: nextMarkets,
            protection_odds: nextProtection,
            updated_at: new Date().toISOString(),
          })
          .eq("id", match.id);

        if (updErr) throw new Error(updErr.message);

        await admin.from("match_odds_history").insert({
          match_id: match.id,
          admin_id:
            options?.adminId ??
            process.env.ARBISHIELD_SYNC_ADMIN_ID ??
            "9f8fadcb-face-4620-bbd6-e56722695822",
          old_odds: match.protection_odds ?? { home: oldOdd, away: oldOdd },
          new_odds: nextProtection,
        });
      }

      updated += 1;
      results.push({
        matchId: match.id,
        homeTeam: match.home_team,
        awayTeam: match.away_team,
        eventId: ref.eventId,
        marketName: primary.name,
        oldOdd,
        newOdd,
        status: "updated",
      });
    } catch (err) {
      results.push({
        matchId: match.id,
        homeTeam: match.home_team,
        awayTeam: match.away_team,
        eventId: ref.eventId,
        marketName: primary.name,
        oldOdd: primary.odd,
        newOdd: null,
        status: "error",
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { results, updated };
}
