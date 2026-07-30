/**
 * Contrato positivo do schema (offline via migrations) — anti-regressão.
 * Não exige DB live no CI; VPS usa check pós-deploy para runtime.
 */
export const PROFILES_DB_CONTRACT_VERSION = "profiles-db-contract-v1";

/** Artefatos que as migrations devem continuar mencionando. */
export const PROFILES_DB_REQUIRED = Object.freeze({
  columns: Object.freeze([
    "deduction_balance_cents",
    "locked_balance_cents",
  ]),
  rpcs: Object.freeze(["request_saldo_reembolso_withdrawal"]),
  migrationNeedles: Object.freeze([
    Object.freeze({
      file: "supabase/migrations/20260725_deduction_balance_cents.sql",
      mustInclude: Object.freeze([
        "deduction_balance_cents",
        "ADD COLUMN IF NOT EXISTS deduction_balance_cents",
      ]),
    }),
    Object.freeze({
      file: "supabase/migrations/20260725_request_saldo_reembolso_withdrawal.sql",
      mustInclude: Object.freeze([
        "request_saldo_reembolso_withdrawal",
        "deduction_balance_cents",
      ]),
    }),
  ]),
});

export const PROFILES_DB_SPEC = Object.freeze({
  version: PROFILES_DB_CONTRACT_VERSION,
  hasEmailColumn: false,
  required: PROFILES_DB_REQUIRED,
});
