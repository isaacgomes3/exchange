import type { AlertSeverity } from "@/types/exchange";

const severityStyles: Record<
  AlertSeverity,
  { border: string; bg: string; icon: string }
> = {
  critical: {
    border: "border-red-500/50",
    bg: "bg-red-500/10",
    icon: "⚽",
  },
  warning: {
    border: "border-amber-500/50",
    bg: "bg-amber-500/10",
    icon: "📉",
  },
  info: {
    border: "border-blue-500/50",
    bg: "bg-blue-500/10",
    icon: "ℹ️",
  },
};

interface AlertFeedProps {
  alerts: Array<{
    id: string;
    severity: AlertSeverity;
    message: string;
    triggeredAt: string;
    acknowledged: boolean;
  }>;
  onAcknowledge: (id: string) => void;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function AlertFeed({ alerts, onAcknowledge }: AlertFeedProps) {
  const unacknowledged = alerts.filter((a) => !a.acknowledged);

  if (alerts.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-center text-zinc-500">
        Nenhum alerta no momento. O painel monitora jogos ao vivo automaticamente.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {unacknowledged.length > 0 && (
        <div className="mb-3 flex items-center gap-2">
          <span className="rounded-full bg-red-500/20 px-3 py-1 text-xs font-semibold text-red-400">
            {unacknowledged.length} novo{unacknowledged.length > 1 ? "s" : ""}
          </span>
        </div>
      )}
      <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
        {alerts.map((alert) => {
          const style = severityStyles[alert.severity];
          return (
            <div
              key={alert.id}
              className={`flex items-start justify-between gap-3 rounded-lg border p-3 transition-opacity ${style.border} ${style.bg} ${alert.acknowledged ? "opacity-40" : ""}`}
            >
              <div className="flex gap-3">
                <span className="text-lg">{style.icon}</span>
                <div>
                  <p className="text-sm text-zinc-100">{alert.message}</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {formatTime(alert.triggeredAt)}
                  </p>
                </div>
              </div>
              {!alert.acknowledged && (
                <button
                  onClick={() => onAcknowledge(alert.id)}
                  className="shrink-0 rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
                >
                  OK
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
