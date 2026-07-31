/**
 * Banimento de citação de modelos antigos de proteção em superfícies de produto.
 * Pedido explícito (2026-07-31): NEVER_CITE_OBSOLETE_PROTECTION_MODELS
 *
 * Runtime interno (contrato/tests/repair) pode ainda reconhecer bilhetes
 * antigos no banco — isso NÃO pode vazar para AGENTS/docs/UI/health.
 */
export const NEVER_CITE_OBSOLETE_PROTECTION_MODELS =
  "NEVER_CITE_OBSOLETE_PROTECTION_MODELS";

/** Padrões proibidos em superfícies de produto (case-insensitive). */
export const PROTECTION_CITE_BAN_PATTERNS = Object.freeze([
  /fee_upfront/i,
  /locked_margin_v2/i,
  /lock_fee_after/i,
  /FLUXO_PROTECAO_V1/i,
  /fluxo-protecao-v1/i,
  /cancel-fee-upfront/i,
  /protection-fee-upfront/i,
]);

/** Arquivos que agentes/usuários leem como “o fluxo”. */
export const PROTECTION_CITE_BAN_PATHS = Object.freeze([
  "AGENTS.md",
  "docs/PROTECTION_FLOW_LOCKED.md",
  "docs/PROTECTION_FLOW_COMPARISON_OLD_VS_NEW.md",
  "docs/FLUXO_PROTECAO_1_PAGINA.html",
  "deploy/vps-supabase/static/v2/app-proteger.html",
  "deploy/vps-supabase/static/v2/app-protecoes.html",
  "deploy/vps-supabase/static/v2/admin-jogos.html",
]);

export function findBannedProtectionCites(text) {
  const hits = [];
  const src = String(text || "");
  for (const re of PROTECTION_CITE_BAN_PATTERNS) {
    const m = src.match(re);
    if (m) hits.push(m[0]);
  }
  return hits;
}

/** Health JSON não pode citar modelo antigo em nenhum campo. */
export function healthCitesObsoleteProtectionModel(health) {
  return findBannedProtectionCites(JSON.stringify(health || {})).length > 0;
}
