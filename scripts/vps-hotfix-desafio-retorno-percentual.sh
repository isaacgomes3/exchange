#!/usr/bin/env bash
# Retorno estimado no Desafio = % cadastrado (target_profit_pct), não lucro em R$.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-desafio-retorno-percentual.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-PLACEHOLDER_SHA}"
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

log "1/2 UI — app-desafio.html (retorno = lucro alvo %)"
dl "deploy/vps-supabase/static/v2/app-desafio.html" "$WEB/app-desafio.html"
chmod 0644 "$WEB/app-desafio.html"
cp -f "$WEB/app-desafio.html" "$WEB_ROOT/app-desafio.html" 2>/dev/null || true
grep -q 'fmtTargetProfitPct' "$WEB/app-desafio.html" || die "desafio sem fmtTargetProfitPct"
grep -q 'lucro alvo cadastrado' "$WEB/app-desafio.html" || die "desafio sem label lucro alvo"
grep -q 'money(retorno)\|recebeArbiCents - sides.stakeCents' "$WEB/app-desafio.html" \
  && die "desafio ainda calcula retorno em R$" || true

log "2/2 UI — v2.css (estilo sub do retorno)"
dl "deploy/vps-supabase/static/v2/v2.css" "$WEB/v2.css"
chmod 0644 "$WEB/v2.css"
cp -f "$WEB/v2.css" "$WEB_ROOT/v2.css" 2>/dev/null || true
grep -q 'dz-v2-retorno-sub' "$WEB/v2.css" || die "css sem dz-v2-retorno-sub"

log "OK — Ctrl+F5 em Desafio. Faixa verde deve mostrar +X% (lucro alvo), não R\$."
echo "  Teste: https://arbishield.app/app-desafio.html"
