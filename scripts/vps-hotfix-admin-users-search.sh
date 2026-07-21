#!/usr/bin/env bash
# Hotfix: destravar busca de clientes em /admin/users.
#
# Uso na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/admin-ops-fix-723d/scripts/vps-hotfix-admin-users-search.sh?v=2")
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

log "1/2 — patch agressivo admin.users (debounce + useMemo + sem stats demo)"
curl -fsSL "$RAW/scripts/arbishield-patch-admin-users-freeze.py" \
  -o "$SCRIPTS_DIR/arbishield-patch-admin-users-freeze.py"
python3 "$SCRIPTS_DIR/arbishield-patch-admin-users-freeze.py" "$WEB"

# Força revalidação de cache do nginx/browser no asset patchado
if compgen -G "$WEB/assets/admin.users-*.js" > /dev/null; then
  touch "$WEB/assets"/admin.users-*.js
  find "$WEB/assets" -name 'admin.users-*.js' -not -name '*.bak' -not -name '*.pre' \
    -exec chmod 0644 {} \;
fi

log "2/2 — garantir anti-freeze de modais no admin"
curl -fsSL "$RAW/deploy/vps-supabase/static/admin-modal-fix.js" \
  -o "$WEB/assets/admin-modal-fix.js"
chmod 0644 "$WEB/assets/admin-modal-fix.js"

# Estende admin-modal-fix para /admin/users (blur/overlay)
python3 <<'PY'
from pathlib import Path
p = Path("/var/www/arbishield/assets/admin-modal-fix.js")
t = p.read_text(encoding="utf-8", errors="replace")
needle = 'path === "/admin/desafios" ||\n    path.endsWith("/admin/desafios");'
repl = (
    'path === "/admin/desafios" ||\n'
    '    path.endsWith("/admin/desafios") ||\n'
    '    path === "/admin/users" ||\n'
    '    path.endsWith("/admin/users");'
)
if "admin/users" not in t and needle in t:
    p.write_text(t.replace(needle, repl, 1), encoding="utf-8")
    print("admin-modal-fix: /admin/users incluído")
else:
    print("admin-modal-fix: ok")
PY

echo
echo "OK — busca de usuários destravada (debounce 400ms, sem re-render a cada tecla)"
echo "  Teste: https://arbishield.app/admin/users"
echo "  OBRIGATÓRIO: Ctrl+Shift+R (o nome do JS é o mesmo e o browser cacheia)"
echo "  Digite no Pesquisar — a lista só filtra ~0,4s após parar de digitar"
