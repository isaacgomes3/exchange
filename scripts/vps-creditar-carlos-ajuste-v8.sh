#!/usr/bin/env bash
# Credita R$ 11,11 no Carlos (ajuste fees antigos → fórmula v8).
#
# Na VPS (root):
#   curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-reembolso-lucas-perdeu-723d/scripts/vps-creditar-carlos-ajuste-v8.sh?$(date +%s)" -o /tmp/cred-v8.sh
#   bash /tmp/cred-v8.sh
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

log "Baixar script"
tmp="$(mktemp)"
download_repo_file "scripts/vps-creditar-carlos-ajuste-v8.mjs" "$tmp"
cp -f "$tmp" "$SCRIPTS_DIR/vps-creditar-carlos-ajuste-v8.mjs"
chmod 0755 "$SCRIPTS_DIR/vps-creditar-carlos-ajuste-v8.mjs"
rm -f "$tmp"

log "1) DRY-RUN"
set +e
node "$SCRIPTS_DIR/vps-creditar-carlos-ajuste-v8.mjs"
rc=$?
set -e
if [[ $rc -ne 0 && $rc -ne 2 ]]; then
  die "dry-run falhou (exit $rc)"
fi

log "2) FIX=1"
FIX=1 node "$SCRIPTS_DIR/vps-creditar-carlos-ajuste-v8.mjs"
echo
echo "OK — Apostador deve ir a R\$ 8.982,52 · Reembolso continua R\$ 0 (Exchange)."
echo "Hard refresh no Financeiro."
