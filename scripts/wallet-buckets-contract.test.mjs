/**
 * Anti-regressão carteira — colunas + labels.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { PROFILES_SAFE_SELECT_BASE } from "./lib/profiles-schema.mjs";
import {
  WALLET_BUCKETS_CONTRACT_VERSION,
  WALLET_BUCKET_COLUMNS,
  REEMBOLSO_LABEL,
  FORBIDDEN_DEDUCTION_LABEL,
  REEMBOLSO_COLUMN,
  LOCKED_STAKE_COLUMN,
  missingWalletColumnsInSelect,
} from "./lib/wallet-buckets-contract.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

describe("wallet buckets — columns + labels", () => {
  it("versão e colunas canônicas", () => {
    assert.equal(WALLET_BUCKETS_CONTRACT_VERSION, "wallet-buckets-contract-v1");
    assert.ok(WALLET_BUCKET_COLUMNS.includes(REEMBOLSO_COLUMN));
    assert.ok(WALLET_BUCKET_COLUMNS.includes(LOCKED_STAKE_COLUMN));
    assert.deepEqual(missingWalletColumnsInSelect(PROFILES_SAFE_SELECT_BASE), []);
  });

  it("app-carteira e v2-financeiro: Saldo Reembolso, sem Saldo Dedução", () => {
    const carteira = readFileSync(
      resolve(root, "deploy/vps-supabase/static/v2/app-carteira.html"),
      "utf8"
    );
    const fin = readFileSync(
      resolve(root, "deploy/vps-supabase/static/v2/v2-financeiro.js"),
      "utf8"
    );
    assert.match(carteira, new RegExp(REEMBOLSO_LABEL));
    assert.doesNotMatch(carteira, new RegExp(FORBIDDEN_DEDUCTION_LABEL));
    assert.match(fin, new RegExp(REEMBOLSO_LABEL));
    assert.match(fin, new RegExp(REEMBOLSO_COLUMN));
    assert.match(fin, new RegExp(LOCKED_STAKE_COLUMN));
    assert.doesNotMatch(fin, /Saldo Dedução/);
  });

  it("app-proteger consulta locked + deduction buckets", () => {
    const html = readFileSync(
      resolve(root, "deploy/vps-supabase/static/v2/app-proteger.html"),
      "utf8"
    );
    assert.match(html, /locked_balance_cents/);
    assert.match(html, /deduction_balance_cents/);
  });
});
