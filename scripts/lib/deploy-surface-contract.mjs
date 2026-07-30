/**
 * Contrato da superfície de deploy / API — anti-regressão.
 * Rotas, scripts perigosos, paths do unit.
 */
export const DEPLOY_SURFACE_CONTRACT_VERSION = "deploy-surface-contract-v1";

export const DEPLOY_SURFACE_SPEC = Object.freeze({
  version: DEPLOY_SURFACE_CONTRACT_VERSION,
  healthMarkers: Object.freeze({
    runtime: "protection-runtime-stake-lock-v10",
    model: "stake_lock_v1",
    contract: "protection-flow-contract-v10",
    createFix: "create-protection-stake-lock-v6",
  }),
  preliveMustInclude: Object.freeze([
    "/api/arbishield/football-teams",
    "searchFootballTeams",
    "protection-runtime-stake-lock-v10",
    "create-protection-stake-lock-v6",
    "stake_lock_v1",
  ]),
  shimUnitPath: "/opt/arbishield/scripts/arbishield-serverfn-shim.mjs",
  feeUpfrontDeployScript: "scripts/vps-atualizar-protecao-fee-upfront-prod.sh",
  feeUpfrontDeployMustBlockUnless: "ALLOW_FEE_UPFRONT_DEPLOY",
  posDeployCheck: "scripts/vps-check-pos-deploy-v10.sh",
  restartScript: "scripts/vps-restart-stake-lock-v10.sh",
  logoRestoreScript: "scripts/vps-restaurar-api-logo-times.sh",
  v10Branch: "cursor/protecao-v10-fonte-verdade-501d",
});
