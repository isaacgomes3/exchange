#!/usr/bin/env bash
# Auditoria Saldo Reembolso — Lucas Gonçalves dos Santos (id~1210f201…)
#
# Na VPS (root):
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-audit-reembolso-lucas.sh?ref=cursor/audit-reembolso-lucas-723d&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/audit-reembolso-lucas-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
mkdir -p "$SCRIPTS_DIR"

NAME="${NAME:-Lucas Gonçalves dos Santos}"
ID_PREFIX="${ID_PREFIX:-1210f201}"
EXPECTED_REEMBOLSO_CENTS="${EXPECTED_REEMBOLSO_CENTS:-14900}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
need node

OUT="$SCRIPTS_DIR/vps-audit-reembolso-lucas.mjs"
log "baixar script (ref=$REF)"
if ! curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  -H "Accept: application/vnd.github.raw" \
  -H "Cache-Control: no-cache" \
  -H "User-Agent: arbishield-hotfix" \
  "$API/scripts/vps-audit-reembolso-lucas.mjs?ref=${REF}&t=$(date +%s%N)" -o "$OUT" \
  || [[ ! -s "$OUT" ]]; then
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "$RAW/scripts/vps-audit-reembolso-lucas.mjs?t=$(date +%s%N)" -o "$OUT"
fi
[[ -s "$OUT" ]] || die "download vazio"
grep -q 'vps-audit-reembolso-lucas-v1' "$OUT" || die "script inválido (marker)"
chmod 0644 "$OUT"

export NAME ID_PREFIX EXPECTED_REEMBOLSO_CENTS
log "executar auditoria NAME=$NAME ID_PREFIX=$ID_PREFIX"
node "$OUT"
