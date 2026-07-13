import type { BetBraStatus } from "@/types/exchange";

const stateConfig: Record<
  BetBraStatus["state"],
  { label: string; color: string; bg: string }
> = {
  idle: {
    label: "BetBra: aguardando",
    color: "text-zinc-400",
    bg: "bg-zinc-800/50 border-zinc-700",
  },
  polling: {
    label: "BetBra: consultando...",
    color: "text-sky-400",
    bg: "bg-sky-500/10 border-sky-500/30",
  },
  connected: {
    label: "BetBra: conectado",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/30",
  },
  blocked: {
    label: "BetBra: bloqueado",
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/30",
  },
  error: {
    label: "BetBra: erro",
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/30",
  },
};

interface BetBraStatusBannerProps {
  status: BetBraStatus;
}

export function BetBraStatusBanner({ status }: BetBraStatusBannerProps) {
  const config = stateConfig[status.state];

  if (status.state === "connected") {
    return (
      <div
        className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${config.bg}`}
      >
        <span className={`h-2 w-2 rounded-full bg-emerald-400`} />
        <span className={config.color}>{config.label}</span>
        {status.lastPollAt && (
          <span className="text-zinc-600">
            · {new Date(status.lastPollAt).toLocaleTimeString("pt-BR")}
          </span>
        )}
      </div>
    );
  }

  if (status.state === "polling" || status.state === "idle") {
    return (
      <div
        className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${config.bg}`}
      >
        <span className={`h-2 w-2 animate-pulse rounded-full bg-sky-400`} />
        <span className={config.color}>{config.label}</span>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border p-4 ${config.bg}`}>
      <div className="flex items-center gap-2">
        <span className={`text-sm font-medium ${config.color}`}>
          {config.label}
        </span>
      </div>
      {status.error && (
        <p className="mt-2 text-sm text-zinc-400">{status.error}</p>
      )}
      <p className="mt-2 text-xs text-zinc-500">
        Verifique{" "}
        <code className="rounded bg-zinc-800 px-1">MEXCHANGE_BOT_USER_AGENT</code>{" "}
        aprovado, IP brasileiro ou configure{" "}
        <code className="rounded bg-zinc-800 px-1">FULLTBET_PROXY</code>. Teste
        em{" "}
        <a
          href="/api/exchange/connectivity-test"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-400 underline"
        >
          /api/exchange/connectivity-test
        </a>
      </p>
    </div>
  );
}
