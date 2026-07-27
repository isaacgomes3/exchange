#!/usr/bin/env bash
# Auditoria GLOBAL — clientes com Saldo Reembolso inconsistente (bug Exchange)
#
# Na VPS (root):
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-audit-reembolso-inconsistencia-global.sh?ref=cursor/fix-reembolso-lucas-perdeu-723d&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-reembolso-lucas-perdeu-723d}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
mkdir -p "$SCRIPTS_DIR"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
need node

OUT="$SCRIPTS_DIR/vps-audit-reembolso-inconsistencia-global.mjs"
log "baixar auditoria global (ref=$REF)"
if ! curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  -H "Accept: application/vnd.github.raw" \
  -H "Cache-Control: no-cache" \
  -H "User-Agent: arbishield-hotfix" \
  "$API/scripts/vps-audit-reembolso-inconsistencia-global.mjs?ref=${REF}&t=$(date +%s%N)" -o "$OUT" \
  || [[ ! -s "$OUT" ]]; then
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "$RAW/scripts/vps-audit-reembolso-inconsistencia-global.mjs?t=$(date +%s%N)" -o "$OUT"
fi
[[ -s "$OUT" ]] || die "download vazio"
grep -q 'vps-audit-reembolso-inconsistencia-global-v1' "$OUT" || die "script inválido"
chmod 0644 "$OUT"

export MIN_REEMBOLSO_CENTS="${MIN_REEMBOLSO_CENTS:-1}"
export ONLY_SUSPECTS="${ONLY_SUSPECTS:-1}"
export LIMIT="${LIMIT:-2000}"
node "$OUT"
