"use client";

import { useState } from "react";
import type { Sport } from "@/types/exchange";
import { useLiveStream } from "@/hooks/useLiveStream";
import { AlertFeed } from "./AlertFeed";
import { AlertRulesPanel } from "./AlertRulesPanel";
import { BetBraStatusBanner } from "./BetBraStatusBanner";
import { ConnectionStatus } from "./ConnectionStatus";
import { LiveGamesTable } from "./LiveGamesTable";

const SPORT_FILTERS: { value: Sport | "todos"; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "futebol", label: "Futebol" },
  { value: "tenis", label: "Tênis" },
];

export function LiveGamesPanel() {
  const { games, alerts, status, betbraStatus, acknowledgeAlert } =
    useLiveStream();
  const [sportFilter, setSportFilter] = useState<Sport | "todos">("todos");
  const [rulesOpen, setRulesOpen] = useState(false);

  const liveCount = games.filter((g) => g.status === "LIVE").length;
  const unackCount = alerts.filter((a) => !a.acknowledged).length;
  const totalVolume = games.reduce((s, g) => s + g.totalVolume, 0);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Exchange Live</h1>
            <p className="text-sm text-zinc-500">
              BetBra — painel de alertas ao vivo
            </p>
          </div>
          <div className="flex items-center gap-3">
            <BetBraStatusBanner status={betbraStatus} />
            <ConnectionStatus status={status} />
            <button
              onClick={() => setRulesOpen(true)}
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-700"
            >
              ⚙️ Regras
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        {(betbraStatus.state === "blocked" ||
          betbraStatus.state === "error") && (
          <BetBraStatusBanner status={betbraStatus} />
        )}

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Jogos ao vivo" value={liveCount} accent="emerald" />
          <StatCard
            label="Alertas novos"
            value={unackCount}
            accent={unackCount > 0 ? "red" : "zinc"}
          />
          <StatCard
            label="Total monitorado"
            value={games.length}
            accent="sky"
          />
          <StatCard
            label="Volume total"
            value={
              totalVolume >= 1000000
                ? `R$${(totalVolume / 1000000).toFixed(1)}M`
                : `R$${(totalVolume / 1000).toFixed(0)}k`
            }
            accent="amber"
            isText
          />
        </div>

        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-zinc-400">
            Alertas
            {unackCount > 0 && (
              <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs text-white">
                {unackCount}
              </span>
            )}
          </h2>
          <AlertFeed alerts={alerts} onAcknowledge={acknowledgeAlert} />
        </section>

        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
              Jogos ao Vivo — BetBra
              {betbraStatus.info && (
                <span className="ml-2 text-xs font-normal normal-case text-zinc-500">
                  ({betbraStatus.info})
                </span>
              )}
            </h2>
            <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
              {SPORT_FILTERS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setSportFilter(f.value)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    sportFilter === f.value
                      ? "bg-emerald-500/20 text-emerald-400"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <LiveGamesTable games={games} sportFilter={sportFilter} />
        </section>
      </main>

      <AlertRulesPanel open={rulesOpen} onClose={() => setRulesOpen(false)} />
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
  isText,
}: {
  label: string;
  value: number | string;
  accent: "emerald" | "red" | "sky" | "amber" | "zinc";
  isText?: boolean;
}) {
  const accentColors = {
    emerald: "text-emerald-400",
    red: "text-red-400",
    sky: "text-sky-400",
    amber: "text-amber-400",
    zinc: "text-zinc-300",
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p
        className={`mt-1 font-bold ${isText ? "text-lg" : "text-2xl"} ${accentColors[accent]}`}
      >
        {value}
      </p>
    </div>
  );
}
