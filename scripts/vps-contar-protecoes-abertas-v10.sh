#!/usr/bin/env bash
# Lista proteções ainda abertas e o modelo gravado (stake_lock_v1?).
#
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/purgar-fee-upfront-cite-84e5/scripts/vps-contar-protecoes-abertas-v10.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
JSDELIVR="https://cdn.jsdelivr.net/gh/isaacgomes3/exchange@${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
need node
mkdir -p "$SCRIPTS_DIR"

tmp="$(mktemp)"
if ! curl -fsSL --retry 3 "${JSDELIVR}/scripts/vps-contar-protecoes-abertas-v10.mjs" -o "$tmp" \
  && ! curl -fsSL --retry 3 "${RAW}/scripts/vps-contar-protecoes-abertas-v10.mjs?t=$(date +%s)" -o "$tmp"; then
  die "falha ao baixar script"
fi
grep -q 'vps-contar-protecoes-abertas-v10' "$tmp" || die "arquivo inválido"
cp -f "$tmp" "$SCRIPTS_DIR/vps-contar-protecoes-abertas-v10.mjs"
chmod 0755 "$SCRIPTS_DIR/vps-contar-protecoes-abertas-v10.mjs"
rm -f "$tmp"

log "rodando contagem de proteções abertas"
cd "$SCRIPTS_DIR"
node ./vps-contar-protecoes-abertas-v10.mjs
