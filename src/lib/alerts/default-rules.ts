import type { AlertRule } from "@/types/exchange";

export const DEFAULT_ALERT_RULES: AlertRule[] = [
  {
    id: "rule-1",
    name: "Gol marcado",
    scoreChange: true,
    enabled: true,
  },
  {
    id: "rule-2",
    name: "Movimento de odds > 10%",
    oddsMovePct: 10,
    scoreChange: false,
    enabled: true,
  },
  {
    id: "rule-3",
    name: "Volume alto (> £300k)",
    minVolume: 300000,
    scoreChange: false,
    enabled: true,
  },
  {
    id: "rule-4",
    name: "Odds acima de 5.0",
    minOdds: 5.0,
    scoreChange: false,
    enabled: true,
  },
];
