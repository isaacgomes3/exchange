#!/usr/bin/env bash
# Ajusta Apostador Carlos → R$ 8.976,41 (= 8.067,52 + 1.000 − 91,11)
#
# Na VPS (root):
#   curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-reembolso-lucas-perdeu-723d/scripts/vps-ajustar-carlos-897641.sh?$(date +%s)" -o /tmp/aj-carlos.sh
#   bash /tmp/aj-carlos.sh
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-reembolso-lucas-perdeu-723d}"
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

log "Baixar script"
tmp="$(mktemp)"
download_repo_file "scripts/vps-ajustar-carlos-897641.mjs" "$tmp"
cp -f "$tmp" "$SCRIPTS_DIR/vps-ajustar-carlos-897641.mjs"
chmod 0755 "$SCRIPTS_DIR/vps-ajustar-carlos-897641.mjs"
rm -f "$tmp"

log "1) DRY-RUN"
node "$SCRIPTS_DIR/vps-ajustar-carlos-897641.mjs"

log "2) FIX=1"
FIX=1 node "$SCRIPTS_DIR/vps-ajustar-carlos-897641.mjs"
echo
echo "OK — Apostador deve ser R\$ 8.976,41 · Congelado 0 · Reembolso 0"
echo "Hard refresh no Financeiro."
