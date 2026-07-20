interface OddsCellProps {
  backOdds: number;
  layOdds: number;
  prevBackOdds?: number;
}

export function OddsCell({ backOdds, layOdds, prevBackOdds }: OddsCellProps) {
  let arrow = "";
  let arrowColor = "text-zinc-500";

  if (prevBackOdds !== undefined && prevBackOdds !== backOdds) {
    if (backOdds > prevBackOdds) {
      arrow = "▲";
      arrowColor = "text-emerald-400";
    } else {
      arrow = "▼";
      arrowColor = "text-red-400";
    }
  }

  return (
    <div className="font-mono text-sm">
      <div className="flex items-center gap-1">
        <span className="text-sky-400">{backOdds.toFixed(2)}</span>
        {arrow && <span className={`text-xs ${arrowColor}`}>{arrow}</span>}
      </div>
      <div className="text-xs text-rose-400/70">{layOdds.toFixed(2)}</div>
    </div>
  );
}
