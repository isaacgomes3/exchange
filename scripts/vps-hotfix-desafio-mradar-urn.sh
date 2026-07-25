#!/usr/bin/env bash
# Radar Desafio: usa URN sr:match:N (evita "widget não encontrado" com id numérico).
#
# Na VPS:
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-desafio-mradar-urn.sh?ref=cursor/desafio-mradar-urn-e85c&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/desafio-mradar-urn-e85c}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT" "$SCRIPTS_DIR/lib" "$SHIM_DIR/lib" "$SHIM_DIR/scripts/lib"

download_repo_file() {
  local rel="$1"
  local out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/$rel?ref=${REF}&t=$(date +%s%N)" -o "$out" \
    && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "$RAW/$rel?v=$BUST&t=$(date +%s%N)" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

log "1/3 lib events-radar v4 (URN sr:match)"
tmp_lib="$(mktemp)"
download_repo_file "scripts/lib/betbra-events-radar.mjs" "$tmp_lib"
grep -q 'betbra-events-radar-v4' "$tmp_lib" || die "lib sem marker v4"
grep -q 'sr:match' "$tmp_lib" || die "lib sem URN sr:match"
for dest in \
  "$SCRIPTS_DIR/lib/betbra-events-radar.mjs" \
  "$SHIM_DIR/lib/betbra-events-radar.mjs" \
  "$SHIM_DIR/scripts/lib/betbra-events-radar.mjs"; do
  mkdir -p "$(dirname "$dest")"
  cp -f "$tmp_lib" "$dest"
  chmod 0644 "$dest"
  echo "  OK $dest"
done
rm -f "$tmp_lib"

log "2/3 prelive (endpoint desafio-mradar)"
tmp_pre="$(mktemp)"
download_repo_file "scripts/arbishield-prelive-events.mjs" "$tmp_pre"
grep -q 'desafio-mradar' "$tmp_pre" || die "prelive sem desafio-mradar"
grep -q 'betbra-events-radar' "$tmp_pre" || die "prelive sem import radar"
for dest in \
  "$SCRIPTS_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/scripts/arbishield-prelive-events.mjs"; do
  mkdir -p "$(dirname "$dest")"
  cp -f "$tmp_pre" "$dest"
  chmod 0644 "$dest"
  echo "  OK $dest"
done
rm -f "$tmp_pre"

log "3/3 UI app-desafio"
tmp_ui="$(mktemp)"
download_repo_file "deploy/vps-supabase/static/v2/app-desafio.html" "$tmp_ui"
grep -qE 'desafio-mradar-urn-v1|data-radar-next' "$tmp_ui" || die "UI sem marker mradar-urn"
cp -f "$tmp_ui" "$WEB/app-desafio.html"
cp -f "$tmp_ui" "$WEB_ROOT/app-desafio.html" 2>/dev/null || true
chmod 0644 "$WEB/app-desafio.html"
while IFS= read -r -d '' f; do
  cp -f "$tmp_ui" "$f"
  chmod 0644 "$f"
done < <(find /var/www -type f -name "app-desafio.html" -print0 2>/dev/null || true)
rm -f "$tmp_ui"

for svc in arbishield-prelive arbishield-prelive-events prelive-events; do
  if systemctl list-unit-files 2>/dev/null | grep -q "^${svc}\\.service"; then
    log "restart $svc"
    systemctl restart "$svc" || true
  fi
done

log "OK radar URN. Ctrl+Shift+R em /app-desafio.html"
log "Marker: desafio-mradar-urn-v1 · lib: betbra-events-radar-v4"
log "Teste: GET /api/arbishield/desafio-mradar?force=1&eventId=33875328076300023"
log "Esperado: mradarUrl com id=sr%3Amatch%3A72082946"
