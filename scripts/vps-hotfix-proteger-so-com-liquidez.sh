#!/usr/bin/env bash
# Proteger: só jogos com liquidez restante na grade (legado Je).
# Mantém logos + odd readonly no mesmo arquivo (anti-regressão).
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-proteger-so-com-liquidez.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
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

log "1/1 UI — app-proteger.html (só com liquidez)"
dl "deploy/vps-supabase/static/v2/app-proteger.html" "$WEB/app-proteger.html"
chmod 0644 "$WEB/app-proteger.html"
cp -f "$WEB/app-proteger.html" "$WEB_ROOT/app-proteger.html" 2>/dev/null || true

grep -q 'liqLeft(m) <= 0' "$WEB/app-proteger.html" || die "sem filtro liqLeft <= 0"
grep -q 'used < max' "$WEB/app-proteger.html" || die "sem filtro used < max"
grep -q 'Sem partidas com liquidez' "$WEB/app-proteger.html" || die "sem empty de liquidez"
grep -q 'aria-readonly="true"' "$WEB/app-proteger.html" || die "regressão: odd readonly"
grep -q 'term-match-teams' "$WEB/app-proteger.html" || die "regressão: logos"
grep -q 'mesmo sem liquidez' "$WEB/app-proteger.html" && die "ainda mostra jogos sem liquidez" || true

log "OK — Ctrl+F5 em Proteger. Jogos com R\$ 0 somem da grade."
echo "  Teste: https://arbishield.app/app-proteger.html"
