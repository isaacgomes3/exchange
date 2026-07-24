#!/usr/bin/env bash
# Corrige dropdown Tipo (LAY/BACK): opções ilegíveis (texto claro em fundo claro).
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-select-back-visivel.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-REPLACE_SHA}"
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

log "1/1 UI — admin-jogos + admin-desafios (select option legível)"
for f in admin-jogos.html admin-desafios.html; do
  dl "deploy/vps-supabase/static/v2/$f" "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
done

grep -q 'color-scheme: dark' "$WEB/admin-jogos.html" || die "admin-jogos sem color-scheme dark"
grep -q '\.field select option' "$WEB/admin-jogos.html" || die "admin-jogos sem estilo option"
grep -q 'value="BACK"' "$WEB/admin-jogos.html" || die "admin-jogos sem opção BACK"
grep -q 'color-scheme: dark' "$WEB/admin-desafios.html" || die "admin-desafios sem color-scheme dark"
grep -q '\.field select option' "$WEB/admin-desafios.html" || die "admin-desafios sem estilo option"

log "OK — LAY e BACK devem aparecer com contraste. Hard refresh (Ctrl+Shift+R)."
