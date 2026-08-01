#!/usr/bin/env bash
# Barra superior: botão Modo ADM / Modo usuário (somente admins).
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-admin-mode-switch.sh")
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

log "1/2 UI — v2-shell.js (botão modo)"
dl "deploy/vps-supabase/static/v2/v2-shell.js" "$WEB/v2-shell.js"
chmod 0644 "$WEB/v2-shell.js"
cp -f "$WEB/v2-shell.js" "$WEB_ROOT/v2-shell.js" 2>/dev/null || true
grep -q 'v2ModeSwitch' "$WEB/v2-shell.js" || die "shell sem v2ModeSwitch"
grep -q 'Modo usuário' "$WEB/v2-shell.js" || die "shell sem Modo usuário"
grep -q 'Modo ADM' "$WEB/v2-shell.js" || die "shell sem Modo ADM"

log "2/2 UI — v2.css (estilo do botão)"
dl "deploy/vps-supabase/static/v2/v2.css" "$WEB/v2.css"
chmod 0644 "$WEB/v2.css"
cp -f "$WEB/v2.css" "$WEB_ROOT/v2.css" 2>/dev/null || true
grep -q '\.v2-mode-switch' "$WEB/v2.css" || die "css sem .v2-mode-switch"

log "OK — Ctrl+F5. ADM vê Modo usuário no painel; na área do membro vê Modo ADM."
echo "  Teste admin: https://arbishield.app/admin.html"
echo "  Teste app:   https://arbishield.app/app.html"
