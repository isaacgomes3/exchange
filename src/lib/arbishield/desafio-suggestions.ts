import { fetchEventDetail, fetchEvents } from "@/lib/betbra/client";
import { getBetBraConfig } from "@/lib/betbra/config";
import { scheduleRequest } from "@/lib/betbra/rate-limiter";
import type { BetBraEvent, BetBraMarket, BetBraRunner } from "@/lib/betbra/types";
import { getEventDeepLink } from "@/lib/betbra/urls";
import {
  calcArbiOddFromCasa,
  calcSurebetStakes,
  isOddInRange,
} from "@/lib/arbishield/surebet";

export type DesafioSide =
  | "over_2_5"
  | "under_2_5"
  | "btts_yes"
  | "btts_no";

export type DesafioSuggestion = {
  eventId: string;
  eventName: string;
  homeTeam: string;
  awayTeam: string;
  startsAt: string;
  minutesToKickoff: number;
  league?: string;
  betbraMarketId: string;
  betbraLink: string;
  /** Tipo de mercado: over_under_25 | ambas_marcam */
  marketKind: "over_under_25" | "ambas_marcam";
  /** Lado BetBra (entrada do usuário) */
  casaSide: DesafioSide;
  casaMarketName: string;
  casaOdd: number;
  /** Lado ArbiShield (contrário / surebet) */
  arbiSide: DesafioSide;
  arbiMarketName: string;
  arbiOdd: number;
  profitMarginPct: number;
  casaStakeCents: number;
  arbiStakeCents: number;
  liquidityCents: number;
  rationale: string;
};

/** Janela padrão de busca: próximas 24 horas */
export const DESAFIO_WINDOW_MINUTES = 24 * 60;

export type SuggestionParams = {
  /** Odds BetBra aceitas para entrada */
  casaOddMin?: number;
  casaOddMax?: number;
  /** Margem surebet desejada (%) — default 5 (padrão observado nos desafios) */
  profitMarginPct?: number;
  /** Janela de busca em minutos (default 1440 = 24h) */
  preLiveMinutes?: number;
  /** Liquidez ArbiShield sugerida (centavos) */
  liquidityCents?: number;
  /** @deprecated Mantido por compatibilidade; ignorado (sempre usa janela 24h) */
  fallbackToday?: boolean;
};

function runnerOdd(runner: BetBraRunner): number | null {
  const prices = runner.prices ?? [];
  const backs = prices.filter((p) => p.side === "back");
  if (backs.length) {
    return backs.reduce((a, b) =>
      a["decimal-odds"] > b["decimal-odds"] ? a : b
    )["decimal-odds"];
  }
  const lays = prices.filter((p) => p.side === "lay");
  if (lays.length) {
    return lays.reduce((a, b) =>
      a["decimal-odds"] < b["decimal-odds"] ? a : b
    )["decimal-odds"];
  }
  const last = runner["last-matched-odds"];
  return typeof last === "number" && last > 1 ? last : null;
}

function parseTeams(event: BetBraEvent): { home: string; away: string } {
  const parts = event.name.split(/\s+vs\.?\s+/i);
  if (parts.length >= 2) {
    return { home: parts[0].trim(), away: parts[1].trim() };
  }
  const participants = event["event-participants"];
  if (participants && participants.length >= 2) {
    const sorted = [...participants].sort(
      (a, b) => (a.number ?? 0) - (b.number ?? 0)
    );
    return {
      home: sorted[0]["participant-name"] ?? sorted[0].name ?? "Casa",
      away: sorted[1]["participant-name"] ?? sorted[1].name ?? "Fora",
    };
  }
  return { home: event.name, away: "—" };
}

function isFullMatchMarket(name: string): boolean {
  return !(
    name.includes("1º") ||
    name.includes("1o") ||
    name.includes("1st") ||
    name.includes("half") ||
    name.includes("tempo") ||
    name.includes("intervalo")
  );
}

function isOverUnder25(market: BetBraMarket): boolean {
  const name = (market.name || "").toLowerCase();
  const type = (market["market-type"] || "").toLowerCase();
  if (!isFullMatchMarket(name)) return false;
  const runners = market.runners ?? [];
  const labels = runners.map((r) => (r.name || "").toLowerCase());
  const has25 =
    labels.some((l) => /\b2[.,]5\b/.test(l)) ||
    /\b2[.,]5\b/.test(name) ||
    type.includes("2.5");
  const isOu =
    name.includes("mais/menos") ||
    name.includes("over") ||
    name.includes("under") ||
    name === "total" ||
    type.includes("over_under") ||
    type.includes("total");
  return Boolean(has25 && isOu);
}

