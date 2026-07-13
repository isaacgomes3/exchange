import type { LiveGame, Sport } from "@/types/exchange";
import { OddsCell } from "./OddsCell";

interface LiveGamesTableProps {
  games: LiveGame[];
  sportFilter: Sport | "todos";
}

function statusBadge(status: LiveGame["status"]) {
  const styles = {
    LIVE: "bg-emerald-500/20 text-emerald-400",
    SUSPENDED: "bg-amber-500/20 text-amber-400",
    FINISHED: "bg-zinc-500/20 text-zinc-400",
  };
  const labels = {
    LIVE: "AO VIVO",
    SUSPENDED: "SUSPENSO",
    FINISHED: "FINAL",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${styles[status]}`}
    >
      {labels[status]}
    </span>
  );
}

function formatVolume(volume: number): string {
  if (volume >= 1000000) return `£${(volume / 1000000).toFixed(1)}M`;
  if (volume >= 1000) return `£${(volume / 1000).toFixed(0)}k`;
  return `£${volume}`;
}

function formatMinute(game: LiveGame): string {
  if (game.sport === "tenis") return "Set ao vivo";
  if (game.sport === "basquete") return "Ao vivo";
  return `${game.minute}'`;
}

export function LiveGamesTable({ games, sportFilter }: LiveGamesTableProps) {
  const filtered =
    sportFilter === "todos"
      ? games
      : games.filter((g) => g.sport === sportFilter);

  if (filtered.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center text-zinc-500">
        Nenhum jogo ao vivo para o filtro selecionado.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-900/80 text-xs uppercase tracking-wider text-zinc-500">
            <th className="px-4 py-3">Jogo</th>
            <th className="px-4 py-3">Placar</th>
            <th className="px-4 py-3">Tempo</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Back / Lay</th>
            <th className="px-4 py-3 text-right">Volume</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((game) => {
            const mainSelection = game.markets[0]?.selections[0];
            return (
              <tr
                key={game.id}
                className="border-b border-zinc-800/50 transition-colors hover:bg-zinc-800/30"
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-zinc-100">
                    {game.homeTeam}{" "}
                    <span className="text-zinc-600">vs</span> {game.awayTeam}
                  </div>
                  <div className="text-xs text-zinc-500">{game.competition}</div>
                </td>
                <td className="px-4 py-3 font-mono text-base font-semibold text-zinc-100">
                  {game.score.home} - {game.score.away}
                </td>
                <td className="px-4 py-3 text-zinc-400">{formatMinute(game)}</td>
                <td className="px-4 py-3">{statusBadge(game.status)}</td>
                <td className="px-4 py-3">
                  {mainSelection ? (
                    <div>
                      <div className="mb-0.5 text-xs text-zinc-500">
                        {mainSelection.name}
                      </div>
                      <OddsCell
                        backOdds={mainSelection.backOdds}
                        layOdds={mainSelection.layOdds}
                        prevBackOdds={mainSelection.prevBackOdds}
                      />
                    </div>
                  ) : (
                    <span className="text-zinc-600">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-mono text-zinc-300">
                  {formatVolume(game.totalVolume)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
