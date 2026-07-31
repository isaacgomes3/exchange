-- Saldo Dedução: retornos automáticos quando bate ArbiShield (stake + dedução).
-- Usável nas operações do apostador e sacável via /api/arbishield/deduction-withdraw.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deduction_balance_cents bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.profiles.deduction_balance_cents IS
  'Saldo Dedução: crédito automático (stake+dedução) ao bater ArbiShield. Usável e sacável.';
