#!/usr/bin/env bash
# Desafio: sem saldo (> R$ 0) não mostra desafios disponíveis — sem valor mínimo.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-desafio-ocultar-sem-saldo.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-97792d6b5cc1bbb9b98c3d8b892aabe4fa9e07ca}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT"

dl() {
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$RAW/$1?v=$BUST" -o "$2"
}

log "1/1 UI — app-desafio.html (lista só com saldo > 0)"
dl "deploy/vps-supabase/static/v2/app-desafio.html" "$WEB/app-desafio.html"
chmod 0644 "$WEB/app-desafio.html"
cp -f "$WEB/app-desafio.html" "$WEB_ROOT/app-desafio.html" 2>/dev/null || true
grep -q 'Acesso aos desafios bloqueado' "$WEB/app-desafio.html" || die "desafio sem empty de bloqueio"
grep -q '!(desafioBalCents > 0)' "$WEB/app-desafio.html" || die "desafio sem gate saldo > 0"
grep -q 'pelo menos' "$WEB/app-desafio.html" && die "desafio ainda exige valor mínimo na mensagem" || true

log "OK — Ctrl+F5 em Desafio. Com saldo 0 a lista fica bloqueada; qualquer saldo libera."
echo "  Teste: https://arbishield.app/app-desafio.html"
