#!/usr/bin/env bash
# Hotfix: botão principal abre fluxo BetBra (não drawer manual / não desafio)
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/jogos-launch-form-fix-723d/scripts/vps-hotfix-jogos-lancar-form.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/jogos-launch-form-fix-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB"

log "UI Admin Jogos (fluxo BetBra vs manual)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/admin-jogos.html" -o "$WEB/admin-jogos.html"
chmod 0644 "$WEB/admin-jogos.html"
cp -f "$WEB/admin-jogos.html" "$WEB_ROOT/admin-jogos.html" 2>/dev/null || true

if [[ -d "$WEB_ROOT" ]]; then
  curl -fsSL "$RAW/deploy/vps-supabase/static/admin-jogos-vps.html" -o "$WEB_ROOT/admin-jogos-vps.html" 2>/dev/null || true
  chmod 0644 "$WEB_ROOT/admin-jogos-vps.html" 2>/dev/null || true
fi

grep -q 'openNormalLaunch\|Lançar jogo (BetBra)' "$WEB/admin-jogos.html" || \
  die "HTML sem fluxo BetBra no botão principal"
grep -q 'btnManualMatch' "$WEB/admin-jogos.html" || die "HTML sem botão Lançar manual"
grep -q 'Isto não cria Desafio\|não cria Desafio' "$WEB/admin-jogos.html" || \
  die "HTML sem aviso de que manual ≠ desafio"

echo
echo "OK — formulário de lançamento"
echo "  Botão principal: + Lançar jogo (BetBra) → aba Próximos jogos"
echo "  Botão secundário: Lançar manual → drawer (só fallback)"
echo "  https://arbishield.app/admin-jogos.html  (Ctrl+F5)"
