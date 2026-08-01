#!/usr/bin/env bash
# FORÇA correção do Saldo Real do Carlos (windfall cancel).
# Não depende de achar a proteção — debita R$ 903,89 se Real = R$ 10.971,41.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-reembolso-lucas-perdeu-723d/scripts/vps-forcar-debito-carlos-windfall-cancel.sh?$(date +%s)")
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
  local rel="$1"
  local out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/$rel?ref=${REF}&t=$(date +%s%N)" -o "$out" \
    && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "$RAW/$rel?v=$BUST&t=$(date +%s%N)" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

log "Baixar vps-forcar-debito-carlos-windfall-cancel.mjs"
tmp="$(mktemp)"
download_repo_file "scripts/vps-forcar-debito-carlos-windfall-cancel.mjs" "$tmp"
grep -q 'force-debit-carlos-windfall-cancel-v1' "$tmp" || die "script sem marker"
cp -f "$tmp" "$SCRIPTS_DIR/vps-forcar-debito-carlos-windfall-cancel.mjs"
chmod 0755 "$SCRIPTS_DIR/vps-forcar-debito-carlos-windfall-cancel.mjs"
rm -f "$tmp"

log "Dry-run"
(cd "$SCRIPTS_DIR" && node ./vps-forcar-debito-carlos-windfall-cancel.mjs)

log "Aplicar FIX=1"
(cd "$SCRIPTS_DIR" && FIX=1 node ./vps-forcar-debito-carlos-windfall-cancel.mjs)

echo
echo "OK — recarregue o espelho do Carlos (Ctrl+Shift+R)."
echo "  Esperado: Saldo Real / Apostador ≈ R\$ 10.067,52"
echo "  Extrato: admin_adjustment −R\$ 903,89"
