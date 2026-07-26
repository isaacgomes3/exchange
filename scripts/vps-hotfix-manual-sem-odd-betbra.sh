#!/usr/bin/env bash
# Remove autocomplete BetBra / pull de odd do drawer "Lançar evento manual".
# Odd no manual é só a digitada no formulário.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/manual-sem-odd-betbra-8f4a/scripts/vps-hotfix-manual-sem-odd-betbra.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/manual-sem-odd-betbra-8f4a}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"

echo "==> hotfix manual sem odd BetBra ($(date -Is)) ref=$REF"

tmp="$(mktemp)"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/static/v2/admin-jogos.html?t=$(date +%s%N)" -o "$tmp"
grep -q 'admin-jogos-manual-no-odds-v13' "$tmp" || {
  echo "ERRO: build sem marker admin-jogos-manual-no-odds-v13" >&2
  rm -f "$tmp"
  exit 1
}
if grep -q 'manBetbraAssist' "$tmp"; then
  echo "ERRO: ainda tem manBetbraAssist no HTML" >&2
  rm -f "$tmp"
  exit 1
fi

n=0
while IFS= read -r -d '' f; do
  cp -a "$f" "${f}.bak-manual-no-odds-$(date +%s)" 2>/dev/null || true
  cp -f "$tmp" "$f"
  chmod 0644 "$f"
  echo "  OK $f"
  n=$((n + 1))
done < <(find /var/www -type f -name 'admin-jogos.html' -print0 2>/dev/null)

mkdir -p "$WEB_ROOT" "$WEB_ROOT/v2"
cp -f "$tmp" "$WEB_ROOT/admin-jogos.html" 2>/dev/null || true
cp -f "$tmp" "$WEB_ROOT/v2/admin-jogos.html" 2>/dev/null || true
rm -f "$tmp"

[[ "$n" -gt 0 ]] || echo "  AVISO: nenhum admin-jogos.html em /var/www (copiado em $WEB_ROOT)"

html="$(curl -fsS -m 8 "https://arbishield.app/admin-jogos.html" 2>/dev/null || true)"
if echo "$html" | grep -q 'admin-jogos-manual-no-odds-v13' && ! echo "$html" | grep -q 'manBetbraAssist'; then
  echo "  smoke admin-jogos.html → OK (manual sem BetBra odd)"
else
  echo "  AVISO: público ainda desatualizado (cache/path?)"
fi

echo
echo "OK — Ctrl+Shift+R em https://arbishield.app/admin-jogos.html"
echo "  Lançar evento manual → sem bloco Autocomplete BetBra / odd"
