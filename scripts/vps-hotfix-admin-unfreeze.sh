#!/usr/bin/env bash
# Hotfix: destravar ADMIN inteiro (freeze em click/focus/todas as funções).
#
# Causa: admin-modal-fix usava `html.* * { transition:none }` — recalcula
# estilo da árvore inteira a cada focus/click e congela o SPA.
#
# Uso na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/admin-ops-fix-723d/scripts/vps-hotfix-admin-unfreeze.sh?v=1")
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

log "1/3 — CSS anti-freeze seguro (sem seletor *)"
download "deploy/vps-supabase/static/admin-modal-fix.js" "$WEB/assets/admin-modal-fix.js"
download "deploy/vps-supabase/static/app-stability.js" "$WEB/assets/app-stability.js"
download "deploy/vps-supabase/static/app-boot-fix.js" "$WEB/assets/app-boot-fix.js"
chmod 0644 \
  "$WEB/assets/admin-modal-fix.js" \
  "$WEB/assets/app-stability.js" \
  "$WEB/assets/app-boot-fix.js"

# Garante scripts no index.html
INDEX="$WEB/index.html"
if [[ -f "$INDEX" ]]; then
  python3 <<'PY'
from pathlib import Path
index = Path("/var/www/arbishield/index.html")
html = index.read_text(encoding="utf-8", errors="replace")
changed = False
for src in (
    "/assets/app-boot-fix.js",
    "/assets/app-stability.js",
    "/assets/admin-modal-fix.js",
):
    tag = f'<script src="{src}"></script>'
    if tag not in html:
        if "</head>" in html:
            html = html.replace("</head>", f"    {tag}\n  </head>", 1)
        else:
            html = tag + html
        changed = True
        print(f"index.html: + {src}")
if changed:
    index.write_text(html, encoding="utf-8")
else:
    print("index.html: scripts ok")
PY
fi

log "2/3 — patch admin.users (busca debounce + sem realtime flood)"
download "scripts/arbishield-patch-admin-users-freeze.py" "$SCRIPTS_DIR/arbishield-patch-admin-users-freeze.py"
python3 "$SCRIPTS_DIR/arbishield-patch-admin-users-freeze.py" "$WEB"
touch "$WEB/assets"/admin.users-*.js 2>/dev/null || true

log "3/3 — patch main.js (Promise eterno)"
download "scripts/arbishield-patch-main-freeze.py" "$SCRIPTS_DIR/arbishield-patch-main-freeze.py"
python3 "$SCRIPTS_DIR/arbishield-patch-main-freeze.py" "$WEB" || true

echo
echo "OK — admin anti-freeze seguro aplicado"
echo "  1) Ctrl+Shift+R em qualquer página /admin"
echo "  2) Clique no campo Pesquisar — NÃO deve congelar"
echo "  3) Navegue entre menus do admin"
echo
echo "Verifique no DevTools console:"
echo "  window.__ARBISHIELD_ADMIN_MODAL_FIX__  → deve ser \"safe-v2\""
