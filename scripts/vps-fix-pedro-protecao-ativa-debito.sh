#!/usr/bin/env bash
# Debita proteção ativa do Pedro do saldo real
#
#   FIX=1 bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/caa240d/scripts/vps-fix-pedro-protecao-ativa-debito.sh")
set -euo pipefail

# Preferir SHA do commit (evita CDN raw da branch com blob vazio em cache)
REF="${ARBISHIELD_REF:-caa240d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
mkdir -p "$SCRIPTS_DIR" "$WEB"

FIX="${FIX:-0}"
DST="$SCRIPTS_DIR/vps-fix-pedro-protecao-ativa-debito.mjs"
BUST="$(date +%s)"

echo "==> baixar correção débito proteção ativa ref=$REF bust=$BUST"
rm -f "$DST"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/vps-fix-pedro-protecao-ativa-debito.mjs?v=$BUST" -o "$DST"
chmod 0644 "$DST"
BYTES=$(wc -c < "$DST" | tr -d ' ')
[[ "$BYTES" -gt 1000 ]] || { echo "ERRO: script vazio ($BYTES bytes) — use REF=caa240d"; exit 1; }
grep -q 'vps-fix-pedro-protecao-ativa-debito-v2' "$DST" \
  || { echo "ERRO: script sem marcador v2"; exit 1; }
grep -q 'lockGap' "$DST" || { echo "ERRO: script incompleto"; exit 1; }

export FIX ID_PREFIX=24037bdf
node "$DST"

echo "==> UI admin-users (mostra em proteção)"
# admin-users pode estar só na branch; tenta SHA depois branch
if ! curl -fsSL --retry 3 --retry-all-errors --retry-delay 1 \
  "$RAW/deploy/vps-supabase/static/v2/admin-users.html?v=$BUST" \
  -o "$WEB/admin-users.html" 2>/dev/null; then
  curl -fsSL --retry 3 \
    "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-pedro-debito-protecao-ativa-723d/deploy/vps-supabase/static/v2/admin-users.html?v=$BUST" \
    -o "$WEB/admin-users.html" || true
fi
if [[ -f "$WEB/admin-users.html" ]]; then
  chmod 0644 "$WEB/admin-users.html"
  cp -f "$WEB/admin-users.html" "$WEB_ROOT/admin-users.html" 2>/dev/null || true
fi

echo
echo "OK"
