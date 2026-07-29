#!/usr/bin/env bash
# Desafio: alertas de gol + fim de partida no cliente (+ sync/cache live).
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

log "1/3 lib + prelive (cache live p/ alertas)"
tmp_lib="$(mktemp)"; tmp_pre="$(mktemp)"
download_repo_file "scripts/lib/betbra-inplay-sync.mjs" "$tmp_lib"
download_repo_file "scripts/arbishield-prelive-events.mjs" "$tmp_pre"
grep -q 'betbra-inplay-sync-v4' "$tmp_lib" || die "lib sem v4"
grep -q 'desafioStepLiveCache' "$tmp_pre" || die "prelive sem desafioStepLiveCache"
grep -q 'enrichDesafiosWithLiveCache' "$tmp_pre" || die "prelive sem enrichDesafiosWithLiveCache"
grep -q 'rememberDesafioStepLive' "$tmp_pre" || die "prelive sem rememberDesafioStepLive"

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
rm -f "$tmp_lib" "$tmp_pre"

log "2/3 UI app-desafio.html (alertas)"
tmp_html="$(mktemp)"
download_repo_file "deploy/vps-supabase/static/v2/app-desafio.html" "$tmp_html"
grep -q 'desafio-alertas-gol-v1' "$tmp_html" || die "sem marker desafio-alertas-gol-v1"
grep -q 'detectLiveAlerts' "$tmp_html" || die "sem detectLiveAlerts"
grep -q 'dz-live-toasts' "$tmp_html" || die "sem dz-live-toasts"
grep -q 'showLiveToast' "$tmp_html" || die "sem showLiveToast"
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

log "3/3 restart + kick sync"
systemctl restart arbishield-prelive-events.service 2>/dev/null || \
  systemctl restart arbishield-prelive.service 2>/dev/null || true
sleep 2
curl -sS -o /tmp/dz-alert-sync.json -w "match-live-sync HTTP %{http_code}\n" \
  "http://127.0.0.1:3098/api/arbishield/match-live-sync" || true
head -c 320 /tmp/dz-alert-sync.json 2>/dev/null; echo

log "OK — Ctrl+Shift+R em /app-desafio.html"
echo "  Toast GOL / FIM DE JOGO + botão Alertas ON/OFF"
echo "  Hotfix: bash <(curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}/scripts/vps-hotfix-desafio-alertas-gol.sh)"
