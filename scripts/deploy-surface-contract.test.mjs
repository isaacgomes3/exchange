/**
 * Anti-regressão superfície de deploy / API.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { DEPLOY_SURFACE_SPEC } from "./lib/deploy-surface-contract.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

describe("deploy surface — rotas, scripts, unit path", () => {
  it("versão e markers health", () => {
    assert.equal(
      DEPLOY_SURFACE_SPEC.version,
      "deploy-surface-contract-v1"
    );
    assert.equal(
      DEPLOY_SURFACE_SPEC.healthMarkers.runtime,
      "protection-runtime-stake-lock-v10"
    );
    assert.equal(DEPLOY_SURFACE_SPEC.healthMarkers.model, "stake_lock_v1");
  });

  it("prelive mantém football-teams + markers stake_lock", () => {
    const prelive = readFileSync(
      resolve(root, "scripts/arbishield-prelive-events.mjs"),
      "utf8"
    );
    for (const needle of DEPLOY_SURFACE_SPEC.preliveMustInclude) {
      assert.match(prelive, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("fee_upfront prod bloqueado; check/restart/logo sob v10", () => {
    const fee = readFileSync(
      resolve(root, DEPLOY_SURFACE_SPEC.feeUpfrontDeployScript),
      "utf8"
    );
    const check = readFileSync(
      resolve(root, DEPLOY_SURFACE_SPEC.posDeployCheck),
      "utf8"
    );
    const restart = readFileSync(
      resolve(root, DEPLOY_SURFACE_SPEC.restartScript),
      "utf8"
    );
    const logo = readFileSync(
      resolve(root, DEPLOY_SURFACE_SPEC.logoRestoreScript),
      "utf8"
    );
    assert.match(
      fee,
      new RegExp(DEPLOY_SURFACE_SPEC.feeUpfrontDeployMustBlockUnless)
    );
    assert.match(fee, /BLOQUEADO/);
    assert.match(check, /vps-check-pos-deploy-v10/);
    assert.match(restart, /opt\/arbishield\/scripts\/arbishield-serverfn-shim/);
    assert.match(logo, new RegExp(DEPLOY_SURFACE_SPEC.v10Branch));
    assert.match(logo, /stake_lock_v1/);
  });

  it("unit service aponta para scripts/shim", () => {
    const unit = readFileSync(
      resolve(root, "deploy/vps-supabase/arbishield-serverfn-shim.service"),
      "utf8"
    );
    assert.match(unit, /\/opt\/arbishield\/scripts\/arbishield-serverfn-shim\.mjs/);
    assert.match(unit, /3101/);
  });

  it("admin-jogos e v2.js: busca logos", () => {
    const admin = readFileSync(
      resolve(root, "deploy/vps-supabase/static/v2/admin-jogos.html"),
      "utf8"
    );
    const v2 = readFileSync(
      resolve(root, "deploy/vps-supabase/static/v2/v2.js"),
      "utf8"
    );
    assert.match(admin, /searchFootballTeams|football-teams/);
    assert.match(v2, /searchFootballTeams|football-teams/);
  });
});
