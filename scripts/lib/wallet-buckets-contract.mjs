/**
 * Contrato dos buckets de carteira (profiles) — anti-regressão.
 * Colunas + labels UI. Pedido explícito para alterar.
 */
export const WALLET_BUCKETS_CONTRACT_VERSION = "wallet-buckets-contract-v1";

/** Colunas obrigatórias em profiles (sem email). */
export const WALLET_BUCKET_COLUMNS = Object.freeze([
  "balance_cents",
  "reusable_balance_cents",
  "locked_balance_cents",
  "deduction_balance_cents",
  "demo_balance_cents",
  "investor_balance_cents",
  "desafio_balance_cents",
]);

/** Label canônico do bucket de reembolso (nunca "Saldo Dedução"). */
export const REEMBOLSO_LABEL = "Saldo Reembolso";
export const FORBIDDEN_DEDUCTION_LABEL = "Saldo Dedução";

/** Coluna do Saldo Reembolso. */
export const REEMBOLSO_COLUMN = "deduction_balance_cents";

/** Coluna do stake travado na ativação stake_lock. */
export const LOCKED_STAKE_COLUMN = "locked_balance_cents";

export const WALLET_BUCKETS_SPEC = Object.freeze({
  version: WALLET_BUCKETS_CONTRACT_VERSION,
  columns: WALLET_BUCKET_COLUMNS,
  reembolsoLabel: REEMBOLSO_LABEL,
  reembolsoColumn: REEMBOLSO_COLUMN,
  lockedStakeColumn: LOCKED_STAKE_COLUMN,
  forbiddenLabel: FORBIDDEN_DEDUCTION_LABEL,
});

export function missingWalletColumnsInSelect(selectCsv) {
  const parts = new Set(
    String(selectCsv || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  return WALLET_BUCKET_COLUMNS.filter((c) => !parts.has(c));
}
