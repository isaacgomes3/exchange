/**
 * Qual botão liquida cada etapa: Bateu ArbiShield, Bateu Casa ou Empate Anula.
 *
 * Mesma leitura de mercado do card do cliente (`desafio-dnb-flag-v1`): Empate
 * Anula é aposta no time, com estorno se der empate. É sugestão para o admin
 * conferir — nada aqui liquida nada.
 */
export const SETTLE_SUGGEST_VERSION = "desafio-settle-suggest-v1";

const DNB_RE = /\bempate\s*anula(?:do|da)?\b|\bdraw\s*no\s*bet\b|\bdnb\b/;

export function normMarketLabel(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function teamNameTokens(s) {
  return normMarketLabel(s)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(
      (t) =>
        t.length >= 3 && !/^(fc|sc|ac|cf|the|de|do|da|dos|das|del|la|el|club)$/.test(t)
    );
}

export function namesOverlap(a, b) {
  const ta = teamNameTokens(a);
  const tb = teamNameTokens(b);
  for (const x of ta) {
    for (const y of tb) {
      if (x === y) return true;
      if (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x))) return true;
      if (x.length >= 5 && y.length >= 5) {
        let pref = 0;
        while (pref < x.length && pref < y.length && x[pref] === y[pref]) pref += 1;
        if (pref >= 5) return true;
      }
    }
  }
  return false;
}

/** "home" | "away" | null — em qual time o mercado aposta. */
export function marketTeamSide(name, teams) {
  const pick = normMarketLabel(name).replace(DNB_RE, " ").trim();
  if (!pick) return null;
  const onHome = namesOverlap(pick, teams?.homeTeam || "");
  const onAway = namesOverlap(pick, teams?.awayTeam || "");
  if (onHome === onAway) return null;
  return onHome ? "home" : "away";
}

/** "win" | "lose" | "void" | "pending" | null para um mercado. */
export function marketStatus(name, home, away, finished, teams) {
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  const n = normMarketLabel(name);
  if (!n) return null;

  if (/ambas/.test(n) || /both teams/.test(n) || /\bbtts\b/.test(n)) {
    const both = home > 0 && away > 0;
    const isNo = /\bnao\b/.test(n) || /\bno\b/.test(n);
    if (both) return isNo ? "lose" : "win";
    if (finished) return isNo ? "win" : "lose";
    return "pending";
  }

  if (DNB_RE.test(n)) {
    if (!finished) return "pending";
    if (home === away) return "void";
    const side = marketTeamSide(n, teams);
    if (!side) return null;
    if (side === "home") return home > away ? "win" : "lose";
    return away > home ? "win" : "lose";
  }

  const total = home + away;
  const over = n.match(/(acima|over|mais de)\s*(\d+(?:[.,]\d+)?)/);
  if (over) {
    const line = parseFloat(String(over[2]).replace(",", "."));
    if (!Number.isFinite(line)) return null;
    if (total > line) return "win";
    return finished ? "lose" : "pending";
  }
  const under = n.match(/(abaixo|under|menos de)\s*(\d+(?:[.,]\d+)?)/);
  if (under) {
    const line = parseFloat(String(under[2]).replace(",", "."));
    if (!Number.isFinite(line)) return null;
    if (total > line) return "lose";
    if (finished) return total < line ? "win" : "lose";
    return "pending";
  }

  const isDraw = (/\bempate\b/.test(n) || /\bdraw\b/.test(n)) && !/ambas/.test(n);
  const isHome = /\bvitoria (da )?casa\b/.test(n) || /\bmandante\b/.test(n);
  const isAway = /\bvitoria (do )?fora\b/.test(n) || /\bvisitante\b/.test(n);
  if (isDraw || isHome || isAway) {
    if (!finished) return "pending";
    if (isDraw) return home === away ? "win" : "lose";
    if (isHome) return home > away ? "win" : "lose";
    return away > home ? "win" : "lose";
  }
  return null;
}

/**
 * Botão sugerido para a etapa.
 * `winningSide`: "arbishield" | "casa" | "empate_anula" | null (indefinido)
 */
export function suggestSettle({
  marketArbi,
  marketCasa,
  home,
  away,
  finished,
  homeTeam,
  awayTeam,
} = {}) {
  const teams = { homeTeam, awayTeam };
  const arbi = marketStatus(marketArbi, home, away, finished, teams);
  const casa = marketStatus(marketCasa, home, away, finished, teams);

  if (!finished) {
    return { winningSide: null, label: "aguardar", reason: "jogo não encerrado", arbi, casa };
  }
  if (arbi === "void" || casa === "void") {
    return {
      winningSide: "empate_anula",
      label: "Empate Anula",
      reason: "empate no mercado Empate Anula — devolve a entrada",
      arbi,
      casa,
    };
  }
  if (arbi === "win" && casa === "lose") {
    return {
      winningSide: "arbishield",
      label: "Bateu ArbiShield",
      reason: "mercado da ArbiShield venceu",
      arbi,
      casa,
    };
  }
  if (casa === "win" && arbi === "lose") {
    return {
      winningSide: "casa",
      label: "Bateu Casa",
      reason: "mercado da casa venceu",
      arbi,
      casa,
    };
  }
  return {
    winningSide: null,
    label: "conferir",
    reason:
      arbi == null || casa == null
        ? "mercado não reconhecido — conferir no bilhete"
        : `resultado ambíguo (arbi=${arbi}, casa=${casa})`,
    arbi,
    casa,
  };
}
