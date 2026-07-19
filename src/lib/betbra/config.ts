export interface BetBraConfig {
  apiBaseUrl: string;
  siteOrigin: string;
  mexchangeReferer: string;
  userAgent: string;
  biabLanguage: string;
  inplayFeedUrl: string;
  soccerSportId: number;
  tennisSportId: number;
  useProxy: boolean;
  proxyUrl: string | null;
  directFallback: boolean;
  useLocalProxy: boolean;
  localProxyUrl: string;
  requestSpacingMs: number;
  eventsPerPage: number;
  pollIntervalMs: number;
}

function envBool(key: string, fallback: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

export function getBetBraConfig(): BetBraConfig {
  return {
    apiBaseUrl:
      process.env.MEXCHANGE_API_BASE_URL ??
      "https://mexchange-api.betbra.bet.br/api",
    siteOrigin:
      process.env.EXCHANGE_SITE_ORIGIN ?? "https://betbra.bet.br",
    mexchangeReferer:
      process.env.MEXCHANGE_REFERER ?? "https://mexchange.betbra.bet.br/",
    userAgent:
      process.env.MEXCHANGE_BOT_USER_AGENT ??
      "BOT/SOFTWARE;ExchangeLive;1.0",
    biabLanguage: process.env.MEXCHANGE_BIAB_LANGUAGE ?? "PT_BR",
    inplayFeedUrl:
      process.env.MEXCHANGE_INPLAY_FEED_URL ??
      "https://betbra.bet.br/client/api/jumper/feedSports/inplay-info",
    soccerSportId: Number(process.env.FULLTBET_SOCCER_SPORT_ID ?? "15"),
    tennisSportId: Number(process.env.FULLTBET_TENNIS_SPORT_ID ?? "9"),
    useProxy: envBool("FULLTBET_USE_OUTBOUND_PROXY", false),
    proxyUrl: process.env.FULLTBET_PROXY ?? null,
    directFallback: envBool("FULLTBET_DIRECT_FALLBACK", true),
    useLocalProxy: envBool("MEXCHANGE_USE_LOCAL_PROXY", false),
    localProxyUrl:
      process.env.MEXCHANGE_LOCAL_PROXY_URL ?? "http://127.0.0.1:8787",
    requestSpacingMs: Number(process.env.MEXCHANGE_REQUEST_SPACING_MS ?? "200"),
    eventsPerPage: Number(process.env.MEXCHANGE_EVENTS_PER_PAGE ?? "50"),
    pollIntervalMs: Number(process.env.MEXCHANGE_POLL_INTERVAL_MS ?? "10000"),
  };
}
