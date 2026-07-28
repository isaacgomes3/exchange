#!/usr/bin/env bash
# Hotfix: restaurar jogos na grade Proteger (mesmo sem liquidez restante).
# Reverte o deploy de vps-hotfix-proteger-so-com-liquidez.sh na VPS.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-partidas-sumiram-47c1/scripts/vps-hotfix-fix-partidas-sumiram.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-partidas-sumiram-47c1}"
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

log "1/1 UI — app-proteger.html (restaurar grade de jogos)"
dl "deploy/vps-supabase/static/v2/app-proteger.html" "$WEB/app-proteger.html"
chmod 0644 "$WEB/app-proteger.html"
cp -f "$WEB/app-proteger.html" "$WEB_ROOT/app-proteger.html" 2>/dev/null || true

grep -q 'hasProtectLiquidity' "$WEB/app-proteger.html" || die "sem hasProtectLiquidity"
grep -q 'Sem partidas na janela agora' "$WEB/app-proteger.html" || die "sem empty state correto"
grep -q 'aria-readonly="true"' "$WEB/app-proteger.html" || die "regressão: odd readonly"
grep -q 'term-match-teams' "$WEB/app-proteger.html" || die "regressão: logos"
grep -q 'liqLeft(m) <= 0) return false' "$WEB/app-proteger.html" && die "ainda esconde jogos sem liquidez" || true
grep -q 'Sem partidas com liquidez' "$WEB/app-proteger.html" && die "ainda usa empty de liquidez" || true

log "OK — Ctrl+F5 em Proteger. Jogos voltam à grade; botão fica desabilitado sem liquidez."
echo "  Teste: https://arbishield.app/app-proteger.html"
