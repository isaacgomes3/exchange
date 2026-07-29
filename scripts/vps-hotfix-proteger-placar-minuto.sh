#!/usr/bin/env bash
# Corrige placar/minuto na grade Proteger (inplay sync v8).
# Bug: status "open" virava AO VIVO sem placar e travava updates.
#
# Na VPS:
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-proteger-placar-minuto.sh?ref=cursor/proteger-placar-minuto-e85c&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/proteger-placar-minuto-e85c}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"
PRELIVE_PORT="${ARBISHIELD_PRELIVE_PORT:-3098}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
mkdir -p "$SCRIPTS_DIR/lib" "$SHIM_DIR/lib" "$SHIM_DIR/scripts/lib"

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

log "1/3 lib inplay-sync v8"
tmp_lib="$(mktemp)"
download_repo_file "scripts/lib/betbra-inplay-sync.mjs" "$tmp_lib"
grep -q 'betbra-inplay-sync-v8' "$tmp_lib" || die "lib sem marker v8"
grep -q 'inplayInfoHasDisplayData' "$tmp_lib" || die "lib sem guard de stub"
for dest in \
  "$SCRIPTS_DIR/lib/betbra-inplay-sync.mjs" \
  "$SHIM_DIR/lib/betbra-inplay-sync.mjs" \
  "$SHIM_DIR/scripts/lib/betbra-inplay-sync.mjs"; do
  mkdir -p "$(dirname "$dest")"
  cp -f "$tmp_lib" "$dest"
  chmod 0644 "$dest"
  echo "  OK $dest"
done
while IFS= read -r -d '' f; do
  cp -f "$tmp_lib" "$f"
done < <(find /opt /var/www -type f -name 'betbra-inplay-sync.mjs' -print0 2>/dev/null || true)
rm -f "$tmp_lib"

log "2/3 prelive (fallback event detail)"
tmp_pre="$(mktemp)"
download_repo_file "scripts/arbishield-prelive-events.mjs" "$tmp_pre"
grep -q 'betbra-inplay-sync' "$tmp_pre" || die "prelive sem import inplay"
grep -q 'fetchBetbraEventInplayInfo' "$tmp_pre" || die "prelive sem fallback event"
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

log "3/3 reiniciar prelive :${PRELIVE_PORT}"
restarted=0
for svc in arbishield-prelive-events arbishield-prelive prelive-events arbishield-matches; do
  if systemctl list-unit-files 2>/dev/null | grep -qE "^${svc}\\.service"; then
    systemctl restart "$svc" && restarted=1 && echo "  restarted systemd:$svc" || true
  fi
done
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart arbishield-prelive-events 2>/dev/null && restarted=1 || true
  pm2 restart prelive-events 2>/dev/null && restarted=1 || true
fi
if pgrep -af 'arbishield-prelive-events\.mjs' >/dev/null 2>&1; then
  pkill -f 'arbishield-prelive-events\.mjs' || true
  restarted=1
  sleep 2
fi
[[ "$restarted" -eq 1 ]] || echo "  aviso: reinicie o node :${PRELIVE_PORT} manualmente"

sleep 2
code=$(curl -sS -o /tmp/inplay_v8_verify.json -w '%{http_code}' --max-time 25 \
  "http://127.0.0.1:${PRELIVE_PORT}/api/arbishield/match-live-sync?force=1" 2>/dev/null || echo 000)
echo "  local match-live-sync → HTTP $code"
head -c 400 /tmp/inplay_v8_verify.json 2>/dev/null; echo
[[ "$code" == "200" ]] || die "sync local nao respondeu 200"
grep -q 'betbra-inplay-sync-v8' /tmp/inplay_v8_verify.json \
  || die "ainda nao e v8 — processo nao carregou a lib nova"

log "OK inplay v8. Publico: curl -sS 'https://arbishield.app/api/arbishield/match-live-sync?force=1' | head -c 300"
log "Grade: Ctrl+Shift+R em /app-proteger.html"
