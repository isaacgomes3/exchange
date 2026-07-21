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
  /** Lado BetBra (entrada do usuário) */
  casaSide: "over_2_5" | "under_2_5";
  casaMarketName: string;
  casaOdd: number;
  /** Lado ArbiShield (contrário / surebet) */
  arbiSide: "over_2_5" | "under_2_5";
  arbiMarketName: string;
  arbiOdd: number;
  profitMarginPct: number;
  casaStakeCents: number;
  arbiStakeCents: number;
  liquidityCents: number;
  rationale: string;
};

export type SuggestionParams = {
  /** Odds BetBra aceitas para entrada */
  casaOddMin?: number;
  casaOddMax?: number;
  /** Margem surebet desejada (%) — default 5 (padrão observado nos desafios) */
  profitMarginPct?: number;
  /** Janela pré-live em minutos */
  preLiveMinutes?: number;
  /** Liquidez ArbiShield sugerida (centavos) */
  liquidityCents?: number;
  /** Incluir restante do dia se a janela de 30 min estiver vazia */
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

function isOverUnder25(market: BetBraMarket): boolean {
  const name = (market.name || "").toLowerCase();
  const type = (market["market-type"] || "").toLowerCase();
  // Só partida completa (exclui 1º tempo / 1st half)
  if (
    name.includes("1º") ||
    name.includes("1o") ||
    name.includes("1st") ||
    name.includes("half") ||
    name.includes("tempo") ||
    name.includes("intervalo")
  ) {
    return false;
  }
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

function classifyRunner(
  name: string
): "over_2_5" | "under_2_5" | null {
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

function sideLabel(side: "over_2_5" | "under_2_5"): string {
  return side === "over_2_5"
    ? "Mais 2.5 gols na partida"
    : "Menos 2.5 gols na partida";
}

function endOfDayInTimeZone(nowMs: number, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const day = fmt.format(new Date(nowMs)); // YYYY-MM-DD no fuso
  // 23:59:59.999 no fuso → aproximar via Date com offset BR (-03)
  // Usamos varredura até +3h além da meia-noite local convertida.
  const noonUtcGuess = Date.parse(`${day}T12:00:00Z`);
  // Descobrir offset do fuso nesse dia
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
  }).formatToParts(new Date(noonUtcGuess));
  const tzName = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-3";
  const m = tzName.match(/GMT([+-]\d+)(?::(\d+))?/i);
  let offsetMin = -180;
  if (m) {
    const h = Number(m[1]);
    const mins = Number(m[2] || 0);
    offsetMin = h * 60 + Math.sign(h || 1) * mins;
  }
  // meia-noite local = day 00:00 local = UTC - offset
  const startLocalUtc = Date.parse(`${day}T00:00:00Z`) - offsetMin * 60_000;
  return startLocalUtc + 24 * 60 * 60 * 1000 - 1;
}

function opposite(
  side: "over_2_5" | "under_2_5"
): "over_2_5" | "under_2_5" {
  return side === "over_2_5" ? "under_2_5" : "over_2_5";
}

function extractOu25(
  market: BetBraMarket
): Partial<Record<"over_2_5" | "under_2_5", number>> {
  const out: Partial<Record<"over_2_5" | "under_2_5", number>> = {};
  for (const runner of market.runners ?? []) {
    const side = classifyRunner(runner.name || "");
    if (!side) continue;
    const odd = runnerOdd(runner);
    if (odd != null) out[side] = Number(odd.toFixed(3));
  }
  return out;
}

function suggestionFromEvent(
  event: BetBraEvent,
  params: Required<
    Pick<
      SuggestionParams,
      | "casaOddMin"
      | "casaOddMax"
      | "profitMarginPct"
      | "liquidityCents"
    >
  >
): DesafioSuggestion | null {
  const market = (event.markets ?? []).find(isOverUnder25);
  if (!market) return null;
  const odds = extractOu25(market);
  const candidates: Array<{
    side: "over_2_5" | "under_2_5";
    odd: number;
  }> = [];
  for (const side of ["over_2_5", "under_2_5"] as const) {
    const odd = odds[side];
    if (odd != null && isOddInRange(odd, params.casaOddMin, params.casaOddMax)) {
      candidates.push({ side, odd });
    }
  }
  if (!candidates.length) return null;

  // Prefer odd closest to mid of range (mais estável / “linha”)
  const mid = (params.casaOddMin + params.casaOddMax) / 2;
  candidates.sort(
    (a, b) => Math.abs(a.odd - mid) - Math.abs(b.odd - mid)
  );
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

  return {
    eventId: event.id,
    eventName: event.name,
    homeTeam: teams.home,
    awayTeam: teams.away,
    startsAt,
    minutesToKickoff,
    betbraMarketId: String(market.id),
    betbraLink: `${getEventDeepLink(event["sport-id"], event.id)}/market/${market.id}`,
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
      `Entrada BetBra em ${sideLabel(pick.side)} @ ${pick.odd} (faixa ${params.casaOddMin}-${params.casaOddMax}). ` +
      `ArbiShield oferece o contrário (${sideLabel(arbiSide)}) @ ${arbiOdd} com margem ~${stakes.marginPct}% — ` +
      `favorável a liquidar na BetBra e não na ArbiShield.`,
  };
}

export async function generateDesafioSuggestions(
  params: SuggestionParams = {}
): Promise<{
  suggestions: DesafioSuggestion[];
  scannedEvents: number;
  window: { from: string; to: string; mode: "prelive_30m" | "today_fallback" };
  params: Required<SuggestionParams>;
}> {
  const config = getBetBraConfig();
  const resolved: Required<SuggestionParams> = {
    casaOddMin: params.casaOddMin ?? 1.6,
    casaOddMax: params.casaOddMax ?? 1.8,
    profitMarginPct: params.profitMarginPct ?? 5,
    preLiveMinutes: params.preLiveMinutes ?? 30,
    liquidityCents: params.liquidityCents ?? 200_000,
    fallbackToday: params.fallbackToday ?? true,
  };

  const now = Date.now();
  const preliveTo = now + resolved.preLiveMinutes * 60_000;
  // "Hoje" em America/Sao_Paulo (fim do dia local BR)
  const endOfDay = endOfDayInTimeZone(now, "America/Sao_Paulo");

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

  let mode: "prelive_30m" | "today_fallback" = "prelive_30m";
  let details = await loadDetails(now, preliveTo);
  let suggestions = details
    .map((ev) => extractSuggestionSafe(ev, resolved))
    .filter((s): s is DesafioSuggestion => Boolean(s));

  if (!suggestions.length && resolved.fallbackToday) {
    mode = "today_fallback";
    details = await loadDetails(now, endOfDay);
    suggestions = details
      .map((ev) => extractSuggestionSafe(ev, resolved))
      .filter((s): s is DesafioSuggestion => Boolean(s));
  }

  suggestions.sort((a, b) => a.minutesToKickoff - b.minutesToKickoff);

  return {
    suggestions,
    scannedEvents: details.length,
    window: {
      from: new Date(now).toISOString(),
      to: new Date(
        mode === "prelive_30m" ? preliveTo : endOfDay
      ).toISOString(),
      mode,
    },
    params: resolved,
  };
}

function extractSuggestionSafe(
  event: BetBraEvent,
  params: Required<
    Pick<
      SuggestionParams,
      "casaOddMin" | "casaOddMax" | "profitMarginPct" | "liquidityCents"
    >
  >
): DesafioSuggestion | null {
  try {
    return suggestionFromEvent(event, params);
  } catch {
    return null;
  }
}
