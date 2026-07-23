#!/usr/bin/env bash
# Deploy ciclo Desafio / Painel de Sinais + Mapa de Jornada
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-desafio-ciclo-sinais.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-1fe0373}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT" "$SHIM_DIR" "$SCRIPTS_DIR"

dl() {
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$RAW/$1?v=$BUST" -o "$2"
}

log "1/3 Backend shim + prelive (ciclo + jornada)"
SHIM_DST="$SHIM_DIR/arbishield-serverfn-shim.mjs"
dl "scripts/arbishield-serverfn-shim.mjs" "$SHIM_DST"
chmod 0644 "$SHIM_DST"
grep -q 'desafio-ciclo-sinais-v1\|calcZebraOddFromFavorite\|previewDesafioSinal' "$SHIM_DST" \
  || die "shim sem ciclo sinais"
grep -q 'getDesafioJornada\|desafio-jornada-v1' "$SHIM_DST" || die "shim sem jornada"

PRELIVE_DST="$SCRIPTS_DIR/arbishield-prelive-events.mjs"
[[ -f /opt/arbishield/scripts/arbishield-prelive-events.mjs ]] && \
  PRELIVE_DST="/opt/arbishield/scripts/arbishield-prelive-events.mjs"
dl "scripts/arbishield-prelive-events.mjs" "$PRELIVE_DST"
chmod 0755 "$PRELIVE_DST"
grep -q 'calcZebraOddFromFavorite' "$PRELIVE_DST" || die "prelive sem auto odd zebra"

systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
systemctl restart arbishield-prelive-events.service 2>/dev/null || \
  systemctl restart arbishield-prelive.service 2>/dev/null || true

log "2/3 UI — admin + lista principal + mapa jornada"
for f in admin-desafios.html app-desafio.html app-desafio-jornada.html app-desafio-lista.html app-desafio-sinais.html desafio-ciclo-math.js v2-shell.js; do
  dl "deploy/vps-supabase/static/v2/$f" "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
done
grep -q 'Odd do Favorito\|js-casa-odd' "$WEB/admin-desafios.html" || die "admin sem fluxo favorito"
grep -q 'Desafios disponíveis\|Iniciar desafio\|app-desafio-grid' "$WEB/app-desafio.html" \
  || die "app-desafio.html deve ser a lista de desafios"
grep -q 'j-map\|Mapa do desafio' "$WEB/app-desafio-jornada.html" || die "jornada ausente"
grep -qi 'app-desafio-jornada.html' "$WEB/app-desafio.html" || die "lista deve abrir a jornada"

log "3/3 Nginx — desafio-jornada → :3101"
for conf in /etc/nginx/sites-enabled/arbishield.app \
  /etc/nginx/conf.d/arbishield.app.conf \
  /etc/nginx/sites-available/arbishield.app; do
  [[ -f "$conf" ]] || continue
  if grep -q 'desafio-register|desafio-settle' "$conf"; then
    if ! grep -q 'desafio-sinal' "$conf"; then
      sed -i 's/desafio-register|desafio-settle|desafio-participations/desafio-register|desafio-settle|desafio-sinal|desafio-sinal-preview|desafio-participations/g' "$conf" || true
    fi
    if ! grep -q 'desafio-jornada' "$conf"; then
      sed -i 's/desafio-sinal-preview|desafio-participations/desafio-sinal-preview|desafio-jornada|desafio-journey|desafio-participations/g' "$conf" || true
    fi
    if grep -q 'location = /app/desafio/jornada' "$conf"; then
      sed -i 's|location = /app/desafio/jornada { return 302 /app-desafio.html; }|location = /app/desafio/jornada { return 302 /app-desafio-jornada.html; }|g' "$conf" || true
    fi
    if grep -q 'location = /app/desafio/lista' "$conf"; then
      sed -i 's|location = /app/desafio/lista { return 302 /app-desafio-lista.html; }|location = /app/desafio/lista { return 302 /app-desafio.html; }|g' "$conf" || true
    fi
    echo "checked $conf"
  fi
done
if command -v nginx >/dev/null && nginx -t 2>/dev/null; then
  systemctl reload nginx 2>/dev/null || true
fi

echo
echo "OK — ciclo Desafio: lista principal + jornada ao clicar"
echo "  Admin:   https://arbishield.app/admin/desafios"
echo "  Lista:   https://arbishield.app/app-desafio.html"
echo "  Jornada: https://arbishield.app/app-desafio-jornada.html"
echo "  Ctrl+F5 nas telas do cliente"
