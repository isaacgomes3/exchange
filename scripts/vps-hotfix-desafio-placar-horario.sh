#!/usr/bin/env bash
# Desafio: mostrar horario + placar (sync BetBra inplay nas etapas manuais).
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
    "$API/$rel?ref=${REF}&t=$(date +%s)" -o "$out" \
    && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "$RAW/$rel?v=$BUST&t=$(date +%s)" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

log "1/3 lib + prelive + shim"
tmp_lib="$(mktemp)"; tmp_pre="$(mktemp)"; tmp_shim="$(mktemp)"
download_repo_file "scripts/lib/betbra-inplay-sync.mjs" "$tmp_lib"
download_repo_file "scripts/arbishield-prelive-events.mjs" "$tmp_pre"
download_repo_file "scripts/arbishield-serverfn-shim.mjs" "$tmp_shim"
grep -q 'betbra-inplay-sync-v2' "$tmp_lib" || die "lib sem v2"
grep -q 'buildDesafioStepInplayPatch' "$tmp_lib" || die "lib sem buildDesafioStepInplayPatch"
grep -q 'desafioStepEligibleForInplaySync' "$tmp_pre" || die "prelive sem sync desafio"
grep -q 'betbra_event_id' "$tmp_shim" || die "shim sem betbra_event_id em steps"

for dest in \
  "$SCRIPTS_DIR/lib/betbra-inplay-sync.mjs" \
  "$SHIM_DIR/lib/betbra-inplay-sync.mjs" \
  "$SHIM_DIR/scripts/lib/betbra-inplay-sync.mjs"
do
  mkdir -p "$(dirname "$dest")"
  cp -f "$tmp_lib" "$dest"
  chmod 0644 "$dest"
  echo "  OK $dest"
done
for dest in \
  "$SCRIPTS_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/scripts/arbishield-prelive-events.mjs"
do
  mkdir -p "$(dirname "$dest")"
  cp -f "$tmp_pre" "$dest"
  chmod 0755 "$dest"
  echo "  OK $dest"
done
for dest in \
  "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" \
  "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  "$SHIM_DIR/scripts/arbishield-serverfn-shim.mjs"
do
  mkdir -p "$(dirname "$dest")"
  cp -f "$tmp_shim" "$dest"
  chmod 0755 "$dest"
  echo "  OK $dest"
done
rm -f "$tmp_lib" "$tmp_pre" "$tmp_shim"

log "2/3 UI app-desafio.html"
tmp_html="$(mktemp)"
download_repo_file "deploy/vps-supabase/static/v2/app-desafio.html" "$tmp_html"
grep -q 'desafio-placar-horario-v3' "$tmp_html" || die "sem marker desafio-placar-horario-v3"
grep -q 'stepLiveInfo' "$tmp_html" || die "sem stepLiveInfo"
grep -q 'dz-v2-score' "$tmp_html" || die "sem dz-v2-score"
while IFS= read -r -d '' f; do
  cp -f "$tmp_html" "$f"
  chmod 0644 "$f"
  echo "  OK $f"
done < <(find /var/www -type f -name 'app-desafio.html' -print0 2>/dev/null || true)
for f in "$WEB/app-desafio.html" "$WEB_ROOT/app-desafio.html"; do
  mkdir -p "$(dirname "$f")" 2>/dev/null || true
  [[ -d "$(dirname "$f")" ]] || continue
  cp -f "$tmp_html" "$f"
  chmod 0644 "$f"
  echo "  OK $f"
done
rm -f "$tmp_html"

log "3/3 restart"
systemctl restart arbishield-prelive-events.service 2>/dev/null || \
  systemctl restart arbishield-prelive.service 2>/dev/null || true
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || \
  systemctl restart arbishield-shim.service 2>/dev/null || true
sleep 2
curl -sS -o /tmp/live-dz.json -w "match-live-sync HTTP %{http_code}\n" \
  -X POST "http://127.0.0.1:3098/api/arbishield/match-live-sync" \
  -H "Content-Type: application/json" -d '{}' || true
head -c 280 /tmp/live-dz.json 2>/dev/null; echo

log "OK — Ctrl+Shift+R em /app-desafio.html"
echo "  Horario sempre visivel; placar aparece com sync BetBra (link do evento)."
