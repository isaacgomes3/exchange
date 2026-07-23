#!/usr/bin/env bash
# Desafio: lista de eventos = tela principal; jornada ao clicar no evento
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-desafio-jornada-visivel.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-05f716d}"
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
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield}"
PRELIVE_DST="$SCRIPTS_DIR/arbishield-prelive-events.mjs"
[[ -f /opt/arbishield/scripts/arbishield-prelive-events.mjs ]] && \
  PRELIVE_DST="/opt/arbishield/scripts/arbishield-prelive-events.mjs"
dl "scripts/arbishield-prelive-events.mjs" "$PRELIVE_DST"
chmod 0755 "$PRELIVE_DST"
systemctl restart arbishield-prelive-events.service 2>/dev/null || \
  systemctl restart arbishield-prelive.service 2>/dev/null || true

log "2/4 UI — lista = /app-desafio.html; jornada = /app-desafio-jornada.html"
for f in app-desafio.html app-desafio-jornada.html app-desafio-lista.html app-desafio-sinais.html admin-desafios.html admin-manual-deposits.html desafio-ciclo-math.js v2-shell.js v2-deposit.js v2.css; do
  dl "deploy/vps-supabase/static/v2/$f" "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
done

# Principal = lista de eventos disponíveis
grep -q 'Desafios disponíveis\|app-desafio-grid\|Iniciar desafio\|dz-card' \
  "$WEB/app-desafio.html" \
  || die "app-desafio.html deve ser a lista de desafios"
! grep -q 'j-map\|aria-label="Mapa do desafio"' "$WEB/app-desafio.html" \
  || die "app-desafio.html ainda é o mapa (deveria ser a lista)"
! grep -q 'Jogos liberados\|kAvail\|app-kpi-row' "$WEB/app-desafio.html" \
  || die "app-desafio ainda tem KPIs antigos"
grep -q 'dz-access\|data-deposit-dest="desafio"' "$WEB/app-desafio.html" \
  || die "app-desafio sem barra de acesso/saldo/PIX"
grep -q 'dz-access' "$WEB/v2.css" || die "v2.css sem estilos dz-access"
# Jornada = mapa ao clicar no evento
grep -q 'j-map\|Mapa do desafio\|aria-label="Mapa do desafio"' \
  "$WEB/app-desafio-jornada.html" \
  || die "app-desafio-jornada.html sem mapa de jornada"
grep -q 'fActive' "$WEB/admin-desafios.html" || die "admin-desafios ausente"
grep -q 'async function load()' "$WEB/admin-desafios.html" || die "admin-desafios sem load()"
! grep -q 'is_active: true,\s*$("list")' "$WEB/admin-desafios.html" || die "admin-desafios ainda com JS corrompido"
! grep -qi 'Abrir painel de sinais' "$WEB/app-desafio.html" || die "lista ainda tem botão de sinais"
! grep -qi 'Abrir painel de sinais' "$WEB/app-desafio-jornada.html" || die "jornada ainda tem botão de sinais"
grep -qi 'Iniciar desafio' "$WEB/app-desafio.html" || die "lista sem CTA Iniciar desafio → jornada"
grep -qi 'app-desafio-jornada.html' "$WEB/app-desafio.html" || die "lista não aponta para jornada"
grep -qi 'location.replace.*/app-desafio.html' "$WEB/app-desafio-lista.html" \
  || grep -qi 'url=/app-desafio.html' "$WEB/app-desafio-lista.html" \
  || die "app-desafio-lista.html deve redirecionar para a lista principal"
grep -qi 'location.replace.*/app-desafio.html' "$WEB/app-desafio-sinais.html" \
  || grep -qi 'url=/app-desafio.html' "$WEB/app-desafio-sinais.html" \
  || die "app-desafio-sinais.html deve redirecionar para a lista"

log "3/4 Backend shim (register/settle + crédito depósito Desafio)"
dl "scripts/arbishield-serverfn-shim.mjs" "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
grep -q 'registerDesafioEntry\|desafio-register' "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  || die "shim sem register desafio"
grep -q 'desafio_balance_cents' "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  || die "shim sem crédito desafio_balance"
grep -q 'isDesafio\|dtype === "desafio"' "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  || die "shim não credita depósito tipo desafio"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

log "4/4 Nginx — /app/desafio → lista; /jornada → mapa"
for conf in /etc/nginx/sites-enabled/arbishield.app \
  /etc/nginx/conf.d/arbishield.app.conf \
  /etc/nginx/sites-available/arbishield.app; do
  [[ -f "$conf" ]] || continue
  if grep -q 'location = /app/desafio/jornada' "$conf"; then
    sed -i 's|location = /app/desafio/jornada { return 302 /app-desafio.html; }|location = /app/desafio/jornada { return 302 /app-desafio-jornada.html; }|g' "$conf" || true
  fi
  if grep -q 'location = /app/desafio/lista' "$conf"; then
    sed -i 's|location = /app/desafio/lista { return 302 /app-desafio-lista.html; }|location = /app/desafio/lista { return 302 /app-desafio.html; }|g' "$conf" || true
  fi
  if grep -q 'location = /app/desafio/sinais' "$conf"; then
    sed -i 's|location = /app/desafio/sinais { return 302 /app-desafio-sinais.html; }|location = /app/desafio/sinais { return 302 /app-desafio.html; }|g' "$conf" || true
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

find "$WEB" "$WEB_ROOT" -maxdepth 1 -name 'app-desafio*.html' -exec touch {} \; 2>/dev/null || true

echo
echo "OK — Desafio: lista principal + jornada ao clicar no evento"
echo "  Lista:    https://arbishield.app/app-desafio.html"
echo "  Jornada:  https://arbishield.app/app-desafio-jornada.html"
echo "  Ctrl+Shift+R (hard refresh)"
echo
head -c 200 "$WEB/app-desafio.html" | tr '\n' ' '; echo
