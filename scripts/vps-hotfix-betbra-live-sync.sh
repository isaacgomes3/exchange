#!/usr/bin/env bash
# Sync placar/tempo BetBra (inplay) → matches ArbiShield.
# Atualiza prelive service + UI admin-jogos / app-proteger.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-proteger-js-e85c/scripts/vps-hotfix-betbra-live-sync.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-proteger-js-e85c}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
PRELIVE_DST="${ARBISHIELD_PRELIVE:-$SHIM_DIR/arbishield-prelive-events.mjs}"
LIB_DIR="$SHIM_DIR/lib"
# alguns deploys têm scripts/ sob /opt/arbishield
if [[ -d "$SHIM_DIR/scripts" ]]; then
  PRELIVE_DST="${ARBISHIELD_PRELIVE:-$SHIM_DIR/scripts/arbishield-prelive-events.mjs}"
  LIB_DIR="$SHIM_DIR/scripts/lib"
fi

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT" "$LIB_DIR"

download_repo_file() {
  local rel="$1"
  local out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/$rel?ref=${REF}&t=$(date +%s)" -o "$out"; then
    [[ -s "$out" ]] && return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "$RAW/$rel?v=$BUST&t=$(date +%s)" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

publish_web() {
  local rel="$1"
  local name
  name="$(basename "$rel")"
  local tmp
  tmp="$(mktemp)"
  download_repo_file "$rel" "$tmp" || die "download falhou: $rel"
  cp -f "$tmp" "$WEB/$name"
  cp -f "$tmp" "$WEB_ROOT/$name" 2>/dev/null || true
  chmod 0644 "$WEB/$name"
  while IFS= read -r -d '' f; do
    cp -f "$tmp" "$f"
    chmod 0644 "$f"
  done < <(find /var/www -type f -name "$name" -print0 2>/dev/null || true)
  rm -f "$tmp"
  echo "  OK $WEB/$name"
}

log "1/3 lib + prelive (sync inplay)"
tmp_lib="$(mktemp)"
tmp_pre="$(mktemp)"
download_repo_file "scripts/lib/betbra-inplay-sync.mjs" "$tmp_lib"
download_repo_file "scripts/arbishield-prelive-events.mjs" "$tmp_pre"
mkdir -p "$LIB_DIR"
# também ao lado do prelive se paths forem distintos
cp -f "$tmp_lib" "$LIB_DIR/betbra-inplay-sync.mjs"
chmod 0644 "$LIB_DIR/betbra-inplay-sync.mjs"
# se prelive está em /opt/arbishield/arbishield-prelive-events.mjs, lib deve ficar em /opt/arbishield/lib/
if [[ "$(basename "$(dirname "$PRELIVE_DST")")" != "scripts" ]]; then
  mkdir -p "$(dirname "$PRELIVE_DST")/lib"
  cp -f "$tmp_lib" "$(dirname "$PRELIVE_DST")/lib/betbra-inplay-sync.mjs"
fi
# e também em scripts/lib relativo ao cwd típico
mkdir -p /opt/arbishield/scripts/lib 2>/dev/null || true
cp -f "$tmp_lib" /opt/arbishield/scripts/lib/betbra-inplay-sync.mjs 2>/dev/null || true
cp -f "$tmp_lib" /opt/arbishield/lib/betbra-inplay-sync.mjs 2>/dev/null || true

cp -f "$tmp_pre" "$PRELIVE_DST"
chmod 0644 "$PRELIVE_DST"
# espelhos comuns
cp -f "$tmp_pre" /opt/arbishield/arbishield-prelive-events.mjs 2>/dev/null || true
cp -f "$tmp_pre" /opt/arbishield/scripts/arbishield-prelive-events.mjs 2>/dev/null || true
rm -f "$tmp_lib" "$tmp_pre"

grep -q 'BETBRA_INPLAY_SYNC_VERSION\|betbra-inplay-sync' "$PRELIVE_DST" \
  || die "prelive sem sync inplay"
grep -q 'match-live-sync' "$PRELIVE_DST" || die "prelive sem endpoint match-live-sync"
grep -q 'score_sync_enabled: true' "$PRELIVE_DST" || die "prelive sem score_sync_enabled true"

log "2/3 UI"
publish_web "deploy/vps-supabase/static/v2/admin-jogos.html"
publish_web "deploy/vps-supabase/static/v2/app-proteger.html"
grep -q 'matchLiveInfo\|admin-jogos-betbra-live-sync' "$WEB/admin-jogos.html" \
  || die "admin-jogos sem live sync UI"
grep -q 'metadata.live' "$WEB/app-proteger.html" || die "app-proteger sem metadata.live"

log "3/3 restart serviço"
if command -v systemctl >/dev/null 2>&1; then
  for svc in arbishield-prelive arbishield-shim arbishield; do
    if systemctl list-unit-files 2>/dev/null | grep -q "^${svc}\.service"; then
      systemctl restart "$svc" || true
      log "restart $svc"
    fi
  done
fi

# kick opcional
curl -fsS -m 20 -X POST "http://127.0.0.1:3098/api/arbishield/match-live-sync" \
  -H "Content-Type: application/json" -d '{}' \
  && log "sync kick OK" \
  || log "aviso: kick sync falhou (serviço pode estar noutro porto)"

log "OK — Ctrl+Shift+R em admin-jogos e app-proteger"
log "Health: curl -s http://127.0.0.1:3098/health | grep inplaySync"
)
