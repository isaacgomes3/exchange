#!/usr/bin/env bash
# Hotfix UI: remove "Stake equivalente (casa)" e "Odd LAY → back equiv." do preview Proteger.
# Marker: proteger-sem-stake-equiv-v1
#
# Na VPS (root):
#   curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-reembolso-lucas-perdeu-723d/scripts/vps-hotfix-proteger-sem-stake-equiv-v1.sh?$(date +%s)" -o /tmp/hf-sem-stake.sh
#   bash /tmp/hf-sem-stake.sh
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-reembolso-lucas-perdeu-723d}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
STATIC="${ARBISHIELD_STATIC:-/opt/arbishield/deploy/vps-supabase/static/v2}"
MARKER="proteger-sem-stake-equiv-v1"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
mkdir -p "$STATIC"

download_repo_file() {
  local rel="$1" out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/$rel?ref=${REF}&t=$(date +%s%N)" -o "$out" && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" "$RAW/$rel?v=$BUST&t=$(date +%s%N)" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

install() {
  local rel="$1" dest="$2" mark="${3:-$MARKER}"
  local tmp
  tmp="$(mktemp)"
  download_repo_file "$rel" "$tmp"
  grep -q "$mark" "$tmp" || die "sem marker $mark em $rel"
  # Garante que os dois campos sumiram
  if grep -q "Stake equivalente (casa)" "$tmp"; then
    die "ainda tem Stake equivalente em $rel"
  fi
  if grep -q "Odd LAY → back equiv." "$tmp"; then
    die "ainda tem Odd LAY → back equiv. em $rel"
  fi
  cp -f "$tmp" "$dest"
  chmod 0644 "$dest"
  rm -f "$tmp"
  log "OK $dest"
}

log "1) app-proteger.html"
install "deploy/vps-supabase/static/v2/app-proteger.html" "$STATIC/app-proteger.html"

log "2) proteger-preview-fix.js"
install "deploy/vps-supabase/static/v2/proteger-preview-fix.js" "$STATIC/proteger-preview-fix.js" "sem campos de stake equivalente"

echo
echo "OK — campos removidos do preview Proteger."
echo "Hard refresh Ctrl+Shift+R em /proteger."