/** Ambas Marcam / Both Teams To Score (partida completa). */
function isAmbasMarcam(market: BetBraMarket): boolean {
  const name = (market.name || "").toLowerCase();
  const type = (market["market-type"] || "").toLowerCase();
  if (!isFullMatchMarket(name)) return false;
  if (
    name.includes("ambas") ||
    name.includes("both teams") ||
    name.includes("btts") ||
    type.includes("both_teams") ||
    type.includes("btts") ||
    /\bgg\b/.test(name)
  ) {
    return true;
  }
  const labels = (market.runners ?? []).map((r) => (r.name || "").toLowerCase());
  const hasYesNo =
    labels.some((l) => /^(sim|yes|gg)$/.test(l.trim())) &&
    labels.some((l) => /^(n[aã]o|no|ng)$/.test(l.trim()));
  return hasYesNo && (name.includes("marcam") || name.includes("score"));
}

function classifyOuRunner(name: string): "over_2_5" | "under_2_5" | null {
  const n = name.toLowerCase();
  if (!/\b2[.,]5\b/.test(n) && !n.includes("2.5") && !n.includes("2,5")) {
    return null;
  }
  if (n.includes("mais") || n.includes("over") || n.includes("acima")) {
    return "over_2_5";
  }
  if (n.includes("menos") || n.includes("under") || n.includes("abaixo")) {
    return "under_2_5";
  }
  return null;
}

function classifyBttsRunner(name: string): "btts_yes" | "btts_no" | null {
  const n = name.toLowerCase().trim();
  if (
    n === "sim" ||
    n === "yes" ||
    n === "gg" ||
    n.includes("ambas sim") ||
    n.includes("both teams to score - yes") ||
    /^yes\b/.test(n)
  ) {
    return "btts_yes";
  }
  if (
    n === "nao" ||
    n === "não" ||
    n === "no" ||
    n === "ng" ||
    n.includes("ambas não") ||
    n.includes("ambas nao") ||
    n.includes("both teams to score - no") ||
    /^no\b/.test(n)
  ) {
    return "btts_no";
  }
  return null;
}

function sideLabel(side: DesafioSide): string {
  switch (side) {
    case "over_2_5":
      return "Mais 2.5 gols na partida";
    case "under_2_5":
      return "Menos 2.5 gols na partida";
    case "btts_yes":
      return "Ambas Marcam — Sim";
    case "btts_no":
      return "Ambas Marcam — Não";
  }
}

function opposite(side: DesafioSide): DesafioSide {
  switch (side) {
    case "over_2_5":
      return "under_2_5";
    case "under_2_5":
      return "over_2_5";
    case "btts_yes":
      return "btts_no";
    case "btts_no":
      return "btts_yes";
  }
}

function extractSides(
  market: BetBraMarket,
  kind: "over_under_25" | "ambas_marcam"
): Partial<Record<DesafioSide, number>> {
  const out: Partial<Record<DesafioSide, number>> = {};
  for (const runner of market.runners ?? []) {
    const side =
      kind === "over_under_25"
        ? classifyOuRunner(runner.name || "")
        : classifyBttsRunner(runner.name || "");
    if (!side) continue;
    const odd = runnerOdd(runner);
    if (odd != null) out[side] = Number(odd.toFixed(3));
  }
  return out;
}

type BuildParams = Required<
  Pick<
    SuggestionParams,
    "casaOddMin" | "casaOddMax" | "profitMarginPct" | "liquidityCents"
  >
>;

