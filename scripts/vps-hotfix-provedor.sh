#!/usr/bin/env bash
# Hotfix: publica a aba Provedor (Aporte de Capital) no visual do SPA.
#
# Na VPS (root / console Hostinger):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/arbishield-v2-backup-723d/scripts/vps-hotfix-provedor.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/arbishield-v2-backup-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$WEB/brand"

log "Baixar Provedor + CSS/JS"
for f in app-partners.html v2-provedor.js v2.css v2-shell.js; do
  curl -fsSL "$RAW/deploy/vps-supabase/static/v2/$f" -o "$WEB/$f"
  chmod 0644 "$WEB/$f"
  # espelha na raiz caso nginx sirva /var/www/arbishield diretamente
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
  echo "  ok $f"
done

# validação rápida
grep -q 'v2-provedor' "$WEB/app-partners.html" || die "app-partners.html sem v2-provedor"
grep -q 'Aporte de Capital\|prov-page\|provRoot' "$WEB/app-partners.html" || die "HTML do provedor inválido"
grep -q 'function\|Aporte' "$WEB/v2-provedor.js" || die "v2-provedor.js inválido"
grep -q '\.prov-page\|\.prov-card' "$WEB/v2.css" || die "CSS do provedor ausente em v2.css"

if command -v nginx >/dev/null 2>&1; then
  nginx -t >/dev/null 2>&1 && systemctl reload nginx 2>/dev/null || true
fi

echo
echo "OK — Provedor publicado"
echo "  Abra https://arbishield.app/app-partners.html (Ctrl+Shift+R)"
echo "  Deve aparecer: Aporte de Capital (não o template legado)"
