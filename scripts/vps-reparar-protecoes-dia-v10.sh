#!/usr/bin/env bash
# Reparo VPS — proteções do dia com regras erradas → contrato v10
#
# Na VPS (root):
#   DAY=2026-07-29 bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/protecao-v10-fonte-verdade-501d/scripts/vps-reparar-protecoes-dia-v10.sh?$(date +%s)")
# Aplicar:
#   DAY=2026-07-29 FIX=1 bash <(curl -fsSL "...")
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
DAY="${DAY:-2026-07-29}"
FIX="${FIX:-0}"

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

log "1/3 contrato v10"
tmp="$(mktemp)"
download_repo_file "scripts/lib/protection-flow-contract.mjs" "$tmp"
grep -q "protection-flow-contract-v10" "$tmp" || die "contrato sem v10"
cp -f "$tmp" "$SCRIPTS_DIR/lib/protection-flow-contract.mjs"
chmod 0644 "$SCRIPTS_DIR/lib/protection-flow-contract.mjs"
rm -f "$tmp"

log "2/3 script reparo dia"
tmp="$(mktemp)"
download_repo_file "scripts/vps-reparar-protecoes-dia-v10.mjs" "$tmp"
grep -q "vps-reparar-protecoes-dia-v10" "$tmp" || die "script inválido"
cp -f "$tmp" "$SCRIPTS_DIR/vps-reparar-protecoes-dia-v10.mjs"
chmod 0755 "$SCRIPTS_DIR/vps-reparar-protecoes-dia-v10.mjs"
rm -f "$tmp"

log "3/3 executar DAY=$DAY FIX=$FIX"
cd "$SCRIPTS_DIR"
DAY="$DAY" FIX="$FIX" node ./vps-reparar-protecoes-dia-v10.mjs

echo
echo "OK. Se foi dry-run, aplique com:"
echo "  DAY=$DAY FIX=1 bash <(curl -fsSL \"$RAW/scripts/vps-reparar-protecoes-dia-v10.sh?$(date +%s)\")"
