#!/usr/bin/env bash
# Hotfix: Odd do cliente não editável no Proteger Aposta
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/proteger-odd-readonly-723d/scripts/vps-hotfix-proteger-odd-readonly.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/proteger-odd-readonly-723d}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB"

log "UI Proteger Aposta — odd readonly"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/static/v2/app-proteger.html?v=$BUST" \
  -o "$WEB/app-proteger.html"
chmod 0644 "$WEB/app-proteger.html"
cp -f "$WEB/app-proteger.html" "$WEB_ROOT/app-proteger.html" 2>/dev/null || true

grep -q 'aria-readonly="true"' "$WEB/app-proteger.html" || die "HTML sem odd readonly"
grep -q 'Odd sempre do mercado' "$WEB/app-proteger.html" || die "HTML sem odd do mercado no submit"
! grep -q '\["amount", "odd", "balanceType"\]' "$WEB/app-proteger.html" || \
  die "HTML ainda escuta input na odd"

echo
echo "OK — odd bloqueada no cliente"
echo "  https://arbishield.app/v2/app-proteger.html  (Ctrl+F5)"
