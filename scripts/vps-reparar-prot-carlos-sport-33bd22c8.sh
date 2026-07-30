#!/usr/bin/env bash
# Reparo bilhete Carlos Sport×Cuiabá (33bd22c8) — LAY 1000 @32 won_exchange
# Stake não voltou. Alvo: R$ 9.051,71 (= 8.067,52 + 1.000 − 15,81)
#
# Na VPS (root):
#   curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-reembolso-lucas-perdeu-723d/scripts/vps-reparar-prot-carlos-sport-33bd22c8.sh?$(date +%s)" -o /tmp/rep-sport.sh
#   bash /tmp/rep-sport.sh
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-reembolso-lucas-perdeu-723d}"
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

log "0) Hotfix settle v9 + contrato"
tmp_hf="$(mktemp)"
curl -fsSL --retry 3 "$RAW/scripts/vps-hotfix-exchange-so-deducao-v9.sh?v=$BUST" -o "$tmp_hf" || true
if [[ -s "$tmp_hf" ]]; then bash "$tmp_hf" || echo "AVISO: hotfix com erro"; fi
rm -f "$tmp_hf"

tmp_c="$(mktemp)"
download_repo_file "scripts/lib/protection-flow-contract.mjs" "$tmp_c"
cp -f "$tmp_c" "$SCRIPTS_DIR/lib/protection-flow-contract.mjs"
chmod 0644 "$SCRIPTS_DIR/lib/protection-flow-contract.mjs"
rm -f "$tmp_c"

log "1) Baixar reparo do bilhete"
tmp="$(mktemp)"
download_repo_file "scripts/vps-reparar-prot-carlos-sport-33bd22c8.mjs" "$tmp"
cp -f "$tmp" "$SCRIPTS_DIR/vps-reparar-prot-carlos-sport-33bd22c8.mjs"
chmod 0755 "$SCRIPTS_DIR/vps-reparar-prot-carlos-sport-33bd22c8.mjs"
rm -f "$tmp"

log "2) DRY-RUN"
node "$SCRIPTS_DIR/vps-reparar-prot-carlos-sport-33bd22c8.mjs"

log "3) FIX=1"
FIX=1 node "$SCRIPTS_DIR/vps-reparar-prot-carlos-sport-33bd22c8.mjs"

echo
echo "OK esperado:"
echo "  Apostador R\$ 9.051,71  (= 8.067,52 + 1.000 − 15,81)"
echo "  Congelado R\$ 0,00"
echo "  Reembolso R\$ 0,00"
echo "Hard refresh no Financeiro / Espelho."
