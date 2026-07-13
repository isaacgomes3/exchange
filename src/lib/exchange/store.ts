import { evaluateGameUpdate } from "@/lib/alerts/engine";
import { DEFAULT_ALERT_RULES } from "@/lib/alerts/default-rules";
import { INITIAL_GAMES } from "@/lib/exchange/mock-data";
import type { Alert, AlertRule, LiveGame } from "@/types/exchange";

type Subscriber = (data: { games: LiveGame[]; alert?: Alert }) => void;

interface ExchangeStore {
  games: Map<string, LiveGame>;
  alerts: Alert[];
  rules: AlertRule[];
  subscribers: Set<Subscriber>;
  simulatorRunning: boolean;
}

declare global {
  var __exchangeStore: ExchangeStore | undefined;
}

function createStore(): ExchangeStore {
  const games = new Map<string, LiveGame>();
  for (const game of INITIAL_GAMES) {
    games.set(game.id, structuredClone(game));
  }

  return {
    games,
    alerts: [],
    rules: structuredClone(DEFAULT_ALERT_RULES),
    subscribers: new Set(),
    simulatorRunning: false,
  };
}

export function getStore(): ExchangeStore {
  if (!globalThis.__exchangeStore) {
    globalThis.__exchangeStore = createStore();
  }
  return globalThis.__exchangeStore;
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

export function addRule(rule: Omit<AlertRule, "id">): AlertRule {
  const store = getStore();
  const newRule: AlertRule = {
    ...rule,
    id: `rule-${Date.now()}`,
  };
  store.rules.push(newRule);
  return newRule;
}

export function updateRule(id: string, updates: Partial<AlertRule>): AlertRule | null {
  const store = getStore();
  const index = store.rules.findIndex((r) => r.id === id);
  if (index === -1) return null;
  store.rules[index] = { ...store.rules[index], ...updates };
  return store.rules[index];
}

export function acknowledgeAlert(id: string): boolean {
  const store = getStore();
  const alert = store.alerts.find((a) => a.id === id);
  if (!alert) return false;
  alert.acknowledged = true;
  return true;
}

export function subscribe(callback: Subscriber): () => void {
  const store = getStore();
  store.subscribers.add(callback);
  return () => store.subscribers.delete(callback);
}

function notifySubscribers(games: LiveGame[], alert?: Alert) {
  const store = getStore();
  for (const sub of store.subscribers) {
    sub({ games, alert });
  }
}

function updateGame(game: LiveGame, alert?: Alert) {
  const store = getStore();
  store.games.set(game.id, game);
  if (alert) {
    store.alerts.unshift(alert);
    if (store.alerts.length > 100) {
      store.alerts = store.alerts.slice(0, 100);
    }
  }
  notifySubscribers(getLiveGames(), alert);
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function simulateTick() {
  const store = getStore();
  const gameIds = Array.from(store.games.keys());
  if (gameIds.length === 0) return;

  const gameId = gameIds[Math.floor(Math.random() * gameIds.length)];
  const prev = store.games.get(gameId);
  if (!prev || prev.status === "FINISHED") return;

  const current = structuredClone(prev);
  current.lastUpdated = new Date().toISOString();

  const eventRoll = Math.random();

  if (eventRoll < 0.15 && current.sport === "futebol" && current.status === "LIVE") {
    if (Math.random() < 0.5) {
      current.score.home += 1;
    } else {
      current.score.away += 1;
    }
    current.status = "SUSPENDED";
    setTimeout(() => {
      const g = store.games.get(gameId);
      if (g && g.status === "SUSPENDED") {
        const reopened = structuredClone(g);
        reopened.status = "LIVE";
        reopened.lastUpdated = new Date().toISOString();
        const alerts = evaluateGameUpdate(g, reopened, store.rules);
        for (const alert of alerts) {
          updateGame(reopened, alert);
        }
        if (alerts.length === 0) {
          updateGame(reopened);
        }
      }
    }, 3000 + Math.random() * 4000);
  } else if (eventRoll < 0.25 && current.status === "SUSPENDED") {
    current.status = "LIVE";
  } else if (eventRoll < 0.3 && current.status === "LIVE") {
    current.status = "SUSPENDED";
    setTimeout(() => {
      const g = store.games.get(gameId);
      if (g && g.status === "SUSPENDED") {
        const reopened = structuredClone(g);
        reopened.status = "LIVE";
        reopened.lastUpdated = new Date().toISOString();
        updateGame(reopened);
      }
    }, 2000 + Math.random() * 3000);
  } else {
    if (current.sport === "futebol" && current.status === "LIVE") {
      current.minute = Math.min(90, current.minute + 1);
    }

    for (const market of current.markets) {
      for (const selection of market.selections) {
        selection.prevBackOdds = selection.backOdds;
        const change = randomBetween(-0.12, 0.12);
        selection.backOdds = Math.max(
          1.01,
          Math.round((selection.backOdds + change) * 100) / 100
        );
        selection.layOdds =
          Math.round((selection.backOdds + 0.02) * 100) / 100;
        selection.volume += Math.floor(randomBetween(500, 8000));
      }
    }

    current.totalVolume = current.markets.reduce(
      (sum, m) =>
        sum + m.selections.reduce((s, sel) => s + sel.volume, 0),
      0
    );
  }

  const alerts = evaluateGameUpdate(prev, current, store.rules);
  if (alerts.length > 0) {
    updateGame(current, alerts[0]);
    for (let i = 1; i < alerts.length; i++) {
      store.alerts.unshift(alerts[i]);
      notifySubscribers(getLiveGames(), alerts[i]);
    }
  } else {
    updateGame(current);
  }
}

export function startSimulator() {
  const store = getStore();
  if (store.simulatorRunning) return;
  store.simulatorRunning = true;

  setInterval(() => {
    simulateTick();
  }, 2500);
}
