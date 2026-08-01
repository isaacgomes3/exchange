#!/usr/bin/env bash
# Roda probe dos feeds play-info BetBra (inplay-info, eventsRadar, mexchange event).
# Mostra se existe campo de gráfico de pressão na API.
#
# Na VPS:
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-probe-betbra-play-info.sh?ref=main&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"
OUT="${ARBISHIELD_PLAYINFO_OUT:-/tmp/betbra-play-info-probe.json}"
PUBLIC_OUT="${ARBISHIELD_PLAYINFO_PUBLIC:-/var/www/arbishield/v2/play-info-probe.json}"
EVENT_ID="${ARBISHIELD_PROBE_EVENT_ID:-33875328076300023}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
need node
mkdir -p "$SCRIPTS_DIR/lib"

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

log "1/3 baixar libs + probe"
download_repo_file "scripts/lib/betbra-inplay-sync.mjs" "$SCRIPTS_DIR/lib/betbra-inplay-sync.mjs"
download_repo_file "scripts/lib/betbra-events-radar.mjs" "$SCRIPTS_DIR/lib/betbra-events-radar.mjs"
download_repo_file "scripts/vps-probe-betbra-play-info.mjs" "$SCRIPTS_DIR/vps-probe-betbra-play-info.mjs"
chmod 0644 "$SCRIPTS_DIR/lib/betbra-inplay-sync.mjs" "$SCRIPTS_DIR/lib/betbra-events-radar.mjs"
chmod 0755 "$SCRIPTS_DIR/vps-probe-betbra-play-info.mjs"

log "2/3 executar probe eventId=$EVENT_ID"
node "$SCRIPTS_DIR/vps-probe-betbra-play-info.mjs" --eventId "$EVENT_ID" --out "$OUT"
[[ -s "$OUT" ]] || die "probe sem output"

log "3/3 publicar resumo"
mkdir -p "$(dirname "$PUBLIC_OUT")"
cp -f "$OUT" "$PUBLIC_OUT"
chmod 0644 "$PUBLIC_OUT" 2>/dev/null || true

python3 - <<'PY' "$OUT" || true
import json,sys
p=sys.argv[1]
d=json.load(open(p))
v=d.get("verdict") or {}
print("\n=== VEREDITO ===")
print("eventId:", d.get("eventId"))
for name, ep in (d.get("endpoints") or {}).items():
  if not isinstance(ep, dict): continue
  print(f"- {name}: keys={ep.get('topLevelKeys')} pressureLike={ep.get('pressureLikeKeys')} blocked={ep.get('blocked')}")
print("inplayHasPressureGraph:", v.get("inplayHasPressureGraph"))
print("eventsRadarHasPressureGraph:", v.get("eventsRadarHasPressureGraph"))
print("eventDetailHasPressureGraph:", v.get("eventDetailHasPressureGraph"))
print("nota:", v.get("note"))
PY

log "OK. Arquivo: $OUT"
log "Publico (se nginx servir /v2/): https://arbishield.app/v2/play-info-probe.json"
