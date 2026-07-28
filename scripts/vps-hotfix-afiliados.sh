#!/usr/bin/env bash
# Hotfix: publica a aba Afiliados (paridade com SPA /app/afiliados).
#
# Na VPS (root / console Hostinger):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/arbishield-v2-backup-723d/scripts/vps-hotfix-afiliados.sh?v=1")
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

log "Baixar Afiliados + CSS/JS"
for f in app-afiliados.html v2-afiliados.js v2.css v2-shell.js; do
  curl -fsSL "$RAW/deploy/vps-supabase/static/v2/$f" -o "$WEB/$f"
  chmod 0644 "$WEB/$f"
  # espelha na raiz caso nginx sirva /var/www/arbishield diretamente
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
  echo "  ok $f"
done

# validação rápida
grep -q 'v2-afiliados' "$WEB/app-afiliados.html" || die "app-afiliados.html sem v2-afiliados"
grep -q 'affRoot\|aff-page\|Afiliados' "$WEB/app-afiliados.html" || die "HTML de afiliados inválido"
grep -q 'Saldo Disponível\|Solicitar Saque\|function' "$WEB/v2-afiliados.js" || die "v2-afiliados.js inválido"
grep -q '\.aff-page\|\.aff-balance-card' "$WEB/v2.css" || die "CSS de afiliados ausente em v2.css"

if command -v nginx >/dev/null 2>&1; then
  nginx -t >/dev/null 2>&1 && systemctl reload nginx 2>/dev/null || true
fi

echo
echo "OK — Afiliados publicado"
echo "  Abra https://arbishield.app/app-afiliados.html (Ctrl+Shift+R)"
echo "  Deve aparecer: Saldo Disponível + KPIs + Link de indicação (não o template legado)"
