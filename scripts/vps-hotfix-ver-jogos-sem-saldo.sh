#!/usr/bin/env bash
# Jogos sempre visíveis sem saldo — bloqueia só a ação (proteger/apostar).
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-ver-jogos-sem-saldo.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-277dc9732b9748dc1f5b54d3fe8df8f2dd1f286e}"
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

log "1/3 UI — app-proteger.html (lista sem filtro de saldo)"
dl "deploy/vps-supabase/static/v2/app-proteger.html" "$WEB/app-proteger.html"
chmod 0644 "$WEB/app-proteger.html"
cp -f "$WEB/app-proteger.html" "$WEB_ROOT/app-proteger.html" 2>/dev/null || true
grep -q 'hasProtectLiquidity' "$WEB/app-proteger.html" || die "proteger sem hasProtectLiquidity"
grep -q 'não depende do seu saldo\|nao depende do seu saldo\|Isso não depende do seu saldo' "$WEB/app-proteger.html" \
  || die "proteger sem aviso de saldo"

log "2/3 UI — app-desafio.html (jogos visíveis; depósito só para apostar)"
dl "deploy/vps-supabase/static/v2/app-desafio.html" "$WEB/app-desafio.html"
chmod 0644 "$WEB/app-desafio.html"
cp -f "$WEB/app-desafio.html" "$WEB_ROOT/app-desafio.html" 2>/dev/null || true
grep -q 'já estão visíveis' "$WEB/app-desafio.html" || die "desafio sem copy de visibilidade"
grep -q 'desafioBalCents < amountCents' "$WEB/app-desafio.html" || die "desafio sem gate de apostar"

log "3/3 UI — v2.css (linha esgotada)"
dl "deploy/vps-supabase/static/v2/v2.css" "$WEB/v2.css"
chmod 0644 "$WEB/v2.css"
cp -f "$WEB/v2.css" "$WEB_ROOT/v2.css" 2>/dev/null || true
grep -q 'is-exhausted' "$WEB/v2.css" || die "css sem is-exhausted"

log "OK — Ctrl+F5 em Proteger e Desafio. Lista aparece sem saldo; ação exige depósito."
