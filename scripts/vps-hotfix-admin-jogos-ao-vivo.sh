#!/usr/bin/env bash
# Gestão de Jogos: filtro/badge Ao vivo (janela ~3h pós-kickoff).
# Antes, qualquer jogo com proteção aberta virava só "A liquidar".
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-admin-jogos-ao-vivo.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-0a6bf74bc10fd4d2ac5eee8b9169e947e70963d5}"
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

log "1/1 UI — admin-jogos (filtro Ao vivo)"
dl "deploy/vps-supabase/static/v2/admin-jogos.html" "$WEB/admin-jogos.html"
chmod 0644 "$WEB/admin-jogos.html"
cp -f "$WEB/admin-jogos.html" "$WEB_ROOT/admin-jogos.html" 2>/dev/null || true

grep -q 'data-pf="live"' "$WEB/admin-jogos.html" || die "sem chip Ao vivo"
grep -q 'matchIsLiveWindow' "$WEB/admin-jogos.html" || die "sem matchIsLiveWindow"
grep -q 'platformFilter === "live"' "$WEB/admin-jogos.html" || die "sem filtro live"

log "OK — Ao vivo disponível. Hard refresh (Ctrl+Shift+R)."
