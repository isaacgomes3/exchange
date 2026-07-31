#!/usr/bin/env bash
# Hotfix: remove Cancelar/Excluir em desafios em andamento (UI + API)
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/bloquear-cancelar-excluir-andamento-3e4b/scripts/vps-hotfix-bloquear-cancelar-excluir-andamento.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/bloquear-cancelar-excluir-andamento-3e4b}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
CACHE_V="block-cancel-and-1"

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

log "admin-desafios.html"
fetch "deploy/vps-supabase/static/v2/admin-desafios.html" "$WEB/admin-desafios.html"
chmod 0644 "$WEB/admin-desafios.html"
cp -f "$WEB/admin-desafios.html" "$WEB_ROOT/admin-desafios.html" 2>/dev/null || true
grep -q 'Em andamento · Cancelar/Excluir bloqueados' "$WEB/admin-desafios.html" \
  || die "admin-desafios sem bloqueio visual"
sed -i -E \
  -e "s|/v2\\.js(\\?[^\"]*)?|/v2.js?v=${CACHE_V}|g" \
  -e "s|/v2-shell\\.js(\\?[^\"]*)?|/v2-shell.js?v=${CACHE_V}|g" \
  "$WEB/admin-desafios.html" "$WEB_ROOT/admin-desafios.html" 2>/dev/null || true

EXEC_LINE="$(systemctl show -p ExecStart --value arbishield-serverfn-shim.service 2>/dev/null || true)"
SHIM_PATH=""
if [[ "$EXEC_LINE" == *arbishield-serverfn-shim.mjs* ]]; then
  SHIM_PATH="$(echo "$EXEC_LINE" | grep -oE '/[^ ]+arbishield-serverfn-shim\.mjs' | head -1 || true)"
fi
if [[ -z "${SHIM_PATH:-}" ]]; then
  for c in "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" /opt/arbishield/arbishield-serverfn-shim.mjs; do
    [[ -f "$c" ]] && SHIM_PATH="$c" && break
  done
fi
[[ -n "${SHIM_PATH:-}" ]] || SHIM_PATH="$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
mkdir -p "$(dirname "$SHIM_PATH")"
log "Atualizando shim em $SHIM_PATH"
fetch "scripts/arbishield-serverfn-shim.mjs" "$SHIM_PATH"
chmod 0644 "$SHIM_PATH"
grep -q 'block-cancel-delete-andamento-v1' "$SHIM_PATH" || die "shim sem bloqueio API"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

log "OK — Cancelar/Excluir bloqueados em desafios em andamento"
log "  Ctrl+F5 em /admin-desafios.html"
