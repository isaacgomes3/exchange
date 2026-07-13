import type {
  Alert,
  AlertRule,
  AlertSeverity,
  AlertType,
  LiveGame,
  Selection,
} from "@/types/exchange";

let alertCounter = 0;

function createAlert(
  type: AlertType,
  severity: AlertSeverity,
  game: LiveGame,
  message: string,
  metadata?: Record<string, string | number>
): Alert {
  alertCounter += 1;
  return {
    id: `alert-${alertCounter}-${Date.now()}`,
    type,
    severity,
    gameId: game.id,
    message,
    triggeredAt: new Date().toISOString(),
    acknowledged: false,
    metadata,
  };
}

function getMainSelection(game: LiveGame): Selection | undefined {
  return game.markets[0]?.selections[0];
}

export function evaluateGameUpdate(
  prev: LiveGame | undefined,
  current: LiveGame,
  rules: AlertRule[]
): Alert[] {
  const alerts: Alert[] = [];
  const enabledRules = rules.filter((r) => r.enabled);

  if (!prev) {
    if (current.status === "LIVE") {
      alerts.push(
        createAlert(
          "NEW_LIVE",
          "info",
          current,
          `Novo jogo ao vivo: ${current.homeTeam} vs ${current.awayTeam}`,
          { competition: current.competition }
        )
      );
    }
    return alerts;
  }

  if (
    prev.score.home !== current.score.home ||
    prev.score.away !== current.score.away
  ) {
    const scoreRule = enabledRules.find((r) => r.scoreChange);
    if (scoreRule) {
      alerts.push(
        createAlert(
          "SCORE_CHANGE",
          "critical",
          current,
          `GOL! ${current.homeTeam} ${current.score.home}-${current.score.away} ${current.awayTeam} (${current.minute}')`,
          {
            home: current.score.home,
            away: current.score.away,
            minute: current.minute,
          }
        )
      );
    }
  }

  if (prev.status !== "SUSPENDED" && current.status === "SUSPENDED") {
    alerts.push(
      createAlert(
        "SUSPENDED",
        "warning",
        current,
        `Mercado suspenso: ${current.homeTeam} vs ${current.awayTeam}`,
        { reason: "VAR ou evento importante" }
      )
    );
  }

  if (prev.status === "SUSPENDED" && current.status === "LIVE") {
    alerts.push(
      createAlert(
        "NEW_LIVE",
        "info",
        current,
        `Mercado reaberto: ${current.homeTeam} vs ${current.awayTeam}`
      )
    );
  }

  for (const rule of enabledRules) {
    if (rule.sport && rule.sport !== current.sport) continue;

    if (rule.minVolume && current.totalVolume >= rule.minVolume) {
      const alreadyHigh = prev.totalVolume >= rule.minVolume;
      if (!alreadyHigh) {
        alerts.push(
          createAlert(
            "HIGH_VOLUME",
            "info",
            current,
            `Volume alto em ${current.homeTeam} vs ${current.awayTeam}: £${(current.totalVolume / 1000).toFixed(0)}k`,
            { volume: current.totalVolume }
          )
        );
      }
    }

    for (const market of current.markets) {
      for (const selection of market.selections) {
        const prevSelection = prev.markets
          .flatMap((m) => m.selections)
          .find((s) => s.id === selection.id);

        if (!prevSelection) continue;

        if (rule.oddsMovePct && prevSelection.backOdds > 0) {
          const movePct =
            Math.abs(
              (selection.backOdds - prevSelection.backOdds) /
                prevSelection.backOdds
            ) * 100;

          if (movePct >= rule.oddsMovePct) {
            const direction =
              selection.backOdds > prevSelection.backOdds ? "subiu" : "caiu";
            alerts.push(
              createAlert(
                "ODDS_MOVE",
                "warning",
                current,
                `Odds ${direction} ${movePct.toFixed(1)}% — ${selection.name} @ ${selection.backOdds.toFixed(2)} (${current.homeTeam} vs ${current.awayTeam})`,
                {
                  selection: selection.name,
                  movePct: Math.round(movePct * 10) / 10,
                  odds: selection.backOdds,
                }
              )
            );
          }
        }

        if (rule.minOdds && selection.backOdds >= rule.minOdds) {
          const wasBelow = prevSelection.backOdds < rule.minOdds;
          if (wasBelow) {
            alerts.push(
              createAlert(
                "ODDS_MOVE",
                "info",
                current,
                `Odds acima de ${rule.minOdds}: ${selection.name} @ ${selection.backOdds.toFixed(2)} (${current.homeTeam} vs ${current.awayTeam})`,
                { selection: selection.name, odds: selection.backOdds }
              )
            );
          }
        }
      }
    }
  }

  return alerts;
}

export function formatGameLabel(game: LiveGame): string {
  return `${game.homeTeam} vs ${game.awayTeam}`;
}

export { getMainSelection };
