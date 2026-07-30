/**
 * Anti-regressão schema profiles via migrations (offline).
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  PROFILES_DB_CONTRACT_VERSION,
  PROFILES_DB_REQUIRED,
  PROFILES_DB_SPEC,
} from "./lib/profiles-db-contract.mjs";
import { PROFILES_HAS_EMAIL_COLUMN } from "./lib/profiles-schema.mjs";
import { WALLET_BUCKET_COLUMNS } from "./lib/wallet-buckets-contract.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

describe("profiles DB contract — migrations", () => {
  it("versão e sem email", () => {
    assert.equal(PROFILES_DB_CONTRACT_VERSION, "profiles-db-contract-v1");
    assert.equal(PROFILES_DB_SPEC.hasEmailColumn, false);
    assert.equal(PROFILES_HAS_EMAIL_COLUMN, false);
  });

  it("migrations críticas presentes", () => {
    for (const item of PROFILES_DB_REQUIRED.migrationNeedles) {
      const p = resolve(root, item.file);
      assert.equal(existsSync(p), true, `faltando ${item.file}`);
      const text = readFileSync(p, "utf8");
      for (const needle of item.mustInclude) {
        assert.match(text, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      }
    }
  });

  it("RPC saque Reembolso e colunas wallet citadas no repo", () => {
    const rpcMig = readFileSync(
      resolve(
        root,
        "supabase/migrations/20260725_request_saldo_reembolso_withdrawal.sql"
      ),
      "utf8"
    );
    assert.match(rpcMig, /request_saldo_reembolso_withdrawal/);
    for (const col of ["deduction_balance_cents", "locked_balance_cents"]) {
      assert.ok(WALLET_BUCKET_COLUMNS.includes(col));
    }
  });
});
