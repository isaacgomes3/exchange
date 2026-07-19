export interface BetBraPrice {
  currency?: string;
  odds: number;
  side: "back" | "lay";
  "available-amount": number;
  "odds-type"?: string;
  "decimal-odds": number;
  "exchange-type"?: string;
}

export interface BetBraRunner {
  id: string;
  name: string;
  prices?: BetBraPrice[];
  volume?: number;
  status?: string;
  "last-matched-odds"?: number;
  "last-price-update-time"?: string;
  "event-id"?: string;
  "market-id"?: string;
}

export interface BetBraMarket {
  id: string;
  name: string;
  type?: string;
  "market-type"?: string;
  status?: string;
  volume?: number;
  runners?: BetBraRunner[];
}

export interface BetBraParticipant {
  id?: string;
  name?: string;
  number?: number;
  "participant-name"?: string;
}

export interface BetBraMetaTag {
  id?: number;
  name?: string;
  type?: string;
  "meta-tags"?: BetBraMetaTag[];
}

export interface BetBraEvent {
  id: string;
  name: string;
  start: string;
  status: string;
  "sport-id": number;
  volume: number;
  "in-running-flag": boolean;
  "allow-live-betting"?: boolean;
  "event-participants"?: BetBraParticipant[];
  markets?: BetBraMarket[];
  "meta-tags"?: BetBraMetaTag[];
  "category-id"?: number;
}

export interface BetBraEventsResponse {
  offset: number;
  "per-page": number;
  total: number;
  lastUpdated?: string;
  events: BetBraEvent[];
}

export interface InplayScoreSide {
  name: string;
  score: string;
  halfTimeScore?: string;
}

export interface InplayInfo {
  eventId: string;
  status: string;
  inPlayMatchStatus?: string;
  elapsedRegularTime?: string;
  timeElapsed?: string;
  score?: {
    home: InplayScoreSide;
    away: InplayScoreSide;
  };
}

export type BetBraFetchErrorCode =
  | "BLOCKED"
  | "RATE_LIMITED"
  | "HTTP_ERROR"
  | "NETWORK_ERROR"
  | "INVALID_JSON";

export class BetBraFetchError extends Error {
  constructor(
    message: string,
    public readonly code: BetBraFetchErrorCode,
    public readonly status?: number,
    public readonly url?: string
  ) {
    super(message);
    this.name = "BetBraFetchError";
  }
}

export interface ConnectivityTestResult {
  ok: boolean;
  endpoint: string;
  status?: number;
  latencyMs: number;
  error?: string;
  sample?: unknown;
}
