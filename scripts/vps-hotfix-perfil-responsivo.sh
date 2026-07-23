#!/usr/bin/env bash
# Hotfix: Meu Perfil (CSS pf-*) + responsivo cliente/ADM
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-visual-disponivel-6aef/scripts/vps-hotfix-perfil-responsivo.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/desafio-visual-disponivel-6aef}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB"

log "resolvendo tip de $BRANCH"
SHA="$(
  curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/commits/${BRANCH}" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["sha"])'
)"
log "tip=$SHA"

RAW_JS="https://cdn.jsdelivr.net/gh/isaacgomes3/exchange@${SHA}"
RAW_GH="https://raw.githubusercontent.com/isaacgomes3/exchange/${SHA}"

fetch() {
  local rel="$1" dest="$2"
  if curl -fsSL "${RAW_JS}/${rel}" -o "$dest"; then
    return 0
  fi
  curl -fsSL "${RAW_GH}/${rel}?t=$(date +%s)" -o "$dest"
}

log "v2.css (perfil + responsivo)"
fetch "deploy/vps-supabase/static/v2/v2.css" "$WEB/v2.css"
chmod 0644 "$WEB/v2.css"
cp -f "$WEB/v2.css" "$WEB_ROOT/v2.css" 2>/dev/null || true
grep -q '\.pf-page' "$WEB/v2.css" || die "CSS sem .pf-page"
grep -q '\.pf-lbl' "$WEB/v2.css" || die "CSS sem .pf-lbl"
grep -q 'display: block' "$WEB/v2.css" || die "CSS sem display:block (labels)"
grep -q 'Mobile: drawer fixo' "$WEB/v2.css" || die "CSS sem drawer mobile"
grep -q '--bp-shell' "$WEB/v2.css" || die "CSS sem breakpoints responsivos"

log "v2-shell.js (fecha menu no mobile)"
fetch "deploy/vps-supabase/static/v2/v2-shell.js" "$WEB/v2-shell.js"
chmod 0644 "$WEB/v2-shell.js"
grep -q 'Escape' "$WEB/v2-shell.js" || die "shell sem Escape para fechar menu"
grep -q 'isMobileShell' "$WEB/v2-shell.js" || die "shell sem isMobileShell"

log "v2-perfil.js + app-perfil.html"
fetch "deploy/vps-supabase/static/v2/v2-perfil.js" "$WEB/v2-perfil.js"
fetch "deploy/vps-supabase/static/v2/app-perfil.html" "$WEB/app-perfil.html"
chmod 0644 "$WEB/v2-perfil.js" "$WEB/app-perfil.html"
grep -q 'pf-info' "$WEB/v2-perfil.js" || die "v2-perfil sem pf-info"
grep -q 'v2-perfil.js' "$WEB/app-perfil.html" || die "app-perfil sem v2-perfil.js"
grep -q 'perfil-fix-27' "$WEB/app-perfil.html" || die "app-perfil sem cache-bust perfil-fix-27"

log "OK — Ctrl+F5 em /app-perfil.html (e demais telas)"
