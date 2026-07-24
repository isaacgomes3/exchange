#!/usr/bin/env bash
# Grade Proteger: jogos visíveis; ação exige saldo.
# NÃO sobrescreve app-desafio (evita reverter acesso/retorno).
# Exige odd readonly + logos para não regredir fixes posteriores.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-ver-jogos-sem-saldo.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-97339a361ac8237e71c5dc71f4c8471afe12ab84}"
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

log "1/2 UI — app-proteger.html"
dl "deploy/vps-supabase/static/v2/app-proteger.html" "$WEB/app-proteger.html"
chmod 0644 "$WEB/app-proteger.html"
cp -f "$WEB/app-proteger.html" "$WEB_ROOT/app-proteger.html" 2>/dev/null || true
grep -q 'hasProtectLiquidity' "$WEB/app-proteger.html" || die "proteger sem hasProtectLiquidity"
grep -q 'não depende do seu saldo\|nao depende do seu saldo\|Isso não depende do seu saldo' "$WEB/app-proteger.html" \
  || die "proteger sem aviso de saldo"
grep -q 'aria-readonly="true"' "$WEB/app-proteger.html" || die "regressão: odd readonly ausente"
grep -q 'term-match-teams' "$WEB/app-proteger.html" || die "regressão: logos ausentes"

log "2/2 UI — v2.css (linha esgotada + logos)"
dl "deploy/vps-supabase/static/v2/v2.css" "$WEB/v2.css"
chmod 0644 "$WEB/v2.css"
cp -f "$WEB/v2.css" "$WEB_ROOT/v2.css" 2>/dev/null || true
grep -q 'is-exhausted' "$WEB/v2.css" || die "css sem is-exhausted"
grep -q '\.term-team-logo' "$WEB/v2.css" || die "css sem logos"

log "OK — Ctrl+F5 em Proteger. (Desafio não é alterado por este hotfix.)"
echo "  Teste: https://arbishield.app/app-proteger.html"
