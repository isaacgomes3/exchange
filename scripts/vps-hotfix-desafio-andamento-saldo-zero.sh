#!/usr/bin/env bash
# Desafio: com saldo 0, mantém visível o card da entrada pendente (em andamento).
# Novos desafios disponíveis continuam bloqueados sem saldo.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-andamento-saldo-zero-f9cb/scripts/vps-hotfix-desafio-andamento-saldo-zero.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/desafio-andamento-saldo-zero-f9cb}"
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

log "1/1 UI — app-desafio.html (andamento visível com saldo 0)"
dl "deploy/vps-supabase/static/v2/app-desafio.html" "$WEB/app-desafio.html"
chmod 0644 "$WEB/app-desafio.html"
cp -f "$WEB/app-desafio.html" "$WEB_ROOT/app-desafio.html" 2>/dev/null || true

grep -q 'Entrada pendente fica visível mesmo com saldo Desafio zerado' "$WEB/app-desafio.html" \
  || die "app-desafio sem comentário de andamento com saldo 0"
grep -q 'pendingAmountsByStep' "$WEB/app-desafio.html" \
  || die "app-desafio sem valor da entrada pendente"
grep -q 'alreadyEntered' "$WEB/app-desafio.html" \
  || die "app-desafio sem flag alreadyEntered no card"
grep -q 'Novos desafios bloqueados' "$WEB/app-desafio.html" \
  || die "app-desafio sem empty de novos desafios bloqueados"
grep -q '!(desafioBalCents > 0)' "$WEB/app-desafio.html" \
  || die "app-desafio perdeu gate de lista disponível sem saldo"
# Não pode mais exigir saldo > 0 para pintar andamento
if grep -n 'var show' -A3 "$WEB/app-desafio.html" | grep -q 'desafioBalCents > 0'; then
  die "paintAndamentoSection ainda exige saldo > 0"
fi

log "OK — Ctrl+F5 em Desafio. Saldo 0 + entrada pendente: card em andamento visível."
echo "  Teste: https://arbishield.app/app-desafio.html"
