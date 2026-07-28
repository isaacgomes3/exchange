#!/usr/bin/env bash
# OBSOLETO — proteção do zero. Não reinstala lógica antiga.
echo "ABORTADO: logica de protecao antiga excluida (protecao-do-zero)." >&2
echo "Use: scripts/vps-hotfix-protecao-do-zero.sh  (stub 501)" >&2
echo "Depois implemente a nova logica em scripts/lib/protection-flow-scaffold.mjs" >&2
exit 1

# --- abaixo: legado (nao executa) ---
# Hotfix: Proteger Aposta — jogo sem liquidez sai da grade (legado)
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/proteger-sem-liquidez-sair-grade-723d/scripts/vps-hotfix-proteger-sem-liquidez.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/proteger-sem-liquidez-sair-grade-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB"

log "UI Proteger Aposta (sair da grade sem liquidez)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/app-proteger.html" -o "$WEB/app-proteger.html"
chmod 0644 "$WEB/app-proteger.html"
cp -f "$WEB/app-proteger.html" "$WEB_ROOT/app-proteger.html" 2>/dev/null || true

grep -q 'isOnAvailableGrid' "$WEB/app-proteger.html" || die "HTML sem isOnAvailableGrid"
grep -q 'LIVE_WINDOW_MS = 9000' "$WEB/app-proteger.html" || die "HTML sem janela live do legado"
! grep -q 'liqLeft(m) > 0 || (Array.isArray(m.markets)' "$WEB/app-proteger.html" || \
  die "HTML ainda mantém jogos sem liquidez na grade"

echo
echo "OK — jogos com liquidez esgotada saem da grade"
echo "  https://arbishield.app/app-proteger.html  (Ctrl+F5)"
