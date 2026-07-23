#!/usr/bin/env bash
# Desafio: saldo retido/congelado do ciclo NÃO financia entrada usável.
# Green na zebra mantém payout retido; bateu casa zera o congelado no saldo usável.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-desafio-saldo-congelado.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-REPLACE_SHA}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT" "$SHIM_DIR"

dl() {
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$RAW/$1?v=$BUST" -o "$2"
}

log "1/2 Shim — register/settle sem usar saldo congelado na entrada"
dl "scripts/arbishield-serverfn-shim.mjs" "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
grep -q 'clawbackDesafioRetainedFromSpendable' "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  || die "shim sem clawbackDesafioRetainedFromSpendable"
grep -q 'Nunca reusable' "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  || grep -q 'nunca locked' "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  || die "shim transfer ainda pode usar reusable/locked"
grep -q 'side === "casa"' "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  || die "shim settle ainda credita zebra no saldo usável"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

log "2/2 UI — carteira/transferência e mensagem de saldo"
for f in v2-financeiro.js app-desafio.html; do
  dl "deploy/vps-supabase/static/v2/$f" "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
done
grep -q 'transferableReal' "$WEB/v2-financeiro.js" \
  || die "v2-financeiro sem transferableReal"
grep -q 'saldo congelado/retido' "$WEB/app-desafio.html" \
  || die "app-desafio sem aviso de saldo congelado"

log "OK — saldo congelado do ciclo não entra como saldo usável; zera no bateu casa"
