#!/usr/bin/env bash
# Hotfix UI Minhas Proteções — remove Competição, odd ao lado do Valor
#
# Na VPS (root):
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-protecoes-odd-valor.sh?ref=cursor/fix-reembolso-lucas-perdeu-723d&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-reembolso-lucas-perdeu-723d}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }

[[ -d "$WEB_ROOT" ]] || die "web root ausente: $WEB_ROOT"

TMP="$(mktemp)"
if ! curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  -H "Accept: application/vnd.github.raw" \
  -H "Cache-Control: no-cache" \
  -H "User-Agent: arbishield-hotfix" \
  "$API/deploy/vps-supabase/static/v2/app-protecoes.html?ref=${REF}&t=$(date +%s%N)" -o "$TMP" \
  || [[ ! -s "$TMP" ]]; then
  curl -fsSL --retry 5 "$RAW/deploy/vps-supabase/static/v2/app-protecoes.html?t=$(date +%s%N)" -o "$TMP"
fi
grep -q 'protecoes-col-odd-valor-v1' "$TMP" || die "HTML sem marcador protecoes-col-odd-valor-v1"
cp -a "$WEB_ROOT/app-protecoes.html" "$WEB_ROOT/app-protecoes.html.bak-odd-valor-$(date +%s)" 2>/dev/null || true
cp -f "$TMP" "$WEB_ROOT/app-protecoes.html"
rm -f "$TMP"
log "OK $WEB_ROOT/app-protecoes.html"
