#!/usr/bin/env bash
# Hotfix: visual Desafios + lançamento 1 evento (etapa = falha do cliente)
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-visual-disponivel-6aef/scripts/vps-hotfix-desafio-visual.sh?v=4")
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

log "app-desafio.html (visual mockup + etapa pessoal)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/app-desafio.html" -o "$WEB/app-desafio.html"
chmod 0644 "$WEB/app-desafio.html"
grep -q 'dz-v2-compare' "$WEB/app-desafio.html" || die "HTML sem dz-v2-compare"
grep -q 'dz-wallet-bar' "$WEB/app-desafio.html" || die "HTML sem dz-wallet-bar"
grep -q 'Depositar Desafio' "$WEB/app-desafio.html" || die "HTML sem Depositar Desafio"
grep -q 'Maior retorno' "$WEB/app-desafio.html" || die "HTML sem Maior retorno"
grep -q 'resolveTeamLogo' "$WEB/app-desafio.html" || die "HTML sem resolveTeamLogo"
grep -q 'searchFootballTeams' "$WEB/app-desafio.html" || die "HTML sem searchFootballTeams"
grep -q 'personalProgress' "$WEB/app-desafio.html" || die "HTML sem personalProgress (etapa = falha do cliente)"

log "v2.js (busca de times + fallback TheSportsDB)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/v2.js" -o "$WEB/v2.js"
chmod 0644 "$WEB/v2.js"
cp -f "$WEB/v2.js" "$WEB_ROOT/v2.js" 2>/dev/null || true
grep -q 'thesportsdb.com' "$WEB/v2.js" || die "v2.js sem fallback TheSportsDB"

log "v2.css (barra preta + borda limão)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/v2.css" -o "$WEB/v2.css"
chmod 0644 "$WEB/v2.css"
# Espelha também na raiz caso o nginx sirva /v2.css de outro path
cp -f "$WEB/v2.css" "$WEB_ROOT/v2.css" 2>/dev/null || true
grep -q 'dz-v2-panel' "$WEB/v2.css" || die "CSS sem dz-v2-panel"
grep -q 'dz-wallet-bar' "$WEB/v2.css" || die "CSS sem dz-wallet-bar"
grep -q 'background: #000' "$WEB/v2.css" || die "CSS sem background preto da barra"
grep -q 'border: 1.5px solid #c9f223' "$WEB/v2.css" || die "CSS sem borda limão da barra"

grep -q 'dz-wallet-black' "$WEB/app-desafio.html" || die "HTML sem cache-bust da barra"
grep -q 'background: #000 !important' "$WEB/app-desafio.html" || die "HTML sem estilo inline preto"

log "admin-desafios.html (1 evento no lançamento; sem Adicionar Etapa)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/admin-desafios.html" -o "$WEB/admin-desafios.html"
chmod 0644 "$WEB/admin-desafios.html"
grep -q 'Sugestão de Desafio' "$WEB/admin-desafios.html" && die "botão Sugestão de Desafio ainda presente"
grep -q 'Adicionar Etapa' "$WEB/admin-desafios.html" && die "botão Adicionar Etapa ainda presente"
grep -q 'admin-desafio-lancar.html' "$WEB/admin-desafios.html" || die "admin sem link para página de lançamento"

log "admin-desafio-lancar.html (página dedicada)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/admin-desafio-lancar.html" -o "$WEB/admin-desafio-lancar.html"
chmod 0644 "$WEB/admin-desafio-lancar.html"
grep -q 'fCircuitMax' "$WEB/admin-desafio-lancar.html" || die "página de lançamento sem Máx. etapas"
grep -q 'Adicionar Etapa' "$WEB/admin-desafio-lancar.html" && die "página de lançamento ainda tem Adicionar Etapa"

log "v2-shell.js (menu ativo em Lançar Desafio)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/v2-shell.js" -o "$WEB/v2-shell.js"
chmod 0644 "$WEB/v2-shell.js"
cp -f "$WEB/v2-shell.js" "$WEB_ROOT/v2-shell.js" 2>/dev/null || true
grep -q 'admin-desafio-lancar' "$WEB/v2-shell.js" || die "shell sem rota admin-desafio-lancar"

# Sempre atualiza prelive (createDesafio = 1 step + appendDesafioGame)
if [[ -f /opt/arbishield/arbishield-prelive-events.mjs ]] || [[ -f "${ARBISHIELD_SCRIPTS:-/opt/arbishield}/arbishield-prelive-events.mjs" ]]; then
  SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield}"
  log "Atualizando prelive (1 evento no create + append próximo jogo)"
  curl -fsSL "$RAW/scripts/arbishield-prelive-events.mjs" -o "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
  chmod 0755 "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
  grep -q 'appendDesafioGame' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" || die "prelive sem appendDesafioGame"
  systemctl restart arbishield-prelive-events.service 2>/dev/null || true
fi

echo
echo "OK — Lançar Desafio = 1 evento; etapa 2+ = falha do cliente na casa"
echo "  https://arbishield.app/app-desafio.html  (Ctrl+F5)"
echo "  https://arbishield.app/admin-desafios.html  (Ctrl+F5)"
