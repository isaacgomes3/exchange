import { getBetBraConfig } from "./config";
import { scheduleRequest } from "./rate-limiter";
import {
  getLocalProxyErrorMessage,
  isLocalProxyAvailable,
} from "./proxy-health";
import { getEventDetailReferer } from "./urls";
import type {
  BetBraEvent,
  BetBraEventsResponse,
  ConnectivityTestResult,
  InplayInfo,
} from "./types";
import { BetBraFetchError } from "./types";

function buildCookie(language: string): string {
  return `BIAB_LANGUAGE=${language}`;
}

function buildMexchangeHeaders(): Record<string, string> {
  const config = getBetBraConfig();
  return {
    Accept: "application/json",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "User-Agent": config.userAgent,
    Referer: config.mexchangeReferer,
    Cookie: buildCookie(config.biabLanguage),
  };
}

function buildInplayHeaders(): Record<string, string> {
  const config = getBetBraConfig();
  return {
    Accept: "application/json",
    "User-Agent": config.userAgent,
    Referer: `${config.siteOrigin}/`,
    Cookie: buildCookie(config.biabLanguage),
  };
}

function buildEventDetailHeaders(
  sportId: number,
  eventId: string
): Record<string, string> {
  const config = getBetBraConfig();
  return {
    Accept: "application/json",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "User-Agent": config.userAgent,
    Referer: getEventDetailReferer(sportId, eventId),
    Cookie: buildCookie(config.biabLanguage),
  };
}

async function rawFetch(
  url: string,
  headers: Record<string, string>,
  useProxy: boolean
): Promise<Response> {
  const config = getBetBraConfig();
  const init = { headers, redirect: "manual" as RequestRedirect };

  if (useProxy && config.proxyUrl) {
    const { fetch: undiciFetch, ProxyAgent } = await import("undici");
    return undiciFetch(url, {
      ...init,
      dispatcher: new ProxyAgent(config.proxyUrl),
    }) as unknown as Response;
  }

  return fetch(url, init);
}

async function parseResponse<T>(response: Response, url: string): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();

  if (
    response.status === 403 ||
    response.status === 401 ||
    response.status === 302 ||
    contentType.includes("text/html") ||
    text.trim().startsWith("<!DOCTYPE") ||
    text.trim().startsWith("<html")
  ) {
    throw new BetBraFetchError(
      "Acesso bloqueado pela BetBra/Cloudflare — verifique User-Agent aprovado e IP brasileiro",
      "BLOCKED",
      response.status,
      url
    );
  }

  if (response.status === 429) {
    throw new BetBraFetchError(
      "Rate limit atingido (HTTP 429) — reduza a frequência de requests",
      "RATE_LIMITED",
      429,
      url
    );
  }

  if (!response.ok) {
    throw new BetBraFetchError(
      `HTTP ${response.status}: ${text.slice(0, 200)}`,
      "HTTP_ERROR",
      response.status,
      url
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new BetBraFetchError(
      "Resposta não é JSON válido — possível bloqueio Cloudflare",
      "INVALID_JSON",
      response.status,
      url
    );
  }
}

