#!/usr/bin/env bash
# Desafio: painel Apostar/Entrar com (Maior retorno) + ocultar finalizados
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-desafio-ocultar-finalizados.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-PLACEHOLDER_SHA}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT" "$SHIM_DIR"

dl() {
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$RAW/$1?v=$BUST" -o "$2"
}

log "1/3 UI — Apostar/Entrar com + retorno = lucro alvo do admin"
for f in app-desafio.html v2.css desafio-ciclo-math.js; do
  dl "deploy/vps-supabase/static/v2/$f" "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
done
grep -q 'data-apostar' "$WEB/app-desafio.html" || die "app-desafio sem botão Apostar na ArbiShield"
grep -q 'data-stake-input' "$WEB/app-desafio.html" || die "app-desafio sem campo Entrar com"
grep -q 'Maior retorno' "$WEB/app-desafio.html" || die "app-desafio sem badge Maior retorno"
grep -q 'stepIsFinished' "$WEB/app-desafio.html" || die "app-desafio sem filtro finalizados"
grep -q 'saldo usável da carteira Desafio' "$WEB/app-desafio.html" || die "app-desafio sem MAX = saldo Desafio"
grep -q 'fmtTargetProfitPct' "$WEB/app-desafio.html" || die "app-desafio sem retorno = lucro alvo"
if grep -q 'app-desafio-lead' "$WEB/app-desafio.html"; then
  die "app-desafio ainda tem texto lead"
fi
grep -q 'dz-sb-input' "$WEB/v2.css" || die "v2.css sem estilos dz-sb-input"
grep -q 'calcCasaStakeFromZebra' "$WEB/desafio-ciclo-math.js" || die "desafio-ciclo-math ausente"

log "2/3 Shim — desativa desafio quando todas as etapas encerram"
dl "scripts/arbishield-serverfn-shim.mjs" "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
grep -q 'desafioDeactivated' "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  || die "shim sem desativação pós-settle"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

# bust nginx cache if any
find "$WEB_ROOT" "$WEB" -name 'app-desafio.html' -o -name 'v2.css' 2>/dev/null | head -10 || true

log "OK — layout Apostar/Entrar com no ar"
log "Abra /app-desafio.html?v=$BUST (hard refresh / aba anônima)"
