#!/usr/bin/env bash
# Check pós-deploy v10 / stake_lock (health + billing_model).
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/protecao-v10-fonte-verdade-501d/scripts/vps-check-pos-deploy-v10.sh?$(date +%s)")
#
# Opcional:
#   SINCE=2026-07-30T12:00:00.000Z SKIP_DB=1 bash ...
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
  local tmp; tmp="$(mktemp)"
  if curl -fsSL --retry 3 --retry-delay 1 -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-check-pos-deploy" "$url" -o "$tmp" 2>/dev/null \
    && is_valid_js "$tmp" "$needle"; then
    mv -f "$tmp" "$out"; return 0
  fi
  rm -f "$tmp"; return 1
}

try_api_raw() {
  local rel="$1" out="$2" needle="$3"
  local tmp; tmp="$(mktemp)"
  if curl -fsSL --retry 3 --retry-delay 1 \
    -H "Accept: application/vnd.github.raw" \
    -H "User-Agent: arbishield-check-pos-deploy" \
    "$API/$rel?ref=${REF}&t=${BUST}" -o "$tmp" 2>/dev/null \
    && is_valid_js "$tmp" "$needle"; then
    mv -f "$tmp" "$out"; return 0
  fi
  rm -f "$tmp"; return 1
}

download_repo_file() {
  local rel="$1" out="$2" needle="$3"
  local t; t="$(date +%s%N)"
  try_api_raw "$rel" "$out" "$needle" && return 0
  try_fetch "$RAW/$rel?v=$BUST&t=$t" "$out" "$needle" && return 0
  try_fetch "$JSDELIVR/$rel?t=$t" "$out" "$needle" && return 0
  die "nao baixou: $rel"
}

log "baixar contrato + check pós-deploy"
tmp_c="$(mktemp)"
download_repo_file "scripts/lib/protection-flow-contract.mjs" "$tmp_c" "protection-runtime-stake-lock-v10"
cp -f "$tmp_c" "$SCRIPTS_DIR/lib/protection-flow-contract.mjs"
chmod 0644 "$SCRIPTS_DIR/lib/protection-flow-contract.mjs"
rm -f "$tmp_c"

tmp="$(mktemp)"
download_repo_file "scripts/vps-check-pos-deploy-v10.mjs" "$tmp" "vps-check-pos-deploy-v10"
cp -f "$tmp" "$SCRIPTS_DIR/vps-check-pos-deploy-v10.mjs"
chmod 0755 "$SCRIPTS_DIR/vps-check-pos-deploy-v10.mjs"
rm -f "$tmp"

log "rodar check"
cd "$SCRIPTS_DIR"
SINCE="${SINCE:-}" SKIP_DB="${SKIP_DB:-}" node ./vps-check-pos-deploy-v10.mjs
