import { evaluateGameUpdate } from "@/lib/alerts/engine";
import { DEFAULT_ALERT_RULES } from "@/lib/alerts/default-rules";
import {
  getPollIntervalMs,
  pollLiveGames,
  type BetBraConnectionStatus,
} from "@/lib/betbra/poller";
import {
  acknowledgeAlertRemote,
  fetchAlertRules,
  fetchAlerts,
  insertAlert,
  seedDefaultRules,
  upsertAlertRule,
} from "@/lib/supabase/alerts-repository";
import { isSupabasePersistenceEnabled } from "@/lib/supabase/config";
import type { Alert, AlertRule, BetBraStatus, LiveGame } from "@/types/exchange";

type Subscriber = (data: {
  games: LiveGame[];
  alert?: Alert;
  betbraStatus?: BetBraStatus;
}) => void;

interface ExchangeStore {
  games: Map<string, LiveGame>;
  alerts: Alert[];
  rules: AlertRule[];
  subscribers: Set<Subscriber>;
  pollerRunning: boolean;
  pollInFlight: boolean;
  betbraStatus: BetBraStatus;
  supabaseHydrated: boolean;
  supabaseHydrating: Promise<void> | null;
}

declare global {
  var __exchangeStore: ExchangeStore | undefined;
}

function createStore(): ExchangeStore {
  return {
    games: new Map(),
    alerts: [],
    rules: structuredClone(DEFAULT_ALERT_RULES),
    subscribers: new Set(),
    pollerRunning: false,
    pollInFlight: false,
    betbraStatus: { state: "idle" },
    supabaseHydrated: false,
    supabaseHydrating: null,
  };
}

export function getStore(): ExchangeStore {
  if (!globalThis.__exchangeStore) {
    globalThis.__exchangeStore = createStore();
  }
  return globalThis.__exchangeStore;
}

/** Carrega regras/alertas do Supabase (uma vez) quando configurado. */
export async function ensureSupabaseHydrated(): Promise<void> {
  const store = getStore();
  if (!isSupabasePersistenceEnabled() || store.supabaseHydrated) return;

  if (store.supabaseHydrating) {
    await store.supabaseHydrating;
    return;
  }

  store.supabaseHydrating = (async () => {
    const [remoteRules, remoteAlerts] = await Promise.all([
      fetchAlertRules(),
      fetchAlerts(100),
    ]);

    if (remoteRules && remoteRules.length > 0) {
      store.rules = remoteRules;
    } else if (remoteRules && remoteRules.length === 0) {
      const defaults = structuredClone(DEFAULT_ALERT_RULES);
      store.rules = defaults;
      await seedDefaultRules(defaults);
    }

    if (remoteAlerts) {
      store.alerts = remoteAlerts;
    }

    store.supabaseHydrated = true;
  })();

  try {
    await store.supabaseHydrating;
  } finally {
    store.supabaseHydrating = null;
  }
}

export function getLiveGames(): LiveGame[] {
  return Array.from(getStore().games.values()).sort(
    (a, b) => b.totalVolume - a.totalVolume
  );
}

export function getAlerts(): Alert[] {
  return [...getStore().alerts].sort(
    (a, b) =>
      new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime()
  );
}

export function getRules(): AlertRule[] {
  return [...getStore().rules];
}

export function getBetBraStatus(): BetBraStatus {
  return { ...getStore().betbraStatus };
}

export function addRule(rule: Omit<AlertRule, "id">): AlertRule {
  const store = getStore();
  const newRule: AlertRule = {
    ...rule,
    id: `rule-${Date.now()}`,
  };
  store.rules.push(newRule);
  void upsertAlertRule(newRule);
  return newRule;
}

export function updateRule(
  id: string,
  updates: Partial<AlertRule>
): AlertRule | null {
  const store = getStore();
  const index = store.rules.findIndex((r) => r.id === id);
  if (index === -1) return null;
  store.rules[index] = { ...store.rules[index], ...updates };
  void upsertAlertRule(store.rules[index]);
  return store.rules[index];
}

export function acknowledgeAlert(id: string): boolean {
  const store = getStore();
  const alert = store.alerts.find((a) => a.id === id);
  if (!alert) return false;
  alert.acknowledged = true;
  void acknowledgeAlertRemote(id);
  return true;
}

export function subscribe(callback: Subscriber): () => void {
  const store = getStore();
  store.subscribers.add(callback);
  return () => store.subscribers.delete(callback);
}

function notifySubscribers(
  games: LiveGame[],
  alert?: Alert,
  betbraStatus?: BetBraStatus
) {
  const store = getStore();
  for (const sub of store.subscribers) {
    sub({ games, alert, betbraStatus });
  }
}

function setBetBraStatus(
  state: BetBraConnectionStatus,
  message?: string,
  lastPollAt?: string
) {
  const store = getStore();
  const isInfo = state === "connected" && message?.includes("Nenhum jogo");
  store.betbraStatus = {
    state,
    error: !isInfo ? message : undefined,
    info: isInfo ? message : undefined,
    lastPollAt,
  };
  notifySubscribers(getLiveGames(), undefined, store.betbraStatus);
}

function pushAlert(alert: Alert) {
  const store = getStore();
  store.alerts.unshift(alert);
  if (store.alerts.length > 100) {
    store.alerts = store.alerts.slice(0, 100);
  }
  void insertAlert(alert);
  notifySubscribers(getLiveGames(), alert, store.betbraStatus);
}

async function runPoll() {
  const store = getStore();
  if (store.pollInFlight) return;

  store.pollInFlight = true;
  setBetBraStatus("polling");

  try {
    const result = await pollLiveGames(store.games);
    setBetBraStatus(result.status, result.error, result.lastPollAt);

    if (result.games.length === 0) {
      notifySubscribers(getLiveGames(), undefined, store.betbraStatus);
      return;
    }

    const newGameIds = new Set(result.games.map((g) => g.id));

    for (const game of result.games) {
      const prev = store.games.get(game.id);
      const alerts = evaluateGameUpdate(prev, game, store.rules);

      store.games.set(game.id, game);

      for (const alert of alerts) {
        pushAlert(alert);
      }
    }

    for (const [id] of store.games) {
      if (!newGameIds.has(id)) {
        store.games.delete(id);
      }
    }

    notifySubscribers(getLiveGames(), undefined, store.betbraStatus);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro inesperado no polling";
    setBetBraStatus("error", message, new Date().toISOString());
  } finally {
    store.pollInFlight = false;
  }
}

export function startBetBraPoller() {
  const store = getStore();
  if (store.pollerRunning) return;
  store.pollerRunning = true;

  void ensureSupabaseHydrated().finally(() => {
    runPoll();
  });

  setInterval(() => {
    runPoll();
  }, getPollIntervalMs());
}

/** @deprecated Use startBetBraPoller */
export function startSimulator() {
  startBetBraPoller();
}
