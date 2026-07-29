#!/usr/bin/env bash
# Proteger Aposta: tempo + placar + radar nos jogos da grade.
# Na VPS:
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-proteger-live-radar.sh?ref=cursor/fix-proteger-js-e85c&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-proteger-js-e85c}"
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

install_lib() {
  local rel="$1"
  local name
  name="$(basename "$rel")"
  local tmp
  tmp="$(mktemp)"
  download_repo_file "$rel" "$tmp"
  for dest in \
    "$SCRIPTS_DIR/lib/$name" \
    "$SHIM_DIR/lib/$name" \
    "$SHIM_DIR/scripts/lib/$name"; do
    mkdir -p "$(dirname "$dest")"
    cp -f "$tmp" "$dest"
    chmod 0644 "$dest"
    echo "  OK $dest"
  done
  rm -f "$tmp"
}

publish_web() {
  local rel="$1"
  local name
  name="$(basename "$rel")"
  local tmp
  tmp="$(mktemp)"
  download_repo_file "$rel" "$tmp" || die "download falhou: $rel"
  if [[ "$name" == "app-proteger.html" ]]; then
    grep -qE 'proteger-live-radar-v1|data-radar' "$tmp" \
      || die "UI Proteger sem marker live/radar"
  fi
  cp -f "$tmp" "$WEB/$name"
  cp -f "$tmp" "$WEB_ROOT/$name" 2>/dev/null || true
  chmod 0644 "$WEB/$name"
  while IFS= read -r -d '' f; do
    cp -f "$tmp" "$f"
    chmod 0644 "$f"
  done < <(find /var/www -type f -name "$name" -print0 2>/dev/null || true)
  rm -f "$tmp"
  echo "  OK $WEB/$name ($(wc -c < "$WEB/$name" | tr -d ' ') bytes)"
}

log "1/4 lib inplay-sync v7 (eventId via link BetBra)"
install_lib "scripts/lib/betbra-inplay-sync.mjs"
grep -q 'betbra-inplay-sync-v7' "$SCRIPTS_DIR/lib/betbra-inplay-sync.mjs" \
  || die "lib sem marker betbra-inplay-sync-v7"
grep -q 'matchBetbraEventId' "$SCRIPTS_DIR/lib/betbra-inplay-sync.mjs" \
  || die "lib sem matchBetbraEventId"

log "2/4 lib events-radar (mradar)"
install_lib "scripts/lib/betbra-events-radar.mjs"
grep -qE 'betbra-events-radar-v[0-9]+' "$SCRIPTS_DIR/lib/betbra-events-radar.mjs" \
  || die "lib sem marker betbra-events-radar-v*"

log "3/4 prelive (lista matches + sync + mradar)"
tmp_pre="$(mktemp)"
download_repo_file "scripts/arbishield-prelive-events.mjs" "$tmp_pre"
grep -q 'matchBetbraEventId' "$tmp_pre" || die "prelive sem matchBetbraEventId"
grep -q 'enrichMatchForClientGrid' "$tmp_pre" || die "prelive sem enrichMatchForClientGrid"
grep -q 'desafio-mradar' "$tmp_pre" || die "prelive sem desafio-mradar"
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

log "4/4 UI Proteger + CSS"
publish_web "deploy/vps-supabase/static/v2/app-proteger.html"
publish_web "deploy/vps-supabase/static/v2/v2.css"

# Reinicia serviço prelive se existir
for svc in arbishield-prelive arbishield-prelive-events prelive-events; do
  if systemctl list-unit-files 2>/dev/null | grep -q "^${svc}\\.service"; then
    log "restart $svc"
    systemctl restart "$svc" || true
  fi
done
# Alguns deploys usam pm2 / node sob supervisor
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart arbishield-prelive 2>/dev/null || \
  pm2 restart prelive 2>/dev/null || \
  pm2 restart all 2>/dev/null || true
fi

log "OK Proteger live/radar. Ctrl+Shift+R em /app-proteger.html"
log "Marker esperado: proteger-live-radar-v1"
log "API: GET /api/arbishield/matches deve trazer metadata.live + betbra_event_id"
