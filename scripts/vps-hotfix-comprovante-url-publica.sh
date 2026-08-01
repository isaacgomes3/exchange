#!/usr/bin/env bash
# Corrige comprovante quebrado (URL assinada com 127.0.0.1 no browser).
#
# Na VPS (root):
#   bash <(curl -fsSL -H "Accept: application/vnd.github.raw" \
#     "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-comprovante-url-publica.sh?ref=main&t=$(date +%s)")
set -euo pipefail

BRANCH="${ARBISHIELD_REF:-main}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
BUST="$(date +%s)"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl
need python3
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
mkdir -p "$WEB" "$WEB_ROOT" "$SCRIPTS_DIR"

log "resolvendo tip $BRANCH"
SHA="${ARBISHIELD_SHA:-$(
  curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/commits/${BRANCH}?t=${BUST}" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["sha"])'
)}"
log "tip=$SHA"

RAW_JS="https://cdn.jsdelivr.net/gh/isaacgomes3/exchange@${SHA}"
RAW_GH="https://raw.githubusercontent.com/isaacgomes3/exchange/${SHA}"
RAW_API="https://api.github.com/repos/isaacgomes3/exchange/contents"

fetch() {
  local rel="$1" dest="$2"
  curl -fsSL "${RAW_JS}/${rel}?t=${BUST}" -o "$dest" && return 0
  curl -fsSL "${RAW_GH}/${rel}?t=${BUST}" -o "$dest" && return 0
  curl -fsSL -H "Accept: application/vnd.github.raw" \
    "${RAW_API}/${rel}?ref=${SHA}&t=${BUST}" -o "$dest"
}

log "1/2 UI admin-manual-deposits.html"
fetch "deploy/vps-supabase/static/v2/admin-manual-deposits.html" "$WEB/admin-manual-deposits.html"
chmod 0644 "$WEB/admin-manual-deposits.html"
cp -f "$WEB/admin-manual-deposits.html" "$WEB_ROOT/admin-manual-deposits.html" 2>/dev/null || true
grep -q 'deposit-proof-public-url-v1' "$WEB/admin-manual-deposits.html" || die "HTML sem marker deposit-proof-public-url-v1"
grep -q 'publicizeStorageUrl' "$WEB/admin-manual-deposits.html" || die "HTML sem publicizeStorageUrl"

log "2/2 shim toBrowserStorageUrl"
TMP="$(mktemp)"
fetch "scripts/arbishield-serverfn-shim.mjs" "$TMP"
grep -q 'deposit-proof-public-url-v1' "$TMP" || die "shim sem marker"
grep -q 'toBrowserStorageUrl' "$TMP" || die "shim sem toBrowserStorageUrl"

SHIMS=()
EXEC_LINE="$(systemctl show -p ExecStart --value arbishield-serverfn-shim.service 2>/dev/null || true)"
if [[ "$EXEC_LINE" == *arbishield-serverfn-shim.mjs* ]]; then
  SHIMS+=("$(echo "$EXEC_LINE" | grep -oE '/[^ ]+arbishield-serverfn-shim\.mjs' | head -1 || true)")
fi
SHIMS+=(
  "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
  /opt/arbishield/arbishield-serverfn-shim.mjs
  /opt/arbishield/scripts/arbishield-serverfn-shim.mjs
)
for dest in "${SHIMS[@]}"; do
  [[ -n "${dest:-}" ]] || continue
  mkdir -p "$(dirname "$dest")"
  cp -f "$TMP" "$dest"
  chmod 0644 "$dest"
  log "shim → $dest"
done
rm -f "$TMP"

# Garante SITE_URL público no .env do compose (para PUBLIC_SITE_URL)
ENV_FILE="${ARBISHIELD_ENV:-/opt/arbishield/deploy/vps-supabase/.env}"
if [[ -f "$ENV_FILE" ]]; then
  if ! grep -qE '^SITE_URL=https?://' "$ENV_FILE"; then
    echo "SITE_URL=https://arbishield.app" >> "$ENV_FILE"
    log "SITE_URL adicionado em $ENV_FILE"
  elif grep -qE '^SITE_URL=https?://(127\.0\.0\.1|localhost)' "$ENV_FILE"; then
    sed -i -E 's|^SITE_URL=.*|SITE_URL=https://arbishield.app|' "$ENV_FILE"
    log "SITE_URL corrigido para https://arbishield.app"
  fi
fi

systemctl restart arbishield-serverfn-shim.service 2>/dev/null || \
  systemctl restart arbishield-shim.service 2>/dev/null || \
  log "AVISO: reinicie o shim :3101"

echo
echo "OK — comprovante com URL pública"
echo "  tip=$SHA"
echo "  Ctrl+Shift+R em /admin-manual-deposits.html → Ver comprovante"
echo "  Marker: deposit-proof-public-url-v1"
