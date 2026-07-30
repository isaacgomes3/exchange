/**
 * Contrato anti-reversão — layouts Admin já aprovados:
 * 1) Menu lateral em accordion (só títulos; clique abre itens)
 * 2) Monitor de Desafios em cards (topo / jogo / rodapé)
 *
 * Alterar só com pedido explícito do dono (+ bump SYSTEM_NON_REGRESSION).
 */
export const ADMIN_UI_LAYOUT_CONTRACT_VERSION = "admin-ui-layout-contract-v1";
export const ADMIN_UI_LAYOUT_LOCK =
  "DO_NOT_CHANGE_ADMIN_UI_LAYOUT_WITHOUT_EXPLICIT_REQUEST";

/** Menu admin accordion — shell + CSS. */
export const ADMIN_NAV_ACCORDION = Object.freeze({
  shell: "deploy/vps-supabase/static/v2/v2-shell.js",
  css: "deploy/vps-supabase/static/v2/v2.css",
  hotfix: "scripts/vps-hotfix-admin-menu-accordion.sh",
  mustIncludeShell: Object.freeze([
    "bindAdminNavAccordion",
    "v2-nav-accordion-btn",
    "v2-nav-group-items",
    "accordion: shell === \"admin\"",
    'if (shell === "admin") bindAdminNavAccordion(sidebar)',
  ]),
  mustIncludeCss: Object.freeze([
    "v2-nav-accordion-btn",
    'body[data-shell="admin"] .v2-nav-group.is-open',
    "sec-chevron",
  ]),
  rules: Object.freeze([
    "no admin: só títulos de seção visíveis; itens escondidos até clique",
    "seção com página ativa começa aberta",
    "não voltar menu admin com todas as seções sempre expandidas",
  ]),
});

/** Monitor de Desafios — cards em 3 zonas. */
export const ADMIN_MONITOR_DESAFIOS_CARDS = Object.freeze({
  page: "deploy/vps-supabase/static/v2/admin-monitoring-desafios.html",
  build: "desafio-monitor-card-layout-v1",
  hotfix: "scripts/vps-hotfix-monitor-desafios-card-layout.sh",
  mustInclude: Object.freeze([
    "desafio-monitor-card-layout-v1",
    "mdz-cards",
    "mdz-card-top",
    "mdz-card-game",
    "mdz-card-foot",
    "mdz-card-markets",
    "Bateu Arbi",
    "Bateu Casa",
    "Empate Anula",
    "data-settle",
    "settleStep",
  ]),
  mustNotInclude: Object.freeze([
    // layout antigo em tabela densa (regressão visual)
    '<table class="mdz">',
  ]),
  rules: Object.freeze([
    "card = topo (cliente/etapa/status) + meio (jogo/mercados) + rodapé (valores/ações)",
    "settle Bateu Arbi / Bateu Casa / Empate Anula permanece",
    "não reverter para tabela .mdz densa",
  ]),
});

export const ADMIN_UI_LAYOUT_SPEC = Object.freeze({
  version: ADMIN_UI_LAYOUT_CONTRACT_VERSION,
  lock: ADMIN_UI_LAYOUT_LOCK,
  accordion: ADMIN_NAV_ACCORDION,
  monitorDesafios: ADMIN_MONITOR_DESAFIOS_CARDS,
});
