/**
 * Contrato anti-regressão — sessão Admin/App:
 * 1) Modo usuário (admin → app) e Modo ADM (app → admin, só admin)
 * 2) Espelho de conta (impersonate): set/get/clear + effective user id
 *
 * Alterar só com pedido explícito do dono (+ bump SYSTEM_NON_REGRESSION).
 */
export const ADMIN_SESSION_MODE_CONTRACT_VERSION =
  "admin-session-mode-contract-v1";
export const ADMIN_SESSION_MODE_LOCK =
  "DO_NOT_CHANGE_ADMIN_SESSION_MODE_WITHOUT_EXPLICIT_REQUEST";

/** Troca Modo usuário ↔ Modo ADM no shell. */
export const ADMIN_MODE_SWITCH = Object.freeze({
  shell: "deploy/vps-supabase/static/v2/v2-shell.js",
  css: "deploy/vps-supabase/static/v2/v2.css",
  v2: "deploy/vps-supabase/static/v2/v2.js",
  mustIncludeShell: Object.freeze([
    'id="v2ModeSwitch"',
    "Modo usuário",
    "Modo ADM",
    'href="/app.html"',
    'href="/admin.html"',
    "Botão Modo ADM só para administradores",
    "requireAdmin",
    "modeBtn.hidden = false",
  ]),
  mustIncludeCss: Object.freeze([
    ".v2-mode-switch",
    ".v2-mode-switch[hidden]",
    'body[data-shell="app"] .v2-mode-switch',
  ]),
  rules: Object.freeze([
    "no admin: link Modo usuário → /app.html sempre visível no header",
    "no app: link Modo ADM → /admin.html começa hidden; só requireAdmin=true revela",
    "não remover v2ModeSwitch nem classes v2-mode-switch",
  ]),
});

/** Espelho de conta (impersonate cliente). */
export const ADMIN_ACCOUNT_MIRROR = Object.freeze({
  v2: "deploy/vps-supabase/static/v2/v2.js",
  shell: "deploy/vps-supabase/static/v2/v2-shell.js",
  usersPage: "deploy/vps-supabase/static/v2/admin-users.html",
  protegerPage: "deploy/vps-supabase/static/v2/app-proteger.html",
  storageKeys: Object.freeze([
    "impersonated_user_id",
    "impersonated_user_name",
  ]),
  mustIncludeV2: Object.freeze([
    'IMPERSONATE_KEY = "impersonated_user_id"',
    'IMPERSONATE_NAME_KEY = "impersonated_user_name"',
    "function getImpersonation",
    "function getEffectiveUserId",
    "function setImpersonation",
    "function clearImpersonation",
    "getImpersonation: getImpersonation",
    "getEffectiveUserId: getEffectiveUserId",
    "setImpersonation: setImpersonation",
    "clearImpersonation: clearImpersonation",
    'redirect || "/app-carteira.html"',
  ]),
  mustIncludeShell: Object.freeze([
    "getEffectiveUserId",
    "getImpersonation",
    "v2ImpersonateBanner",
    "v2ImpersonateExit",
    "Sair do espelho",
    "Espelho · visualizando conta do cliente",
    "clearImpersonation",
    'redirect: "/admin-users.html"',
    '.eq("id", viewUserId)',
  ]),
  mustIncludeUsers: Object.freeze([
    "espelho de conta",
    "function startMirror",
    "setImpersonation",
    'data-mirror="1">Espelho',
    "Acessar Conta (Espelho)",
    'redirect: "/app-carteira.html"',
  ]),
  mustIncludeProteger: Object.freeze([
    "proteger-espelho-readonly-v13",
    "getEffectiveUserId",
    "isMirror",
    "Espelho é somente leitura para ativar proteção",
  ]),
  rules: Object.freeze([
    "espelho usa sessionStorage impersonated_user_id (não troca auth session)",
    "getEffectiveUserId devolve id espelhado nas leituras de carteira/dados",
    "banner Sair do espelho → admin-users; proteger em espelho é readonly",
    "logout limpa impersonation antes do signOut",
  ]),
});

export const ADMIN_SESSION_MODE_SPEC = Object.freeze({
  version: ADMIN_SESSION_MODE_CONTRACT_VERSION,
  lock: ADMIN_SESSION_MODE_LOCK,
  modeSwitch: ADMIN_MODE_SWITCH,
  accountMirror: ADMIN_ACCOUNT_MIRROR,
});
