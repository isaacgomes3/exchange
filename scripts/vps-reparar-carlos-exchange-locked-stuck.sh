#!/usr/bin/env bash
# Repara Carlos: Congelado R$1.000 preso com 0 proteções ativas (Exchange stuck).
# Aplica regra v7: devolve stake + cobra dedução + comissão 4,5%.
#
# Na VPS (root):
#   curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-reembolso-lucas-perdeu-723d/scripts/vps-reparar-carlos-exchange-locked-stuck.sh?$(date +%s)" -o /tmp/repair-carlos.sh
#   bash /tmp/repair-carlos.sh
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

log "1/3 contrato + script"
tmp_c="$(mktemp)"
download_repo_file "scripts/lib/protection-flow-contract.mjs" "$tmp_c"
cp -f "$tmp_c" "$SCRIPTS_DIR/lib/protection-flow-contract.mjs"
chmod 0644 "$SCRIPTS_DIR/lib/protection-flow-contract.mjs"
rm -f "$tmp_c"

tmp_s="$(mktemp)"
download_repo_file "scripts/vps-reparar-carlos-exchange-locked-stuck.mjs" "$tmp_s"
cp -f "$tmp_s" "$SCRIPTS_DIR/vps-reparar-carlos-exchange-locked-stuck.mjs"
chmod 0755 "$SCRIPTS_DIR/vps-reparar-carlos-exchange-locked-stuck.mjs"
rm -f "$tmp_s"

log "2/3 dry-run"
(cd "$SCRIPTS_DIR" && node ./vps-reparar-carlos-exchange-locked-stuck.mjs) || true

log "3/3 FIX=1"
(cd "$SCRIPTS_DIR" && FIX=1 node ./vps-reparar-carlos-exchange-locked-stuck.mjs)

echo
echo "OK — conferir Centro Financeiro do Carlos:"
echo "  Apostador ≈ R\$ 8.982,52 (8.067,52 + 1.000 − 80,50 − 4,50)"
echo "  Congelado = R\$ 0,00"
echo "  Reembolso = R\$ 0,00"
echo
echo "Se o settle automático ainda estiver antigo, rode também:"
echo "  bash /tmp/hf-ex-v7.sh   # vps-hotfix-exchange-devolve-cobra-v7.sh"
