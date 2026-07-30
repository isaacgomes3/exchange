#!/usr/bin/env bash
# Auditoria pós-liquidação A LIQUIDAR v10 (somente leitura)
#
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/protecao-v10-fonte-verdade-501d/scripts/vps-audit-pos-liquidar-a-liquidar-v10.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/protecao-v10-fonte-verdade-501d}"
BUST="${ARBISHIELD_BUST:-$(date +%s%N)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
JSDELIVR="https://cdn.jsdelivr.net/gh/isaacgomes3/exchange@${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
need node
[[ "$(id -u)" -eq 0 ]] || die "rode como root na VPS"
mkdir -p "$SCRIPTS_DIR/lib"

is_valid_js() {
  local f="$1" needle="$2"
  [[ -s "$f" ]] || return 1
  head -c 80 "$f" | grep -q '^{' && return 1
  grep -q "$needle" "$f" || return 1
  return 0
}

try_fetch() {
  local url="$1" out="$2" needle="$3"
  local tmp
  tmp="$(mktemp)"
  if curl -fsSL --retry 3 --retry-delay 1 \
    -H "Cache-Control: no-cache" -H "User-Agent: arbishield-audit-v10" \
    "$url" -o "$tmp" 2>/dev/null && is_valid_js "$tmp" "$needle"; then
    mv -f "$tmp" "$out"
    return 0
  fi
  rm -f "$tmp"
  return 1
}

try_api_raw() {
  local rel="$1" out="$2" needle="$3"
  local tmp
  tmp="$(mktemp)"
  if curl -fsSL --retry 3 --retry-delay 1 \
    -H "Accept: application/vnd.github.raw" \
    -H "User-Agent: arbishield-audit-v10" \
    "$API/$rel?ref=${REF}&t=${BUST}" -o "$tmp" 2>/dev/null \
    && is_valid_js "$tmp" "$needle"; then
    mv -f "$tmp" "$out"
    return 0
  fi
  rm -f "$tmp"
  return 1
}

download_repo_file() {
  local rel="$1" out="$2" needle="$3"
  local t
  t="$(date +%s%N)"
  try_api_raw "$rel" "$out" "$needle" && return 0
  try_fetch "$RAW/$rel?v=$BUST&t=$t" "$out" "$needle" && return 0
  try_fetch "$JSDELIVR/$rel?t=$t" "$out" "$needle" && return 0
  die "nao baixou: $rel"
}

log "1/2 baixar contrato + auditoria"
tmp="$(mktemp)"
download_repo_file "scripts/lib/protection-flow-contract.mjs" "$tmp" "protection-flow-contract-v10"
cp -f "$tmp" "$SCRIPTS_DIR/lib/protection-flow-contract.mjs"
rm -f "$tmp"

tmp="$(mktemp)"
download_repo_file "scripts/vps-audit-pos-liquidar-a-liquidar-v10.mjs" "$tmp" "vps-audit-pos-liquidar-a-liquidar-v10"
cp -f "$tmp" "$SCRIPTS_DIR/vps-audit-pos-liquidar-a-liquidar-v10.mjs"
chmod 0755 "$SCRIPTS_DIR/vps-audit-pos-liquidar-a-liquidar-v10.mjs"
rm -f "$tmp"

log "2/2 auditar (somente leitura)"
cd "$SCRIPTS_DIR"
node ./vps-audit-pos-liquidar-a-liquidar-v10.mjs
