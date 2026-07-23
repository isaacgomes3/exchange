#!/usr/bin/env bash
# Hotfix: visual Desafios disponíveis (mockup confronto + painéis Arbi/Casa)
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-visual-disponivel-6aef/scripts/vps-hotfix-desafio-visual.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/desafio-visual-disponivel-6aef}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB"

log "app-desafio.html (visual mockup)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/app-desafio.html" -o "$WEB/app-desafio.html"
chmod 0644 "$WEB/app-desafio.html"
grep -q 'dz-v2-compare' "$WEB/app-desafio.html" || die "HTML sem dz-v2-compare"
grep -q 'Maior retorno' "$WEB/app-desafio.html" || die "HTML sem Maior retorno"
grep -q 'resolveTeamLogo' "$WEB/app-desafio.html" || die "HTML sem resolveTeamLogo"

log "v2.css (estilos do card v2)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/v2.css" -o "$WEB/v2.css"
chmod 0644 "$WEB/v2.css"
grep -q 'dz-v2-panel' "$WEB/v2.css" || die "CSS sem dz-v2-panel"
grep -q 'dz-wallet-bar' "$WEB/v2.css" || die "CSS sem dz-wallet-bar"

log "admin-desafios.html (home/away a partir do nome do jogo)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/admin-desafios.html" -o "$WEB/admin-desafios.html"
chmod 0644 "$WEB/admin-desafios.html"

# Garante API de logos (dependência do visual)
if [[ -f /opt/arbishield/arbishield-prelive-events.mjs ]] || [[ -f "${ARBISHIELD_SCRIPTS:-/opt/arbishield}/arbishield-prelive-events.mjs" ]]; then
  SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield}"
  if grep -q 'searchFootballTeams' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" 2>/dev/null; then
    log "API football-teams já presente no prelive"
  else
    log "Atualizando prelive para football-teams"
    curl -fsSL "$RAW/scripts/arbishield-prelive-events.mjs" -o "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
    chmod 0755 "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
    systemctl restart arbishield-prelive-events.service 2>/dev/null || true
  fi
fi

echo
echo "OK — Desafios disponíveis com visual do mockup"
echo "  https://arbishield.app/app-desafio.html  (Ctrl+F5)"
