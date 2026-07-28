/**
 * Scaffold da proteção ArbiShield — implementação do zero.
 * Versão: protecao-do-zero-v1
 *
 * Estado atual: STUB (não implementado).
 * Fluxo alvo (quando implementar):
 *   1) create — debitar Apostador, creditar Congelado, gravar proteção
 *   2) settle — zerar Congelado da partida, creditar reembolso no Apostador
 *
 * Ligações futuras (hoje stubs 501):
 *   - scripts/arbishield-prelive-events.mjs  createProtection / settleMatchFromBody
 *   - scripts/arbishield-serverfn-shim.mjs   settleMatch / creditWalletForSettlement
 *   - src/lib/arbishield/create-protection.ts
 */

export const PROTECTION_FLOW_VERSION = "protecao-do-zero-v1";

export function notImplemented(op) {
  const err = new Error(
    `[${PROTECTION_FLOW_VERSION}] ${op} ainda não implementado — proteção do zero.`
  );
  err.code = "PROTECTION_NOT_IMPLEMENTED";
  err.status = 501;
  return err;
}

export async function createProtection(_input) {
  throw notImplemented("createProtection");
}

export async function settleMatch(_input) {
  throw notImplemented("settleMatch");
}
