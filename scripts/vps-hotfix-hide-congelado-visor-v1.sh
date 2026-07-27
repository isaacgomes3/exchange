#!/usr/bin/env bash
# Hotfix UI: remove chip/visor Congelado (mantém stake_lock no backend).
# Marker: hide-congelado-visor-v1
#
# Na VPS (root):
#   curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-reembolso-lucas-perdeu-723d/scripts/vps-hotfix-hide-congelado-visor-v1.sh?$(date +%s)" -o /tmp/hf-hide-cong.sh
#   bash /tmp/hf-hide-cong.sh
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-reembolso-lucas-perdeu-723d}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
STATIC="${ARBISHIELD_STATIC:-/opt/arbishield/deploy/vps-supabase/static/v2}"
MARKER="hide-congelado-visor-v1"

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
  local rel="$1" dest="$2"
  local tmp
  tmp="$(mktemp)"
  download_repo_file "$rel" "$tmp"
  grep -q "$MARKER" "$tmp" || die "sem marker $MARKER em $rel"
  cp -f "$tmp" "$dest"
  chmod 0644 "$dest"
  rm -f "$tmp"
  log "OK $dest"
}

log "1) shell — remove chip Congelado + fallback anomalo"
install "deploy/vps-supabase/static/v2/v2-shell.js" "$STATIC/v2-shell.js"

log "2) financeiro / carteira / proteger / css"
install "deploy/vps-supabase/static/v2/v2-financeiro.js" "$STATIC/v2-financeiro.js"
install "deploy/vps-supabase/static/v2/app-carteira.html" "$STATIC/app-carteira.html"
install "deploy/vps-supabase/static/v2/app-proteger.html" "$STATIC/app-proteger.html"
install "deploy/vps-supabase/static/v2/v2.css" "$STATIC/v2.css"

echo
echo "OK — visor Congelado removido. stake_lock continua no backend."
echo "Hard refresh Ctrl+Shift+R no app / Espelho."
