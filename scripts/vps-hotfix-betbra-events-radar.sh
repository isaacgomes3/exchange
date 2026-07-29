#!/usr/bin/env bash
# Instala lib + endpoint diagnóstico do radar de movimento BetBra.
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-proteger-js-e85c/scripts/vps-hotfix-betbra-events-radar.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-proteger-js-e85c}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"

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
    "$API/$rel?ref=${REF}&t=$(date +%s)" -o "$out" \
    && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "$RAW/$rel?v=$BUST&t=$(date +%s)" -o "$out"
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

log "1/3 lib betbra-events-radar"
install_lib "scripts/lib/betbra-events-radar.mjs"
grep -q 'betbra-events-radar-v1' "$SCRIPTS_DIR/lib/betbra-events-radar.mjs" \
  || die "lib sem marker v1"

log "2/3 prelive-events (endpoint betbra-events-radar)"
tmp_pre="$(mktemp)"
download_repo_file "scripts/arbishield-prelive-events.mjs" "$tmp_pre"
grep -q 'betbra-events-radar' "$tmp_pre" || die "prelive sem endpoint radar"
grep -q 'BETBRA_EVENTS_RADAR_VERSION' "$tmp_pre" || die "prelive sem import radar"

for dest in \
  "$SCRIPTS_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/scripts/arbishield-prelive-events.mjs"; do
  if [[ -d "$(dirname "$dest")" ]] || [[ "$dest" == "$SCRIPTS_DIR/"* ]]; then
    mkdir -p "$(dirname "$dest")"
    cp -f "$tmp_pre" "$dest"
    chmod 0644 "$dest"
    echo "  OK $dest"
  fi
done
rm -f "$tmp_pre"

log "3/3 reiniciar serviço prelive"
restarted=0
for unit in arbishield-prelive-events arbishield-matches prelive-events; do
  if systemctl list-unit-files "${unit}.service" 2>/dev/null | grep -q "$unit"; then
    systemctl restart "$unit" && restarted=1 && echo "  restarted $unit" && break
  fi
done
if [[ "$restarted" -eq 0 ]]; then
  # fallback: pkill + nohup se o unit name variar
  if pgrep -f 'arbishield-prelive-events.mjs' >/dev/null 2>&1; then
    pkill -f 'arbishield-prelive-events.mjs' || true
    sleep 1
  fi
  if [[ -x "$SCRIPTS_DIR/arbishield-prelive-events.mjs" ]] || [[ -f "$SCRIPTS_DIR/arbishield-prelive-events.mjs" ]]; then
    echo "  aviso: reinicie manualmente o processo prelive se o endpoint 404"
  fi
fi

sleep 1
code=$(curl -sS -o /tmp/radar_health.json -w '%{http_code}' --max-time 15 \
  "http://127.0.0.1:3098/api/arbishield/betbra-events-radar" 2>/dev/null || echo 000)
echo "  local GET /api/arbishield/betbra-events-radar → HTTP $code"
head -c 400 /tmp/radar_health.json 2>/dev/null; echo
[[ "$code" == "200" || "$code" == "502" ]] || die "endpoint nao respondeu (code=$code)"

log "OK. Público: curl -sS https://arbishield.app/api/arbishield/betbra-events-radar | jq ."
