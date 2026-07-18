-- Exchange Live: alertas e regras persistidos no Supabase

create extension if not exists "pgcrypto";

create table if not exists public.alert_rules (
  id text primary key,
  name text not null,
  sport text,
  min_odds numeric,
  max_odds numeric,
  odds_move_pct numeric,
  min_volume numeric,
  score_change boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.alerts (
  id text primary key,
  type text not null,
  severity text not null,
  game_id text not null,
  message text not null,
  triggered_at timestamptz not null default now(),
  acknowledged boolean not null default false,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists alerts_triggered_at_idx
  on public.alerts (triggered_at desc);

create index if not exists alerts_acknowledged_idx
  on public.alerts (acknowledged);

create index if not exists alert_rules_enabled_idx
  on public.alert_rules (enabled);

-- Dev-friendly: permite leitura/escrita com a anon key.
-- Em produção, restrinja via RLS + auth conforme o seu modelo de usuários.
alter table public.alert_rules enable row level security;
alter table public.alerts enable row level security;

drop policy if exists "anon_all_alert_rules" on public.alert_rules;
create policy "anon_all_alert_rules"
  on public.alert_rules
  for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "anon_all_alerts" on public.alerts;
create policy "anon_all_alerts"
  on public.alerts
  for all
  to anon, authenticated
  using (true)
  with check (true);
