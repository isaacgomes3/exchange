import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Alert, AlertRule, AlertSeverity, AlertType, Sport } from "@/types/exchange";

type AlertRuleRow = {
  id: string;
  name: string;
  sport: string | null;
  min_odds: number | null;
  max_odds: number | null;
  odds_move_pct: number | null;
  min_volume: number | null;
  score_change: boolean;
  enabled: boolean;
};

type AlertRow = {
  id: string;
  type: string;
  severity: string;
  game_id: string;
  message: string;
  triggered_at: string;
  acknowledged: boolean;
  metadata: Record<string, string | number> | null;
};

function toRule(row: AlertRuleRow): AlertRule {
  return {
    id: row.id,
    name: row.name,
    sport: (row.sport as Sport | null) ?? undefined,
    minOdds: row.min_odds ?? undefined,
    maxOdds: row.max_odds ?? undefined,
    oddsMovePct: row.odds_move_pct ?? undefined,
    minVolume: row.min_volume ?? undefined,
    scoreChange: row.score_change,
    enabled: row.enabled,
  };
}

function toAlert(row: AlertRow): Alert {
  return {
    id: row.id,
    type: row.type as AlertType,
    severity: row.severity as AlertSeverity,
    gameId: row.game_id,
    message: row.message,
    triggeredAt: row.triggered_at,
    acknowledged: row.acknowledged,
    metadata: row.metadata ?? undefined,
  };
}

function ruleToRow(rule: AlertRule) {
  return {
    id: rule.id,
    name: rule.name,
    sport: rule.sport ?? null,
    min_odds: rule.minOdds ?? null,
    max_odds: rule.maxOdds ?? null,
    odds_move_pct: rule.oddsMovePct ?? null,
    min_volume: rule.minVolume ?? null,
    score_change: rule.scoreChange,
    enabled: rule.enabled,
    updated_at: new Date().toISOString(),
  };
}

function alertToRow(alert: Alert) {
  return {
    id: alert.id,
    type: alert.type,
    severity: alert.severity,
    game_id: alert.gameId,
    message: alert.message,
    triggered_at: alert.triggeredAt,
    acknowledged: alert.acknowledged,
    metadata: alert.metadata ?? null,
  };
}

export async function fetchAlertRules(): Promise<AlertRule[] | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("alert_rules")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[supabase] fetchAlertRules:", error.message);
    return null;
  }

  return (data as AlertRuleRow[]).map(toRule);
}

export async function upsertAlertRule(rule: AlertRule): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return false;

  const { error } = await supabase.from("alert_rules").upsert(ruleToRow(rule));
  if (error) {
    console.error("[supabase] upsertAlertRule:", error.message);
    return false;
  }
  return true;
}

export async function fetchAlerts(limit = 100): Promise<Alert[] | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("alerts")
    .select("*")
    .order("triggered_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[supabase] fetchAlerts:", error.message);
    return null;
  }

  return (data as AlertRow[]).map(toAlert);
}

export async function insertAlert(alert: Alert): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return false;

  const { error } = await supabase.from("alerts").insert(alertToRow(alert));
  if (error) {
    console.error("[supabase] insertAlert:", error.message);
    return false;
  }
  return true;
}

export async function acknowledgeAlertRemote(id: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return false;

  const { error } = await supabase
    .from("alerts")
    .update({ acknowledged: true })
    .eq("id", id);

  if (error) {
    console.error("[supabase] acknowledgeAlertRemote:", error.message);
    return false;
  }
  return true;
}

export async function seedDefaultRules(rules: AlertRule[]): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return false;

  const { error } = await supabase.from("alert_rules").upsert(rules.map(ruleToRow));
  if (error) {
    console.error("[supabase] seedDefaultRules:", error.message);
    return false;
  }
  return true;
}
