#!/usr/bin/env bash
# FORCE Apostador Carlos → R$ 9.051,71 (Sport×Cuiabá LAY@32)
# Corrige print R$ 8.976,41 → R$ 9.051,71 (+R$ 75,30)
#
# Na VPS (root):
#   curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-reembolso-lucas-perdeu-723d/scripts/vps-force-carlos-905171.sh?$(date +%s)" -o /tmp/force-905171.sh
#   bash /tmp/force-905171.sh
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
need node
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
mkdir -p "$SCRIPTS_DIR"

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

log "NÃO use vps-force-carlos-897641 — esse script é o alvo errado (odd 10)"
log "Baixar force 9.051,71"
tmp="$(mktemp)"
download_repo_file "scripts/vps-force-carlos-905171.mjs" "$tmp"
cp -f "$tmp" "$SCRIPTS_DIR/vps-force-carlos-905171.mjs"
chmod 0755 "$SCRIPTS_DIR/vps-force-carlos-905171.mjs"
rm -f "$tmp"

log "DRY-RUN"
node "$SCRIPTS_DIR/vps-force-carlos-905171.mjs"

log "FIX=1"
FIX=1 node "$SCRIPTS_DIR/vps-force-carlos-905171.mjs"

echo
echo "VERIFY esperado:"
echo "  Apostador R\$ 9.051,71"
echo "  Congelado R\$ 0,00"
echo "  Reembolso R\$ 0,00  (Exchange correto — NÃO credita Reembolso)"
echo "Hard refresh Ctrl+Shift+R no Financeiro / Espelho."
