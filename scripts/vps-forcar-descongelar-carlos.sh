#!/usr/bin/env bash
# FORÇA zerar Congelado do Carlos (print: 8.067,52 + locked 1.000).
# Alvo: Apostador ≈ R$ 8.971,41 · Congelado R$ 0.
#
# Na VPS (root) — rode ESTE (não o repair antigo):
#   curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-reembolso-lucas-perdeu-723d/scripts/vps-forcar-descongelar-carlos.sh?$(date +%s)" -o /tmp/unfreeze-carlos.sh
#   bash /tmp/unfreeze-carlos.sh
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

log "1/3 baixar forcar-descongelar"
tmp="$(mktemp)"
download_repo_file "scripts/vps-forcar-descongelar-carlos.mjs" "$tmp"
cp -f "$tmp" "$SCRIPTS_DIR/vps-forcar-descongelar-carlos.mjs"
chmod 0755 "$SCRIPTS_DIR/vps-forcar-descongelar-carlos.mjs"
rm -f "$tmp"

log "2/3 dry-run"
(cd "$SCRIPTS_DIR" && node ./vps-forcar-descongelar-carlos.mjs) || true

log "3/3 FIX=1 (aplica de verdade)"
(cd "$SCRIPTS_DIR" && FIX=1 node ./vps-forcar-descongelar-carlos.mjs)

echo
echo "OK — atualize o Financeiro (F5 / hard refresh)."
echo "  Esperado: Apostador ≈ R\$ 8.971,41 · Congelado R\$ 0,00"
echo
echo "Se ainda mostrar congelado, limpe cache do browser ou abra em aba anônima."
