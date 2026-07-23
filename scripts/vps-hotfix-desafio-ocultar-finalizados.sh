#!/usr/bin/env bash
# Desafio: após Bateu (status done) o jogo some da lista "Desafios disponíveis".
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-desafio-ocultar-finalizados.sh")
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

log "1/2 UI — filtrar etapas finalizadas na lista"
dl "deploy/vps-supabase/static/v2/app-desafio.html" "$WEB/app-desafio.html"
chmod 0644 "$WEB/app-desafio.html"
cp -f "$WEB/app-desafio.html" "$WEB_ROOT/app-desafio.html" 2>/dev/null || true
grep -q 'stepIsFinished' "$WEB/app-desafio.html" || die "app-desafio sem stepIsFinished"
grep -q '!stepIsFinished(s)' "$WEB/app-desafio.html" || die "app-desafio ainda lista etapas done"

log "2/2 Shim — desativa desafio quando todas as etapas encerram"
dl "scripts/arbishield-serverfn-shim.mjs" "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
grep -q 'desafioDeactivated' "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  || die "shim sem desativação pós-settle"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

log "OK — jogos com Bateu/finalizados não ficam ativos na lista do cliente"