function buildSuggestion(
  event: BetBraEvent,
  market: BetBraMarket,
  kind: "over_under_25" | "ambas_marcam",
  params: BuildParams
): DesafioSuggestion | null {
  const odds = extractSides(market, kind);
  const sides: DesafioSide[] =
    kind === "over_under_25"
      ? ["over_2_5", "under_2_5"]
      : ["btts_yes", "btts_no"];

  const candidates: Array<{ side: DesafioSide; odd: number }> = [];
  for (const side of sides) {
    const odd = odds[side];
    if (odd != null && isOddInRange(odd, params.casaOddMin, params.casaOddMax)) {
      candidates.push({ side, odd });
    }
  }
  if (!candidates.length) return null;

  const mid = (params.casaOddMin + params.casaOddMax) / 2;
  candidates.sort((a, b) => Math.abs(a.odd - mid) - Math.abs(b.odd - mid));
  const pick = candidates[0];
  const arbiSide = opposite(pick.side);
  const arbiOdd = calcArbiOddFromCasa(pick.odd, params.profitMarginPct);
  if (arbiOdd == null) return null;

  const stakes = calcSurebetStakes({
    casaOdd: pick.odd,
    arbiOdd,
    liquidityCents: params.liquidityCents,
  });
  const teams = parseTeams(event);
  const startsAt = event.start;
  const minutesToKickoff = Math.max(
    0,
    Math.round((new Date(startsAt).getTime() - Date.now()) / 60000)
  );
  const marketLabel =
    kind === "over_under_25" ? "Over/Under 2.5" : "Ambas Marcam";

  return {
    eventId: event.id,
    eventName: event.name,
    homeTeam: teams.home,
    awayTeam: teams.away,
    startsAt,
    minutesToKickoff,
    betbraMarketId: String(market.id),
    betbraLink: `${getEventDeepLink(event["sport-id"], event.id)}/market/${market.id}`,
    marketKind: kind,
    casaSide: pick.side,
    casaMarketName: sideLabel(pick.side),
    casaOdd: pick.odd,
    arbiSide,
    arbiMarketName: sideLabel(arbiSide),
    arbiOdd,
    profitMarginPct: stakes.marginPct,
    casaStakeCents: stakes.casaStakeCents,
    arbiStakeCents: stakes.arbiStakeCents,
    liquidityCents: params.liquidityCents,
    rationale:
      `Entrada BetBra em ${marketLabel}: ${sideLabel(pick.side)} @ ${pick.odd} ` +
      `(faixa ${params.casaOddMin}-${params.casaOddMax}). ` +
      `ArbiShield oferece o contrário (${sideLabel(arbiSide)}) @ ${arbiOdd} com margem ~${stakes.marginPct}% — ` +
      `favorável a liquidar na BetBra e não na ArbiShield.`,
  };
}

/** Extrai sugestões de Over/Under 2.5 e Ambas Marcam do mesmo evento. */
function suggestionsFromEvent(
  event: BetBraEvent,
  params: BuildParams
): DesafioSuggestion[] {
  const out: DesafioSuggestion[] = [];
  const markets = event.markets ?? [];

  const ou = markets.find(isOverUnder25);
  if (ou) {
    const s = buildSuggestion(event, ou, "over_under_25", params);
    if (s) out.push(s);
  }

  const btts = markets.find(isAmbasMarcam);
  if (btts) {
    const s = buildSuggestion(event, btts, "ambas_marcam", params);
    if (s) out.push(s);
  }

  return out;
}

export async function generateDesafioSuggestions(
  params: SuggestionParams = {}
): Promise<{
  suggestions: DesafioSuggestion[];
  scannedEvents: number;
  window: { from: string; to: string; mode: "next_24h" };
  params: Required<SuggestionParams>;
}> {
  const config = getBetBraConfig();
  const resolved: Required<SuggestionParams> = {
    casaOddMin: params.casaOddMin ?? 1.6,
    casaOddMax: params.casaOddMax ?? 1.8,
    profitMarginPct: params.profitMarginPct ?? 5,
    preLiveMinutes: params.preLiveMinutes ?? DESAFIO_WINDOW_MINUTES,
    liquidityCents: params.liquidityCents ?? 200_000,
    fallbackToday: params.fallbackToday ?? true,
  };

  const now = Date.now();
  const windowTo = now + resolved.preLiveMinutes * 60_000;

  async function loadDetails(afterMs: number, beforeMs: number) {
    const list = await scheduleRequest(
      () =>
        fetchEvents(config.soccerSportId, {
          after: Math.floor(afterMs / 1000),
          before: Math.floor(beforeMs / 1000),
          sortBy: "start-time",
          sortDirection: "asc",
        }),
      config.requestSpacingMs
    );

    const events = (list.events ?? []).filter(
      (e) =>
        !e["in-running-flag"] &&
        /vs\.?/i.test(e.name) &&
        new Date(e.start).getTime() >= afterMs &&
        new Date(e.start).getTime() <= beforeMs
    );

    const details: BetBraEvent[] = [];
    for (const e of events) {
      try {
        const detail = await scheduleRequest(
          () => fetchEventDetail(e.id, config.soccerSportId),
          config.requestSpacingMs
        );
        if (detail?.markets?.length) details.push(detail);
      } catch {
        // ignore empty/blocked events
      }
    }
    return details;
  }

  const details = await loadDetails(now, windowTo);
  const suggestions = details
    .flatMap((ev) => {
      try {
        return suggestionsFromEvent(ev, resolved);
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.minutesToKickoff - b.minutesToKickoff);

  return {
    suggestions,
    scannedEvents: details.length,
    window: {
      from: new Date(now).toISOString(),
      to: new Date(windowTo).toISOString(),
      mode: "next_24h",
    },
    params: resolved,
  };
}
