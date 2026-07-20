import type { ConnectionStatus as Status } from "@/components/panel/types";

const statusConfig: Record<
  Status,
  { label: string; color: string; dot: string }
> = {
  connecting: {
    label: "Conectando...",
    color: "text-amber-400",
    dot: "bg-amber-400 animate-pulse",
  },
  connected: {
    label: "Conectado",
    color: "text-emerald-400",
    dot: "bg-emerald-400",
  },
  disconnected: {
    label: "Desconectado",
    color: "text-red-400",
    dot: "bg-red-400 animate-pulse",
  },
};

interface ConnectionStatusProps {
  status: Status;
}

export function ConnectionStatus({ status }: ConnectionStatusProps) {
  const config = statusConfig[status];

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={`h-2 w-2 rounded-full ${config.dot}`} />
      <span className={config.color}>{config.label}</span>
    </div>
  );
}
