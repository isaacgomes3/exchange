#!/usr/bin/env bash
# Remove botão Excluir de desafios ativos + bloqueio no shim.
#
# Na VPS (root):
#   bash <(curl -fsSL -H "Accept: application/vnd.github.raw" \
#     "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-esconder-excluir-desafio-ativo.sh?ref=cursor/protecao-v10-fonte-verdade-501d&t=$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/protecao-v10-fonte-verdade-501d}"
BUST="$(date +%s)"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
JSDELIVR="https://cdn.jsdelivr.net/gh/isaacgomes3/exchange@${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield/v2}"
WEB_ROOT="${ARBISHIELD_WEB_ROOT:-/var/www/arbishield}"

die() { echo "ERRO: $*" >&2; exit 1; }
log() { echo "==> $*"; }
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
command -v curl >/dev/null || die "curl"
mkdir -p "$WEB" "$SCRIPTS_DIR"

download() {
  local rel="$1" out="$2" needle="$3"
  local t tmp; t="$(date +%s%N)"; tmp="$(mktemp)"
  if curl -fsSL --retry 3 -H "Accept: application/vnd.github.raw" \
    "$API/$rel?ref=${REF}&t=$t" -o "$tmp" && grep -q "$needle" "$tmp"; then
    mv -f "$tmp" "$out"; return 0
  fi
  if curl -fsSL --retry 3 "$JSDELIVR/$rel?t=$t" -o "$tmp" && grep -q "$needle" "$tmp"; then
    mv -f "$tmp" "$out"; return 0
  fi
  rm -f "$tmp"; die "nao baixou: $rel ($needle)"
}

log "admin-desafios.html (sem Excluir em ativo)"
download "deploy/vps-supabase/static/v2/admin-desafios.html" "$WEB/admin-desafios.html" "hide-excluir-desafio-ativo-v1"
cp -f "$WEB/admin-desafios.html" "$WEB_ROOT/admin-desafios.html" 2>/dev/null || true
sed -i -E "s|/v2\\.js(\\?[^\"]*)?|/v2.js?v=no-del-ativo-$BUST|g; s|/v2-shell\\.js(\\?[^\"]*)?|/v2-shell.js?v=no-del-ativo-$BUST|g" \
  "$WEB/admin-desafios.html" "$WEB_ROOT/admin-desafios.html" 2>/dev/null || true

log "shim (bloqueia delete de ativo)"
SHIM_UNIT="$(systemctl show -p ExecStart --value arbishield-serverfn-shim.service 2>/dev/null || true)"
SHIM_PATH=""
if [[ "$SHIM_UNIT" == *arbishield-serverfn-shim.mjs* ]]; then
  SHIM_PATH="$(echo "$SHIM_UNIT" | grep -oE '/[^ ]+arbishield-serverfn-shim\.mjs' | head -1 || true)"
fi
[[ -n "${SHIM_PATH:-}" ]] || SHIM_PATH="$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
download "scripts/arbishield-serverfn-shim.mjs" "$SHIM_PATH" "hide-excluir-desafio-ativo-v1"
cp -f "$SHIM_PATH" "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" 2>/dev/null || true
chmod 0644 "$SHIM_PATH" 2>/dev/null || true
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

echo "OK — Excluir some em desafios ativos; API bloqueia is_active sem force."
echo "Hard refresh em /admin-desafios.html"
