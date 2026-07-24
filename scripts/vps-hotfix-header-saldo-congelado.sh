#!/usr/bin/env bash
# Header: Apostador | Afiliado | Desafio | Congelado | Provedor na MESMA linha.
# Motivo de regressão: hotfixes de desafio/responsivo/jogos baixam v2.css antigo
# (grid de 4 colunas) e o 5º chip (Provedor) cai na segunda linha.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-header-saldo-congelado.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-99ec74e}"
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

log "1/1 UI — 5 chips na mesma linha (flex responsivo)"
for f in v2-shell.js v2.css v2-financeiro.js; do
  dl "deploy/vps-supabase/static/v2/$f" "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
done

grep -q 'v2BalCongelado' "$WEB/v2-shell.js" || die "v2-shell sem chip Congelado"
grep -q 'v2BalProvedor' "$WEB/v2-shell.js" || die "v2-shell sem chip Provedor"
grep -q 'v2-bal-congelado' "$WEB/v2-shell.js" || die "v2-shell sem classe Congelado"
grep -q 'locked_balance_cents' "$WEB/v2-shell.js" || die "v2-shell sem locked_balance_cents"
grep -q 'v2-bal-congelado' "$WEB/v2.css" || die "v2.css sem estilo Congelado"
grep -q 'flex-wrap: nowrap' "$WEB/v2.css" || die "v2.css sem flex nowrap (chips 1 linha)"
grep -q 'flex-wrap: nowrap' "$WEB/v2.css" || die "v2.css sem linha única dos chips"
grep -q 'v2BalCongelado' "$WEB/v2-financeiro.js" || die "v2-financeiro sem sync Congelado"
grep -q 'providerBalance' "$WEB/v2-financeiro.js" || die "v2-financeiro sem sync Provedor"

log "OK — header: Apostador | Afiliado | Desafio | Congelado | Provedor (1 linha)"
log "Hard refresh (Ctrl+Shift+R) em qualquer /app*.html"