async function betbraFetch<T>(
  url: string,
  headers: Record<string, string>
): Promise<T> {
  const config = getBetBraConfig();

  if (config.useLocalProxy) {
    return scheduleRequest(async () => {
      const available = await isLocalProxyAvailable();
      if (!available) {
        throw new BetBraFetchError(
          getLocalProxyErrorMessage(),
          "NETWORK_ERROR",
          undefined,
          url
        );
      }

      try {
        const response = await fetch(url, {
          headers: { Accept: "application/json" },
        });
        return await parseResponse<T>(response, url);
      } catch (error) {
        if (error instanceof BetBraFetchError) throw error;
        const message =
          error instanceof Error ? error.message : "Erro de rede";
        throw new BetBraFetchError(message, "NETWORK_ERROR", undefined, url);
      }
    }, config.requestSpacingMs);
  }

  return scheduleRequest(async () => {
    const attempts: boolean[] = [];

    if (config.useProxy && config.proxyUrl) {
      attempts.push(true);
      if (config.directFallback) attempts.push(false);
    } else {
      attempts.push(false);
    }

    let lastError: BetBraFetchError | Error | null = null;

    for (const useProxy of attempts) {
      try {
        const response = await rawFetch(url, headers, useProxy);
        return await parseResponse<T>(response, url);
      } catch (error) {
        lastError = error as BetBraFetchError | Error;
        if (
          error instanceof BetBraFetchError &&
          error.code === "RATE_LIMITED"
        ) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }

    throw (
      lastError ??
      new BetBraFetchError("Falha ao conectar com a BetBra", "NETWORK_ERROR", undefined, url)
    );
  }, config.requestSpacingMs);
}

function timeWindow(): { after: number; before: number } {
  const now = Math.floor(Date.now() / 1000);
  return { after: now - 7200, before: now + 86400 };
}

export async function fetchEvents(
  sportId: number,
  options?: { sortBy?: "volume" | "start-time"; inRunningOnly?: boolean }
): Promise<BetBraEventsResponse> {
  const config = getBetBraConfig();
  const { after, before } = timeWindow();
  const sortBy = options?.sortBy ?? "volume";

  const params = new URLSearchParams({
    offset: "0",
    "per-page": String(config.eventsPerPage),
    after: String(after),
    before: String(before),
    ids: "",
    "sport-ids": String(sportId),
    "sort-by": sortBy,
    "sort-direction": "desc",
    "en-market-names": "Moneyline,Match Odds,Winner",
  });

  const url = config.useLocalProxy
    ? `${config.localProxyUrl}/mexchange/events?${params}`
    : `${config.apiBaseUrl}/events?${params}`;
  const data = await betbraFetch<BetBraEventsResponse>(
    url,
    buildMexchangeHeaders()
  );

  if (options?.inRunningOnly) {
    data.events = data.events.filter((e) => e["in-running-flag"]);
  }

  return data;
}

export async function fetchEventDetail(
  eventId: string,
  sportId: number
): Promise<BetBraEvent> {
  const config = getBetBraConfig();
  const url = config.useLocalProxy
    ? `${config.localProxyUrl}/mexchange/events/${eventId}?sport-id=${sportId}`
    : `${config.apiBaseUrl}/events/${eventId}`;
  return betbraFetch<BetBraEvent>(
    url,
    buildEventDetailHeaders(sportId, eventId)
  );
}

export async function fetchInplayInfo(): Promise<InplayInfo[]> {
  const config = getBetBraConfig();
  const url = config.useLocalProxy
    ? `${config.localProxyUrl}/inplay`
    : config.inplayFeedUrl;
  const data = await betbraFetch<InplayInfo[]>(
    url,
    buildInplayHeaders()
  );
  return Array.isArray(data) ? data : [];
}

export async function runConnectivityTest(): Promise<{
  config: {
    userAgent: string;
    useProxy: boolean;
    useLocalProxy: boolean;
    localProxyUrl: string;
    apiBaseUrl: string;
  };
  results: ConnectivityTestResult[];
  allOk: boolean;
}> {
  const config = getBetBraConfig();
  const results: ConnectivityTestResult[] = [];

  async function testEndpoint(
    name: string,
    fn: () => Promise<unknown>
  ): Promise<void> {
    const start = Date.now();
    try {
      const sample = await fn();
      results.push({
        ok: true,
        endpoint: name,
        latencyMs: Date.now() - start,
        sample:
          name === "inplay"
            ? Array.isArray(sample)
              ? (sample as InplayInfo[]).slice(0, 2)
              : sample
            : name === "events"
              ? {
                  total: (sample as BetBraEventsResponse).total,
                  count: (sample as BetBraEventsResponse).events?.length,
                }
              : { id: (sample as BetBraEvent).id, name: (sample as BetBraEvent).name },
      });
    } catch (error) {
      const err = error as BetBraFetchError;
      results.push({
        ok: false,
        endpoint: name,
        latencyMs: Date.now() - start,
        status: err.status,
        error: err.message,
      });
    }
  }

  await testEndpoint("events", () =>
    fetchEvents(config.soccerSportId, { sortBy: "start-time" })
  );

  const eventsResult = results.find((r) => r.endpoint === "events");
  const firstEventId =
    eventsResult?.ok &&
    eventsResult.sample &&
    typeof eventsResult.sample === "object" &&
    "count" in eventsResult.sample &&
    (eventsResult.sample as { count?: number }).count
      ? (
          await fetchEvents(config.soccerSportId, { sortBy: "start-time" })
        ).events[0]?.id
      : null;

  if (firstEventId) {
    await testEndpoint("event-detail", () =>
      fetchEventDetail(firstEventId, config.soccerSportId)
    );
  } else {
    results.push({
      ok: false,
      endpoint: "event-detail",
      latencyMs: 0,
      error: "Pulado — lista de eventos indisponível",
    });
  }

  await testEndpoint("inplay", () => fetchInplayInfo());

  return {
    config: {
      userAgent: config.userAgent,
      useProxy: config.useProxy,
      useLocalProxy: config.useLocalProxy,
      localProxyUrl: config.localProxyUrl,
      apiBaseUrl: config.apiBaseUrl,
    },
    results,
    allOk: results.every((r) => r.ok),
  };
}
