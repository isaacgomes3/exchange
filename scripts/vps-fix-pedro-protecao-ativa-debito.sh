#!/usr/bin/env bash
# Debita proteção ativa do Pedro do saldo real (corrige clawback que devolveu o stake)
#
#   FIX=1 bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-pedro-debito-protecao-ativa-723d/scripts/vps-fix-pedro-protecao-ativa-debito.sh?v=2")
set -euo pipefail
BRANCH="${ARBISHIELD_BRANCH:-cursor/fix-pedro-debito-protecao-ativa-723d}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
mkdir -p "$SCRIPTS_DIR" "$WEB"

FIX="${FIX:-0}"
DST="$SCRIPTS_DIR/vps-fix-pedro-protecao-ativa-debito.mjs"

echo "==> baixar correção débito proteção ativa v2 bust=$BUST"
rm -f "$DST"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/vps-fix-pedro-protecao-ativa-debito.mjs?v=$BUST" -o "$DST"
chmod 0644 "$DST"
grep -q 'vps-fix-pedro-protecao-ativa-debito-v2' "$DST" \
  || { echo "ERRO: script antigo (sem v2)"; exit 1; }

export FIX ID_PREFIX=24037bdf
node "$DST"

echo "==> UI admin-users (mostra em proteção)"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/static/v2/admin-users.html?v=$BUST" \
  -o "$WEB/admin-users.html"
chmod 0644 "$WEB/admin-users.html"
cp -f "$WEB/admin-users.html" "$WEB_ROOT/admin-users.html" 2>/dev/null || true
grep -q 'em proteção' "$WEB/admin-users.html" || echo "AVISO: admin-users sem 'em proteção'"

echo
echo "OK — rode com FIX=1 se ainda não debitou"
echo "  FIX=1 bash <(curl -fsSL \"$RAW/scripts/vps-fix-pedro-protecao-ativa-debito.sh?v=2\")"
