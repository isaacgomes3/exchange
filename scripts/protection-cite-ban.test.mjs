/**
 * CI: superfícies de produto jamais citam modelos antigos de proteção.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  NEVER_CITE_OBSOLETE_PROTECTION_MODELS,
  PROTECTION_CITE_BAN_PATHS,
  findBannedProtectionCites,
  healthCitesObsoleteProtectionModel,
} from "./lib/protection-cite-ban.mjs";
import {
  CANCEL_LEGACY_NO_STAKE_OVERCREDIT,
  PROTECTION_BILLING_MODEL_CANONICAL,
  PROTECTION_FLOW_CONTRACT_VERSION,
  PROTECTION_FLOW_LOCK,
  PROTECTION_RUNTIME_HEALTH_MARKER,
  CREATE_PROTECTION_FIX_MARKER,
  EXCHANGE_CHARGE_DEDUCTION_RULE,
  isProtectionRuntimeHealthy,
} from "./lib/protection-flow-contract.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

describe("protection cite ban — superfícies de produto", () => {
  it("marker NEVER_CITE presente", () => {
    assert.equal(
      NEVER_CITE_OBSOLETE_PROTECTION_MODELS,
      "NEVER_CITE_OBSOLETE_PROTECTION_MODELS"
    );
  });

  for (const rel of PROTECTION_CITE_BAN_PATHS) {
    it(`não cita modelo antigo: ${rel}`, () => {
      const text = readFileSync(resolve(root, rel), "utf8");
      const hits = findBannedProtectionCites(text);
      assert.deepEqual(
        hits,
        [],
        `${rel} contém citação proibida: ${hits.join(", ")}`
      );
    });
  }

  it("health canônico não cita modelo antigo e é saudável", () => {
    const health = {
      ok: true,
      service: "arbishield-matches",
      fix: CREATE_PROTECTION_FIX_MARKER,
      protectionRuntime: PROTECTION_RUNTIME_HEALTH_MARKER,
      createProtectionModel: PROTECTION_BILLING_MODEL_CANONICAL,
      cancelRefundGuard: CANCEL_LEGACY_NO_STAKE_OVERCREDIT,
      exchangeChargeGuard: EXCHANGE_CHARGE_DEDUCTION_RULE,
      protectionFlowContract: PROTECTION_FLOW_CONTRACT_VERSION,
      protectionFlowLock: PROTECTION_FLOW_LOCK,
    };
    assert.equal(healthCitesObsoleteProtectionModel(health), false);
    assert.equal(isProtectionRuntimeHealthy(health), true);
    assert.match(
      CANCEL_LEGACY_NO_STAKE_OVERCREDIT,
      /^cancel-legacy-no-stake-overcredit-v10$/
    );
    assert.doesNotMatch(CANCEL_LEGACY_NO_STAKE_OVERCREDIT, /fee_upfront/i);
  });

  it("health com modelo antigo falha", () => {
    assert.equal(
      healthCitesObsoleteProtectionModel({
        createProtectionModel: "fee_upfront_v1",
      }),
      true
    );
    assert.equal(
      isProtectionRuntimeHealthy({
        createProtectionModel: "fee_upfront_v1",
        protectionRuntime: PROTECTION_RUNTIME_HEALTH_MARKER,
      }),
      false
    );
  });
});
