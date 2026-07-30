#!/usr/bin/env bash
# Publica Monitor de Desafios com cards organizados (anti-entulho).
#
# Na VPS:
#   bash <(curl -fsSL -H "Accept: application/vnd.github.raw" \
#     "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-monitor-desafios-card-layout.sh?ref=cursor/monitor-desafios-card-layout-501d&t=$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/monitor-desafios-card-layout-501d}"
BUST="$(date +%s)"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
JSDELIVR="https://cdn.jsdelivr.net/gh/isaacgomes3/exchange@${REF}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield/v2}"
WEB_ROOT="${ARBISHIELD_WEB_ROOT:-/var/www/arbishield}"

die() { echo "ERRO: $*" >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
mkdir -p "$WEB"

download() {
  local rel="$1" out="$2" t; t="$(date +%s%N)"
  if curl -fsSL --retry 3 -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    "$API/$rel?ref=${REF}&t=$t" -o "$out" && [[ -s "$out" ]]; then
    return 0
  fi
  if curl -fsSL --retry 3 "$JSDELIVR/$rel?t=$t" -o "$out" && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 3 "$RAW/$rel?v=$BUST&t=$t" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

echo "==> monitor desafios card layout"
tmp="$(mktemp)"
download "deploy/vps-supabase/static/v2/admin-monitoring-desafios.html" "$tmp"
grep -q 'desafio-monitor-card-layout-v1' "$tmp" || die "HTML sem marker card-layout"
grep -q 'mdz-card-game' "$tmp" || die "HTML sem zona de jogo"
sed -i "s/?v=monitor-desafios-card-v1/?v=monitor-desafios-card-$BUST/g" "$tmp" || true
cp -f "$tmp" "$WEB/admin-monitoring-desafios.html"
chmod 0644 "$WEB/admin-monitoring-desafios.html"
cp -f "$WEB/admin-monitoring-desafios.html" "$WEB_ROOT/admin-monitoring-desafios.html" 2>/dev/null || true
rm -f "$tmp"

echo "OK — https://arbishield.app/admin-monitoring-desafios.html?v=$BUST"
echo "  Ctrl+Shift+R — cards com zonas: cliente · jogo · valores/ações"
