#!/usr/bin/env bash
# Hotfix: inserir/alterar saldo para adm financeiro (Usuários + shim)
#
# Liberado apenas para a allowlist Financeiro (isaac + financeiro@).
# Demais admins continuam sem o painel/API de ajuste.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/saldo-adm-financeiro-2406/scripts/vps-hotfix-saldo-adm-financeiro.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/saldo-adm-financeiro-2406}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
CACHE_V="users-saldo-fin-1"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
need python3
mkdir -p "$WEB" "$SCRIPTS_DIR" "$WEB_ROOT"

log "resolvendo tip de $BRANCH"
SHA="$(
  curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/commits/${BRANCH}" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["sha"])'
)"
log "tip=$SHA"
RAW_JS="https://cdn.jsdelivr.net/gh/isaacgomes3/exchange@${SHA}"
RAW_GH="https://raw.githubusercontent.com/isaacgomes3/exchange/${SHA}"

fetch() {
  local rel="$1" dest="$2"
  if curl -fsSL "${RAW_JS}/${rel}" -o "$dest"; then return 0; fi
  curl -fsSL "${RAW_GH}/${rel}?t=$(date +%s)" -o "$dest"
}

log "admin-users.html (painel inserir/alterar saldo)"
fetch "deploy/vps-supabase/static/v2/admin-users.html" "$WEB/admin-users.html"
chmod 0644 "$WEB/admin-users.html"
cp -f "$WEB/admin-users.html" "$WEB_ROOT/admin-users.html" 2>/dev/null || true
grep -q 'adjust-balance\|Ajuste de' "$WEB/admin-users.html" || die "admin-users sem painel de saldo"
grep -q 'canAccessFinance' "$WEB/admin-users.html" || die "admin-users sem gate financeiro"

# cache-bust local
sed -i -E \
  -e "s|/v2\\.css(\\?[^\"]*)?|/v2.css?v=${CACHE_V}|g" \
  -e "s|/v2\\.js(\\?[^\"]*)?|/v2.js?v=${CACHE_V}|g" \
  -e "s|/v2-shell\\.js(\\?[^\"]*)?|/v2-shell.js?v=${CACHE_V}|g" \
  -e "s|/finance-admins\\.js(\\?[^\"]*)?|/finance-admins.js?v=${CACHE_V}|g" \
  "$WEB/admin-users.html" || true
cp -f "$WEB/admin-users.html" "$WEB_ROOT/admin-users.html" 2>/dev/null || true

# Shim
EXEC_LINE="$(systemctl show -p ExecStart --value arbishield-serverfn-shim.service 2>/dev/null || true)"
SHIM_PATH=""
if [[ "$EXEC_LINE" == *arbishield-serverfn-shim.mjs* ]]; then
  SHIM_PATH="$(echo "$EXEC_LINE" | grep -oE '/[^ ]+arbishield-serverfn-shim\.mjs' | head -1 || true)"
fi
if [[ -z "${SHIM_PATH:-}" ]]; then
  for c in "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" /opt/arbishield/arbishield-serverfn-shim.mjs /opt/arbishield/scripts/arbishield-serverfn-shim.mjs; do
    [[ -f "$c" ]] && SHIM_PATH="$c" && break
  done
fi
[[ -n "${SHIM_PATH:-}" ]] || SHIM_PATH="$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
mkdir -p "$(dirname "$SHIM_PATH")"
log "Atualizando shim em $SHIM_PATH"
fetch "scripts/arbishield-serverfn-shim.mjs" "$SHIM_PATH"
chmod 0644 "$SHIM_PATH"
grep -q 'adjustAdminBalance' "$SHIM_PATH" || die "shim sem adjustAdminBalance"
grep -q '/api/arbishield/adjust-balance' "$SHIM_PATH" || die "shim sem rota adjust-balance"
grep -q 'requireFinanceAdmin' "$SHIM_PATH" || die "shim sem requireFinanceAdmin"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

log "Smoke :3101 adjust-balance (sem token → unauthorized)"
SMOKE="$(curl -sS -X POST http://127.0.0.1:3101/api/arbishield/adjust-balance -H 'Content-Type: application/json' -d '{}' || true)"
echo "$SMOKE" | grep -q 'not_found' && die "shim ainda responde not_found"
echo "$SMOKE" | grep -Eqi 'Não autorizado|Unauthorized|token|negado|permiss' \
  || log "resposta smoke: $SMOKE"

log "OK — saldo adm financeiro"
log "  UI: /admin-users.html (botão Saldo / painel no drawer)"
log "  API: POST /api/arbishield/adjust-balance"
log "  liberados: isaacgomes3@gmail.com, financeiro@arbishield.com"
log "  Ctrl+F5 em /admin-users.html"
