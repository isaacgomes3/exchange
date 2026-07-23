#!/usr/bin/env bash
# Hotfix emergencial: destravar área de membros (/app, /m).
# Remove patches agressivos (history, cache wipe, guard jogos) e corrige Promise eterno no main.js.
#
# Uso na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/admin-ops-fix-723d/scripts/vps-hotfix-unfreeze-site.sh?v=2")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/admin-ops-fix-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
SCRIPTS_DIR="${SCRIPTS_DIR:-/opt/arbishield/scripts}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }

for cmd in curl python3; do
  command -v "$cmd" >/dev/null 2>&1 || die "comando '$cmd' não encontrado"
done

mkdir -p "$SCRIPTS_DIR" "$WEB/assets"

download() { curl -fsSL "$RAW/$1" -o "$2"; }

log "1/5 — scripts leves (sem mexer no router)"
download "deploy/vps-supabase/static/app-boot-fix.js" "$WEB/assets/app-boot-fix.js"
download "deploy/vps-supabase/static/app-stability.js" "$WEB/assets/app-stability.js"
download "deploy/vps-supabase/static/auth-boot-fix.js" "$WEB/assets/auth-boot-fix.js"
download "deploy/vps-supabase/static/admin-modal-fix.js" "$WEB/assets/admin-modal-fix.js"
chmod 0644 \
  "$WEB/assets/app-boot-fix.js" \
  "$WEB/assets/app-stability.js" \
  "$WEB/assets/auth-boot-fix.js" \
  "$WEB/assets/admin-modal-fix.js"

log "2/5 — remover guard Jogos do index.html (se existir)"
INDEX="$WEB/index.html"
if [[ -f "$INDEX" ]]; then
  python3 <<'PY'
import re
from pathlib import Path

index = Path("/var/www/arbishield/index.html")
html = index.read_text(encoding="utf-8", errors="replace")
html = re.sub(
    r'<script[^>]*data-arbishield="jogos-guard"[^>]*>[\s\S]*?</script>\s*',
    "",
    html,
    flags=re.I,
)
html = re.sub(
    r'<style[^>]*data-arbishield="jogos-guard"[^>]*>[\s\S]*?</style>\s*',
    "",
    html,
    flags=re.I,
)
html = html.replace('<script src="/assets/admin-jogos-guard.js"></script>', "")
html = html.replace('<script src="/assets/admin-jogos-force-vps.js"></script>', "")

boot = '<script src="/assets/app-boot-fix.js"></script>'
if boot not in html:
    needle = '<script src="/assets/app-stability.js"></script>'
    if needle in html:
        html = html.replace(needle, boot + needle, 1)
    elif "</head>" in html:
        html = html.replace("</head>", "    " + boot + "\n  </head>", 1)

index.write_text(html, encoding="utf-8")
print("index.html: guard jogos removido, app-boot-fix garantido")
PY
fi

log "3/5 — patch main.js (Promise eterno no serverFn / beforeLoad)"
download "scripts/arbishield-patch-main-freeze.py" "$SCRIPTS_DIR/arbishield-patch-main-freeze.py"
python3 "$SCRIPTS_DIR/arbishield-patch-main-freeze.py" "$WEB"

log "4/5 — patch admin.users (busca clientes sem freeze)"
download "scripts/arbishield-patch-admin-users-freeze.py" "$SCRIPTS_DIR/arbishield-patch-admin-users-freeze.py"
python3 "$SCRIPTS_DIR/arbishield-patch-admin-users-freeze.py" "$WEB"

log "5/5 — shim serverFn (mantém dashboard membro)"
download "scripts/arbishield-serverfn-shim.mjs" "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
chmod 755 "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
if systemctl is-active --quiet arbishield-serverfn-shim.service 2>/dev/null; then
  systemctl restart arbishield-serverfn-shim.service
  log "shim :3101 reiniciado"
fi

echo
echo "OK — hotfix anti-travamento aplicado"
echo "  Membros: https://arbishield.app/app"
echo "  Usuários: https://arbishield.app/admin/users  (busca sem freeze)"
echo
echo "Se ainda travar, rode também:"
echo "  python3 $SCRIPTS_DIR/arbishield-fix-csr-boot.py $WEB"
