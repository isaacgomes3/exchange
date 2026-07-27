#!/usr/bin/env bash
# Reparo Carlos: stake do último jogo finalizado NÃO voltou.
# Alvo: R$ 8.976,41 (= 8.067,52 + 1.000 − 91,11) · Congelado 0
#
# Na VPS (root):
#   curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-reembolso-lucas-perdeu-723d/scripts/vps-reparar-carlos-stake-nao-voltou.sh?$(date +%s)" -o /tmp/rep-carlos.sh
#   bash /tmp/rep-carlos.sh
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

log "0) Garantir settle v9 na VPS (devolve stake + só dedução)"
tmp_hf="$(mktemp)"
if curl -fsSL --retry 3 --retry-all-errors --retry-delay 1 \
  "$RAW/scripts/vps-hotfix-exchange-so-deducao-v9.sh?v=$BUST" -o "$tmp_hf" && [[ -s "$tmp_hf" ]]; then
  bash "$tmp_hf" || echo "AVISO: hotfix v9 retornou erro — sigo com reparo de saldo"
else
  echo "AVISO: não baixei hotfix v9 — sigo com reparo de saldo"
fi
rm -f "$tmp_hf"

log "1) Baixar script de reparo"
tmp="$(mktemp)"
download_repo_file "scripts/vps-reparar-carlos-stake-nao-voltou.mjs" "$tmp"
cp -f "$tmp" "$SCRIPTS_DIR/vps-reparar-carlos-stake-nao-voltou.mjs"
chmod 0755 "$SCRIPTS_DIR/vps-reparar-carlos-stake-nao-voltou.mjs"
rm -f "$tmp"

log "2) DRY-RUN"
set +e
node "$SCRIPTS_DIR/vps-reparar-carlos-stake-nao-voltou.mjs"
rc=$?
set -e
if [[ $rc -ne 0 && $rc -ne 2 ]]; then
  die "dry-run falhou (exit $rc)"
fi

log "3) FIX=1"
FIX=1 node "$SCRIPTS_DIR/vps-reparar-carlos-stake-nao-voltou.mjs"
echo
echo "OK — Apostador deve ser R\$ 8.976,41 · Congelado R\$ 0,00 · Reembolso R\$ 0,00"
echo "Hard refresh no Financeiro / Espelho."
