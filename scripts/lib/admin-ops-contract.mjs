/**
 * Contrato anti-regressão — funções Admin implementadas:
 * 1) Lançar / creditar saldo → Depósitos manuais
 * 2) Lançar jogos → admin-jogos (BetBra + manual + publicar)
 *
 * Alterar só com pedido explícito do dono (+ bump SYSTEM_NON_REGRESSION).
 */
export const ADMIN_OPS_CONTRACT_VERSION = "admin-ops-contract-v1";
export const ADMIN_OPS_LOCK =
  "DO_NOT_CHANGE_ADMIN_OPS_WITHOUT_EXPLICIT_REQUEST";

/** Lançar saldo = aprovar depósito manual (credita bucket certo). */
export const ADMIN_LANCAR_SALDO = Object.freeze({
  page: "deploy/vps-supabase/static/v2/admin-manual-deposits.html",
  build: "admin-deposits-creditar-v1",
  navId: "manual-deposits",
  navLabel: "Depósitos",
  uiMustInclude: Object.freeze([
    "Confirmar e Creditar",
    "Já creditado",
    "creditar saldo como no site antigo",
    "requireFinanceAdmin",
    "/_serverFn/",
    // hashes serverFn (approve / credited / reject)
    "81753fec5a4788d0cecf17daf4605047d90238c386a240b54855a19f0fbc53d2",
    "1b3d8a890eea085aa1507094a9ce6e49ca532e35c3e17363c50b9dc1a253ddd5",
    "97fbb202a39627b7eeade54ac383dd1197c5a76c5f392f3046ee5875fef4da50",
  ]),
  shimMustInclude: Object.freeze([
    "approveManualDeposit",
    "FN.DEPOSIT_APPROVE",
    "Já creditado (sem alterar saldo)",
    "TREASURY_DEPOSIT_IN",
    "requireFinanceAdmin",
    "desafio_balance_cents",
    "investor_balance_cents",
  ]),
  rules: Object.freeze([
    "approve credita 1x no bucket (balance / desafio / investor)",
    "Já creditado marca APPROVED SEM alterar saldo",
    "só finance admin (requireFinanceAdmin)",
  ]),
});

/** Lançar jogos = criar match BetBra/manual + publicar na fila. */
export const ADMIN_LANCAR_JOGOS = Object.freeze({
  page: "deploy/vps-supabase/static/v2/admin-jogos.html",
  build: "admin-jogos-edit-preserva-publicacao-v1",
  navId: "jogos",
  navLabel: "Jogos",
  uiMustInclude: Object.freeze([
    "Lançar evento",
    "Lançar evento manual",
    "Publicar na fila",
    "Liberar proteção / publicar na fila",
    "/api/arbishield/matches",
    "publishMatch",
    "is_published",
    "searchFootballTeams",
    "football-teams",
    "btnSaveManual",
    "btnManualMatch",
    "admin-jogos-edit-preserva-publicacao-v1",
    "confirmEditMatch",
    "Regras ao salvar",
  ]),
  uiMustNotInclude: Object.freeze([
    'id="editPublish"',
    'id="editHide"',
  ]),
  preliveMustInclude: Object.freeze([
    "/api/arbishield/matches",
    "/api/arbishield/test-event",
    "/api/arbishield/unpublish-expired",
    "createMatchFromMarket",
    "createManualMatch",
    "unpublishExpiredPublishedMatches",
    "MANUAL_EXTERNAL_ID_CONFLICT",
  ]),
  rules: Object.freeze([
    "lançamento padrão = rascunho (is_published false) salvo marcar publicar",
    "liquidez obrigatória no fluxo BetBra",
    "não misturar external_id BetBra com admin_manual",
    "unpublish de finalizados/expirados permanece",
    "edição de evento só altera dados — não muda is_published nem hide_from_site",
  ]),
});

export const ADMIN_OPS_SPEC = Object.freeze({
  version: ADMIN_OPS_CONTRACT_VERSION,
  lock: ADMIN_OPS_LOCK,
  lancarSaldo: ADMIN_LANCAR_SALDO,
  lancarJogos: ADMIN_LANCAR_JOGOS,
});
