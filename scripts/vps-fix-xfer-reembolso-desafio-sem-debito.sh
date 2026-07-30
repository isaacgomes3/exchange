#!/usr/bin/env bash
# Pedro: transfer Reembolso→Desafio sem débito no Reembolso — auditar/corrigir.
#
# Relatório:
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-fix-xfer-reembolso-desafio-sem-debito.sh?ref=cursor/fix-reembolso-lucas-perdeu-723d&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
#
# Aplicar débito faltante:
#   FIX=1 bash <(curl ...)
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-reembolso-lucas-perdeu-723d}"
FIX="${FIX:-0}"
ID_PREFIX="${ID_PREFIX:-24037bdf}"
TX_ID="${TX_ID:-9fcb1d29-ddf1-44cd-bf7d-f8c0a25b33a6}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
MARKER="vps-fix-xfer-reembolso-desafio-sem-debito-v1"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }

mkdir -p "$SCRIPTS_DIR"
tmp="$(mktemp)"
if ! curl -fsSL --retry 5 \
  -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" \
  -H "User-Agent: arbishield-hotfix" \
  "$API/scripts/vps-fix-xfer-reembolso-desafio-sem-debito.mjs?ref=${REF}&t=$(date +%s%N)" -o "$tmp"; then
  curl -fsSL "$RAW/scripts/vps-fix-xfer-reembolso-desafio-sem-debito.mjs?t=$(date +%s%N)" -o "$tmp"
fi
grep -q "$MARKER" "$tmp" || die "script sem $MARKER"
cp -f "$tmp" "$SCRIPTS_DIR/vps-fix-xfer-reembolso-desafio-sem-debito.mjs"
chmod 0644 "$SCRIPTS_DIR/vps-fix-xfer-reembolso-desafio-sem-debito.mjs"
rm -f "$tmp"

# Também publica shim atômico (previne novo caso)
tmp_shim="$(mktemp)"
if curl -fsSL --retry 5 \
  -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" \
  -H "User-Agent: arbishield-hotfix" \
  "$API/scripts/arbishield-serverfn-shim.mjs?ref=${REF}&t=$(date +%s%N)" -o "$tmp_shim" \
  && grep -q 'transfer-reembolso-desafio-atomic-v1' "$tmp_shim"; then
  SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
  cp -f "$tmp_shim" "$SHIM_DIR/arbishield-serverfn-shim.mjs"
  chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
  systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
  log "shim atomic transfer publicado"
fi
rm -f "$tmp_shim"

export FIX ID_PREFIX TX_ID
cd /opt/arbishield 2>/dev/null || cd "$SCRIPTS_DIR/.." || true
node "$SCRIPTS_DIR/vps-fix-xfer-reembolso-desafio-sem-debito.mjs"
