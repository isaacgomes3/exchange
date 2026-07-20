"use client";

import { useEffect, useState } from "react";
import type { AlertRule, Sport } from "@/types/exchange";

interface AlertRulesPanelProps {
  open: boolean;
  onClose: () => void;
}

export function AlertRulesPanel({ open, onClose }: AlertRulesPanelProps) {
  const [rules, setRules] = useState<AlertRule[]>([]);

  useEffect(() => {
    if (open) {
      fetch("/api/alerts/rules")
        .then((r) => r.json())
        .then((data: { rules: AlertRule[] }) => setRules(data.rules));
    }
  }, [open]);

  const toggleRule = async (id: string, enabled: boolean) => {
    const res = await fetch("/api/alerts/rules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, enabled }),
    });
    const data = await res.json();
    setRules((prev) =>
      prev.map((r) => (r.id === id ? data.rule : r))
    );
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-100">
            Regras de Alerta
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3">
          {rules.map((rule) => (
            <label
              key={rule.id}
              className="flex cursor-pointer items-center justify-between rounded-lg border border-zinc-800 bg-zinc-800/50 px-4 py-3 transition-colors hover:border-zinc-700"
            >
              <div>
                <p className="text-sm font-medium text-zinc-200">{rule.name}</p>
                <p className="text-xs text-zinc-500">
                  {rule.scoreChange && "Gols · "}
                  {rule.oddsMovePct && `Odds > ${rule.oddsMovePct}% · `}
                  {rule.minVolume && `Vol > R$${rule.minVolume / 1000}k · `}
                  {rule.minOdds && `Odds > ${rule.minOdds}`}
                </p>
              </div>
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={(e) => toggleRule(rule.id, e.target.checked)}
                className="h-4 w-4 rounded border-zinc-600 bg-zinc-700 text-emerald-500 focus:ring-emerald-500"
              />
            </label>
          ))}
        </div>

        <p className="mt-4 text-xs text-zinc-500">
          As regras são avaliadas em tempo real conforme os dados da exchange
          são atualizados.
        </p>
      </div>
    </div>
  );
}

export type { Sport };
