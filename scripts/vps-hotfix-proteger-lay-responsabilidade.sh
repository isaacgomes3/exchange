#!/usr/bin/env bash
# Hotfix UI: LAY pede responsabilidade; BACK pede stake (labels + preview).
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-proteger-js-e85c/scripts/vps-hotfix-proteger-lay-responsabilidade.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"

echo "==> vps-hotfix-proteger-lay-responsabilidade.sh ($(date -Is))"

TMP="$(mktemp)"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/static/v2/app-proteger.html" -o "$TMP"

grep -q 'Responsabilidade (R\$)' "$TMP" || {
  echo "ERRO: HTML sem label de responsabilidade"
  exit 1
}
grep -q 'syncAmountLabels' "$TMP" || {
  echo "ERRO: HTML sem syncAmountLabels"
  exit 1
}

n=0
while IFS= read -r -d '' f; do
  cp -a "$f" "${f}.bak-lay-resp-$(date +%s)" 2>/dev/null || true
  cp -f "$TMP" "$f"
  chmod 0644 "$f"
  echo "  OK $f"
  n=$((n + 1))
done < <(find /var/www -type f -name 'app-proteger.html' -print0 2>/dev/null)

rm -f "$TMP"
echo "==> arquivos: $n"
echo "Pronto. Ctrl+Shift+R em https://arbishield.app/app-proteger.html"
echo "  LAY → campo Responsabilidade · BACK → campo Stake"
