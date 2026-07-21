#!/usr/bin/env bash
# Hotfix v4: destravar admin de verdade (Realtime shell + cache-bust do main.js).
#
# Uso na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/admin-ops-fix-723d/scripts/vps-hotfix-admin-unfreeze.sh?v=4")
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

log "1/5 — CSS seguro"
download "deploy/vps-supabase/static/admin-modal-fix.js" "$WEB/assets/admin-modal-fix.js"
download "deploy/vps-supabase/static/app-stability.js" "$WEB/assets/app-stability.js"
download "deploy/vps-supabase/static/app-boot-fix.js" "$WEB/assets/app-boot-fix.js"
download "deploy/vps-supabase/static/admin-realtime-kill.js" "$WEB/assets/admin-realtime-kill.js"
chmod 0644 "$WEB/assets/"admin-modal-fix.js "$WEB/assets/"app-stability.js \
  "$WEB/assets/"app-boot-fix.js "$WEB/assets/"admin-realtime-kill.js

log "2/5 — injetar realtime-kill + boot no index.html"
INDEX="$WEB/index.html"
python3 <<'PY'
from pathlib import Path
index = Path("/var/www/arbishield/index.html")
html = index.read_text(encoding="utf-8", errors="replace")
tags = [
    '<script src="/assets/admin-realtime-kill.js"></script>',
    '<script src="/assets/app-boot-fix.js"></script>',
    '<script src="/assets/app-stability.js"></script>',
    '<script src="/assets/admin-modal-fix.js"></script>',
]
# remove duplicatas antigas e reinsere no head (antes de qualquer module)
import re
for t in tags:
    html = html.replace(t, "")
block = "\n    ".join(tags) + "\n"
if "</head>" in html:
    html = html.replace("</head>", "    " + block + "  </head>", 1)
else:
    html = block + html
index.write_text(html, encoding="utf-8")
print("index.html: scripts early no <head>")
PY

log "3/5 — PATCH main.js (no-op watchers) + cache-bust"
download "scripts/arbishield-patch-admin-watchers.py" "$SCRIPTS_DIR/arbishield-patch-admin-watchers.py"
python3 "$SCRIPTS_DIR/arbishield-patch-admin-watchers.py" "$WEB"

log "4/5 — users + promise eterno"
download "scripts/arbishield-patch-admin-users-freeze.py" "$SCRIPTS_DIR/arbishield-patch-admin-users-freeze.py"
python3 "$SCRIPTS_DIR/arbishield-patch-admin-users-freeze.py" "$WEB" || true
download "scripts/arbishield-patch-main-freeze.py" "$SCRIPTS_DIR/arbishield-patch-main-freeze.py"
# patch também a cópia cache-bust
python3 "$SCRIPTS_DIR/arbishield-patch-main-freeze.py" "$WEB" || true
if [[ -f "$WEB/assets/main-arbishield-unfreeze.js" ]]; then
  python3 - <<'PY'
from pathlib import Path
import importlib.util
# re-run freeze patch logic on bust file by temporarily naming
www = Path("/var/www/arbishield")
bust = www / "assets" / "main-arbishield-unfreeze.js"
text = bust.read_text(encoding="utf-8", errors="replace")
old = "await new Promise(()=>{})"
new = "await new Promise(e=>setTimeout(e,100))"
if old in text:
    bust.write_text(text.replace(old, new), encoding="utf-8")
    print("unfreeze copy: eternal Promise patched")
else:
    print("unfreeze copy: sem Promise eterno")
PY
fi

log "5/5 — shim users limitada"
download "scripts/arbishield-serverfn-shim.mjs" "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
chmod 755 "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
if systemctl is-active --quiet arbishield-serverfn-shim.service 2>/dev/null; then
  systemctl restart arbishield-serverfn-shim.service
fi

echo
echo "======== VERIFICAÇÃO OBRIGATÓRIA ========"
if grep -q 'arbishield-noop:cOe' "$WEB/assets/main-arbishield-unfreeze.js" 2>/dev/null; then
  echo "OK main-arbishield-unfreeze.js tem no-ops"
  grep -o 'arbishield-noop:[a-zA-Z0-9]*' "$WEB/assets/main-arbishield-unfreeze.js" | sort -u
else
  echo "FALHA: patch não gravou — abortando" >&2
  exit 1
fi
if grep -q 'main-arbishield-unfreeze.js' "$WEB/index.html"; then
  echo "OK index.html aponta para main-arbishield-unfreeze.js (cache-bust)"
else
  echo "AVISO: index ainda não referencia unfreeze — confira manualmente" >&2
fi
echo "========================================"
echo
echo "OK — hotfix admin unfreeze v4"
echo "  1) Feche TODAS as abas de arbishield.app"
echo "  2) Abra janela anônima: https://arbishield.app/admin"
echo "  3) Console deve ter: __ARBISHIELD_ADMIN_REALTIME_KILL__ === 'v1'"
echo "  4) Teste clicar em Usuários / Pesquisar"
