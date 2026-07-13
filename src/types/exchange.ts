export type Sport = "futebol" | "tenis" | "basquete";

export type GameStatus = "LIVE" | "SUSPENDED" | "FINISHED";

export type AlertType =
  | "SCORE_CHANGE"
  | "ODDS_MOVE"
  | "NEW_LIVE"
  | "HIGH_VOLUME"
  | "SUSPENDED";

export type AlertSeverity = "info" | "warning" | "critical";

export interface Score {
  home: number;
  away: number;
}

export interface Selection {
  id: string;
  name: string;
  backOdds: number;
  layOdds: number;
  volume: number;
  prevBackOdds?: number;
}

export interface Market {
  id: string;
  name: string;
  selections: Selection[];
}

export interface LiveGame {
  id: string;
  externalId: string;
  sport: Sport;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  status: GameStatus;
  score: Score;
  minute: number;
  markets: Market[];
  totalVolume: number;
  lastUpdated: string;
}

export interface AlertRule {
  id: string;
  name: string;
  sport?: Sport;
  minOdds?: number;
  maxOdds?: number;
  oddsMovePct?: number;
  minVolume?: number;
  scoreChange: boolean;
  enabled: boolean;
}

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  gameId: string;
  message: string;
  triggeredAt: string;
  acknowledged: boolean;
  metadata?: Record<string, string | number>;
}

export interface LiveUpdate {
  type: "games" | "alert" | "heartbeat";
  games?: LiveGame[];
  alert?: Alert;
  timestamp: string;
}
