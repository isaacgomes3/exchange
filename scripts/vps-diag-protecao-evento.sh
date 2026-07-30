#!/usr/bin/env bash
# Diagnóstico VPS — proteção/evento (Senilvo 003d5bc9 por padrão)
#
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/protecao-v10-fonte-verdade-501d/scripts/vps-diag-protecao-evento.sh?$(date +%s)")
#   PROT=003d5bc9 NAME=Senilvo bash <(curl ...)
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/protecao-v10-fonte-verdade-501d}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
PROT="${PROT:-003d5bc9}"
NAME="${NAME:-Senilvo}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
need node
[[ "$(id -u)" -eq 0 ]] || die "rode como root na VPS"
mkdir -p "$SCRIPTS_DIR/lib"

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

log "1/2 baixar scripts"
tmp="$(mktemp)"
download_repo_file "scripts/lib/protection-flow-contract.mjs" "$tmp"
cp -f "$tmp" "$SCRIPTS_DIR/lib/protection-flow-contract.mjs"
rm -f "$tmp"

tmp="$(mktemp)"
download_repo_file "scripts/vps-diag-protecao-evento.mjs" "$tmp"
cp -f "$tmp" "$SCRIPTS_DIR/vps-diag-protecao-evento.mjs"
chmod 0755 "$SCRIPTS_DIR/vps-diag-protecao-evento.mjs"
rm -f "$tmp"

log "2/2 diagnosticar PROT=$PROT NAME=$NAME"
cd "$SCRIPTS_DIR"
PROT="$PROT" NAME="$NAME" node ./vps-diag-protecao-evento.mjs
