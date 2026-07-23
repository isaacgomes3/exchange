#!/usr/bin/env bash
# Força o Mapa de Jornada como tela principal do Desafio
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-desafio-jornada-visivel.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-3d516a8}"
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

log "1/4 Backend prelive (publicar desafio)"
PRELIVE_DST="/opt/arbishield/scripts/arbishield-prelive-events.mjs"
[[ -f "$PRELIVE_DST" ]] || PRELIVE_DST="/opt/arbishield/arbishield-prelive-events.mjs"
[[ -f "$SCRIPTS_DIR/arbishield-prelive-events.mjs" ]] && PRELIVE_DST="$SCRIPTS_DIR/arbishield-prelive-events.mjs" || true
# SCRIPTS_DIR may not exist in this script - use SHIM_DIR parent
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield}"
PRELIVE_DST="$SCRIPTS_DIR/arbishield-prelive-events.mjs"
[[ -f /opt/arbishield/scripts/arbishield-prelive-events.mjs ]] && PRELIVE_DST="/opt/arbishield/scripts/arbishield-prelive-events.mjs"
dl "scripts/arbishield-prelive-events.mjs" "$PRELIVE_DST"
chmod 0755 "$PRELIVE_DST"
systemctl restart arbishield-prelive-events.service 2>/dev/null || systemctl restart arbishield-prelive.service 2>/dev/null || true

log "2/4 UI — jornada como /app-desafio.html"
for f in app-desafio.html app-desafio-jornada.html app-desafio-lista.html app-desafio-sinais.html admin-desafios.html desafio-ciclo-math.js v2-shell.js; do
  dl "deploy/vps-supabase/static/v2/$f" "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
done

# Garante que a página principal É o mapa (não a lista antiga)
grep -q 'j-map\|Mapa de campanha\|jornada-v1\|Painel de Sinais &amp; Arbitragem\|aria-label="Mapa do desafio"' \
  "$WEB/app-desafio.html" \
  || grep -q 'j-map\|Mapa do desafio' "$WEB/app-desafio.html" \
  || die "app-desafio.html ainda não é o mapa de jornada"
grep -q 'j-map\|Mapa do desafio' "$WEB/app-desafio.html" || die "falha: app-desafio sem j-map"
grep -q 'buildManualSinalState\|evento do Desafio\|fetchDesafios' "$WEB/app-desafio-sinais.html" \
  || die "sinais ainda depende de API antiga"
grep -q 'fActive' "$WEB/admin-desafios.html" || die "admin-desafios ausente"

log "3/4 Backend jornada API"
dl "scripts/arbishield-serverfn-shim.mjs" "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
grep -q 'getDesafioJornada\|desafio-jornada' "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  || die "shim sem getDesafioJornada"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

log "4/4 Nginx — /app/desafio → mapa + API jornada"
for conf in /etc/nginx/sites-enabled/arbishield.app \
  /etc/nginx/conf.d/arbishield.app.conf \
  /etc/nginx/sites-available/arbishield.app; do
  [[ -f "$conf" ]] || continue
  # Garante redirect do SPA antigo
  if grep -q 'location = /app/desafio' "$conf"; then
    sed -i 's|location = /app/desafio { return 302 /app-desafio.html; }|location = /app/desafio { return 302 /app-desafio.html; }|g' "$conf" || true
  fi
  if grep -q 'desafio-register|desafio-settle' "$conf" && ! grep -q 'desafio-jornada' "$conf"; then
    sed -i 's/desafio-sinal-preview|desafio-participations/desafio-sinal-preview|desafio-jornada|desafio-journey|desafio-participations/g' "$conf" || true
    if ! grep -q 'desafio-sinal' "$conf"; then
      sed -i 's/desafio-register|desafio-settle|desafio-participations/desafio-register|desafio-settle|desafio-sinal|desafio-sinal-preview|desafio-jornada|desafio-journey|desafio-participations/g' "$conf" || true
    fi
  fi
  echo "checked $conf"
done
if command -v nginx >/dev/null && nginx -t 2>/dev/null; then
  systemctl reload nginx 2>/dev/null || true
fi

# Bust cache de HTML se houver
find "$WEB" "$WEB_ROOT" -maxdepth 1 -name 'app-desafio*.html' -exec touch {} \; 2>/dev/null || true

echo
echo "OK — mapa de jornada é a tela principal do Desafio"
echo "  Abra: https://arbishield.app/app-desafio.html"
echo "  Ou:   https://arbishield.app/app/desafio"
echo "  Ctrl+Shift+R (hard refresh) se ainda ver a lista antiga"
echo
# sanity local
head -c 200 "$WEB/app-desafio.html" | tr '\n' ' '; echo
