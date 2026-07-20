"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Alert, BetBraStatus, LiveGame } from "@/types/exchange";

type ConnectionStatus = "connecting" | "connected" | "disconnected";

interface UseLiveStreamResult {
  games: LiveGame[];
  alerts: Alert[];
  status: ConnectionStatus;
  betbraStatus: BetBraStatus;
  acknowledgeAlert: (id: string) => void;
}

function createEventSource(
  onGames: (games: LiveGame[]) => void,
  onAlert: (alert: Alert) => void,
  onBetBraStatus: (status: BetBraStatus) => void,
  onStatus: (status: ConnectionStatus) => void,
  onReconnect: () => void
): EventSource {
  onStatus("connecting");
  const es = new EventSource("/api/live/stream");

  es.onopen = () => onStatus("connected");

  es.onmessage = (event) => {
    const data = JSON.parse(event.data) as {
      type: string;
      games?: LiveGame[];
      alert?: Alert;
      betbraStatus?: BetBraStatus;
    };

    if (data.games) {
      onGames(data.games);
    }

    if (data.betbraStatus) {
      onBetBraStatus(data.betbraStatus);
    }

    if (data.type === "alert" && data.alert) {
      onAlert(data.alert);
    }
  };

  es.onerror = () => {
    onStatus("disconnected");
    es.close();
    setTimeout(onReconnect, 3000);
  };

  return es;
}

export function useLiveStream(): UseLiveStreamResult {
  const [games, setGames] = useState<LiveGame[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [betbraStatus, setBetBraStatus] = useState<BetBraStatus>({
    state: "idle",
  });
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const connect = () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = createEventSource(
        setGames,
        (alert) => setAlerts((prev) => [alert, ...prev].slice(0, 50)),
        setBetBraStatus,
        setStatus,
        connect
      );
    };

    connect();

    fetch("/api/alerts")
      .then((r) => r.json())
      .then((data: { alerts: Alert[] }) => setAlerts(data.alerts))
      .catch(() => {});

    fetch("/api/live/games")
      .then((r) => r.json())
      .then(
        (data: { games: LiveGame[]; betbraStatus: BetBraStatus }) => {
          if (data.games) setGames(data.games);
          if (data.betbraStatus) setBetBraStatus(data.betbraStatus);
        }
      )
      .catch(() => {});

    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  const acknowledgeAlert = useCallback(async (id: string) => {
    await fetch("/api/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "acknowledge" }),
    });
    setAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, acknowledged: true } : a))
    );
  }, []);

  return { games, alerts, status, betbraStatus, acknowledgeAlert };
}
