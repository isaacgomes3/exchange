#!/usr/bin/env bash
# Remove texto explicativo (app-desafio-lead) da página Desafio.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-desafio-remover-lead.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-58c29e42830b4faeb4e675ca31846635db7ce6e8}"
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

log "1/1 UI — app-desafio + v2.css (sem lead)"
for f in app-desafio.html v2.css; do
  dl "deploy/vps-supabase/static/v2/$f" "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
done

if grep -q 'app-desafio-lead' "$WEB/app-desafio.html"; then
  die "app-desafio ainda contém app-desafio-lead"
fi
if grep -q 'Entrada 1: você define' "$WEB/app-desafio.html"; then
  die "app-desafio ainda contém o texto da lead"
fi

log "OK — texto removido. Hard refresh (Ctrl+Shift+R)."
