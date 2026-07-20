#!/usr/bin/env bash
# Hotfix: destravar ADMIN — desliga Realtime/poll do shell que congela o SPA.
#
# Uso na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/admin-ops-fix-723d/scripts/vps-hotfix-admin-unfreeze.sh?v=3")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/admin-ops-fix-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
SCRIPTS_DIR="${SCRIPTS_DIR:-/opt/arbishield/scripts}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }

for cmd in curl python3 systemctl; do
  command -v "$cmd" >/dev/null 2>&1 || die "comando '$cmd' não encontrado"
done

mkdir -p "$SCRIPTS_DIR" "$WEB/assets"
download() { curl -fsSL "$RAW/$1" -o "$2"; }

log "1/4 — CSS seguro (sem seletor *)"
download "deploy/vps-supabase/static/admin-modal-fix.js" "$WEB/assets/admin-modal-fix.js"
download "deploy/vps-supabase/static/app-stability.js" "$WEB/assets/app-stability.js"
download "deploy/vps-supabase/static/app-boot-fix.js" "$WEB/assets/app-boot-fix.js"
chmod 0644 "$WEB/assets/admin-modal-fix.js" "$WEB/assets/app-stability.js" "$WEB/assets/app-boot-fix.js"

log "2/4 — desligar watchers Realtime do shell admin (causa do freeze global)"
download "scripts/arbishield-patch-admin-watchers.py" "$SCRIPTS_DIR/arbishield-patch-admin-watchers.py"
python3 "$SCRIPTS_DIR/arbishield-patch-admin-watchers.py" "$WEB"

log "3/4 — patch users + main freeze residual"
download "scripts/arbishield-patch-admin-users-freeze.py" "$SCRIPTS_DIR/arbishield-patch-admin-users-freeze.py"
python3 "$SCRIPTS_DIR/arbishield-patch-admin-users-freeze.py" "$WEB" || true
download "scripts/arbishield-patch-main-freeze.py" "$SCRIPTS_DIR/arbishield-patch-main-freeze.py"
python3 "$SCRIPTS_DIR/arbishield-patch-main-freeze.py" "$WEB" || true

log "4/4 — shim serverFn (lista usuários limitada)"
download "scripts/arbishield-serverfn-shim.mjs" "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
chmod 755 "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
if systemctl is-active --quiet arbishield-serverfn-shim.service 2>/dev/null; then
  systemctl restart arbishield-serverfn-shim.service
  log "shim :3101 reiniciado"
fi

# Cache bust
touch "$WEB/assets"/main-*.js "$WEB/assets"/admin.users-*.js 2>/dev/null || true

echo
echo "OK — admin unfreeze v3 (Realtime do shell desligado)"
echo "  OBRIGATÓRIO: feche a aba do admin e abra de novo (ou Ctrl+Shift+R)"
echo "  Confirme no console:"
echo "    document.body.innerText.includes = n/a"
echo "    grep noop:  curl -sS https://arbishield.app/assets/main-D_khrzRh.js | grep -o 'arbishield-noop:[a-zA-Z0-9]*' | sort -u"
