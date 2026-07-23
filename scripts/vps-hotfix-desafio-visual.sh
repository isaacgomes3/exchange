#!/usr/bin/env bash
# Hotfix: visual Desafios + lançamento 1 evento (etapa = falha do cliente)
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-visual-disponivel-6aef/scripts/vps-hotfix-desafio-visual.sh?v=10")
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
grep -q 'Saldo inicial' "$WEB/admin-desafios.html" && die "admin ainda mostra Saldo inicial (saldo é da carteira Desafio)"

log "admin-desafio-lancar.html (página dedicada — sem número/título/saldo/etapas manuais)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/admin-desafio-lancar.html" -o "$WEB/admin-desafio-lancar.html"
chmod 0644 "$WEB/admin-desafio-lancar.html"
if grep -Eq 'fCircuitMax|id="fNumber"|id="fTitle"|id="fSubtitle"|id="fBalance"|Saldo inicial ArbiShield|Máx\. etapas' "$WEB/admin-desafio-lancar.html"; then
  die "página de lançamento ainda tem campos manuais removidos"
fi
grep -q 'Adicionar Etapa' "$WEB/admin-desafio-lancar.html" && die "página de lançamento ainda tem Adicionar Etapa"
grep -q 'defaultEventTitle' "$WEB/admin-desafio-lancar.html" || die "página sem título automático do evento"
grep -q 'DEFAULT_CIRCUIT_STEPS' "$WEB/admin-desafio-lancar.html" || die "página sem etapas padrão do circuito"
grep -q 'casaSuggest' "$WEB/admin-desafio-lancar.html" || die "página sem busca na Entrada Casa Externa"
grep -q 'arbiSuggest' "$WEB/admin-desafio-lancar.html" || die "página sem busca na Entrada ArbiShield"
grep -q 'casaMarketSuggest' "$WEB/admin-desafio-lancar.html" || die "página sem busca de mercado (casa)"
grep -q 'arbiMarketSuggest' "$WEB/admin-desafio-lancar.html" || die "página sem busca de mercado (arbi)"
grep -q 'bindMarketPickers' "$WEB/admin-desafio-lancar.html" || die "página sem bindMarketPickers"
grep -q 'market-catalog.js' "$WEB/admin-desafio-lancar.html" || die "página sem market-catalog.js"
grep -q 'fProfitPct' "$WEB/admin-desafio-lancar.html" || die "página sem lucro líquido do evento"
grep -q 'calcArbiOddFromCasa' "$WEB/admin-desafio-lancar.html" || die "página sem cálculo automático da odd ArbiShield"
grep -q 'max-width: none !important' "$WEB/admin-desafio-lancar.html" || die "página ainda centralizada (sem full-bleed)"
grep -q '720px' "$WEB/admin-desafio-lancar.html" && die "página ainda tem max-width 720px"

log "market-catalog.js (autocomplete de mercados)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/market-catalog.js" -o "$WEB/market-catalog.js"
chmod 0644 "$WEB/market-catalog.js"
cp -f "$WEB/market-catalog.js" "$WEB_ROOT/market-catalog.js" 2>/dev/null || true
grep -q 'ArbiMarketCatalog' "$WEB/market-catalog.js" || die "market-catalog sem ArbiMarketCatalog"
grep -q 'Menos 2.5 gols na partida' "$WEB/market-catalog.js" || die "market-catalog sem Menos 2.5"

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
fi

log "OK — hotfix desafio visual aplicado (v10: busca de mercado no lançamento)"
echo "Reinicie o serviço prelive se o script foi atualizado, e faça Ctrl+F5 no browser."
