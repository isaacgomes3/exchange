#!/usr/bin/env bash
# Auditoria fluxo — Augusto Luiz Magalhaes Vila Nova (id~8b2cd8a3)
#
# Na VPS (root):
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-audit-fluxo-augusto.sh?ref=cursor/fix-reembolso-lucas-perdeu-723d&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-reembolso-lucas-perdeu-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
mkdir -p "$SCRIPTS_DIR/scripts/lib"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
need node

fetch() {
  local path="$1" dest="$2"
  mkdir -p "$(dirname "$dest")"
  if ! curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/${path}?ref=${REF}&t=$(date +%s%N)" -o "$dest" \
    || [[ ! -s "$dest" ]]; then
    curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
      -H "Cache-Control: no-cache" \
      "$RAW/${path}?t=$(date +%s%N)" -o "$dest"
  fi
  [[ -s "$dest" ]] || die "download vazio: $path"
}

log "baixar auditoria (ref=$REF)"
fetch "scripts/vps-audit-fluxo-cliente.mjs" "$SCRIPTS_DIR/vps-audit-fluxo-cliente.mjs"
fetch "scripts/lib/protection-flow-contract.mjs" "$SCRIPTS_DIR/lib/protection-flow-contract.mjs"
grep -q 'vps-audit-fluxo-cliente-v1' "$SCRIPTS_DIR/vps-audit-fluxo-cliente.mjs" || die "script inválido"
chmod 0644 "$SCRIPTS_DIR/vps-audit-fluxo-cliente.mjs" "$SCRIPTS_DIR/lib/protection-flow-contract.mjs"

export NAME="${NAME:-Augusto Luiz Magalhaes Vila Nova}"
export ID_PREFIX="${ID_PREFIX:-8b2cd8a3}"
export USER_ID="${USER_ID:-}"

node "$SCRIPTS_DIR/vps-audit-fluxo-cliente.mjs"
