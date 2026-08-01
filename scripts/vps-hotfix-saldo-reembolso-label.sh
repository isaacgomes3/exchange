#!/usr/bin/env bash
# Hotfix UI: "Saldo Dedução" → "Saldo Reembolso" (carteira do cliente)
# Bucket interno permanece deduction_balance_cents (stake + dedução, sacável).
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-proteger-js-e85c/scripts/vps-hotfix-saldo-reembolso-label.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"

echo "==> vps-hotfix-saldo-reembolso-label.sh ($(date -Is))"

publish() {
  local rel="$1"
  local name
  name="$(basename "$rel")"
  local tmp
  tmp="$(mktemp)"
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$RAW/$rel" -o "$tmp"
  grep -q 'Saldo Reembolso' "$tmp" || {
    echo "ERRO: $name sem 'Saldo Reembolso'"
    rm -f "$tmp"
    exit 1
  }
  while IFS= read -r -d '' f; do
    cp -a "$f" "${f}.bak-saldo-reembolso-$(date +%s)" 2>/dev/null || true
    cp -f "$tmp" "$f"
    chmod 0644 "$f"
    echo "  OK $f"
  done < <(find /var/www -type f -name "$name" -print0 2>/dev/null)
  mkdir -p "$WEB_ROOT/v2"
  cp -f "$tmp" "$WEB_ROOT/v2/$name" 2>/dev/null || true
  rm -f "$tmp"
}

publish "deploy/vps-supabase/static/v2/app-carteira.html"
publish "deploy/vps-supabase/static/v2/v2-financeiro.js"
publish "deploy/vps-supabase/static/v2/admin-jogos.html"

curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
grep -q 'Saldo Reembolso' "$SHIM_DIR/arbishield-serverfn-shim.mjs" || {
  echo "ERRO: shim sem Saldo Reembolso"
  exit 1
}
# contrato ao lado do shim (import ./lib/...)
mkdir -p "$SHIM_DIR/lib"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/lib/protection-flow-contract.mjs" -o "$SHIM_DIR/lib/protection-flow-contract.mjs" || true

systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
systemctl restart arbishield-serverfn-shim-teste.service 2>/dev/null || true

echo "OK — carteira mostra Saldo Reembolso (sacável)"
echo "  Ctrl+Shift+R em https://arbishield.app/app-carteira.html"
