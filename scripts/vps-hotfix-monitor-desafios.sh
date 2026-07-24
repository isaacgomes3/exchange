#!/usr/bin/env bash
# Admin: Monitor de Desafios (Operação) — clientes, valores e etapa.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-monitor-desafios.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-PLACEHOLDER_SHA}"
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

log "1/3 UI — admin-monitoring-desafios.html"
dl "deploy/vps-supabase/static/v2/admin-monitoring-desafios.html" "$WEB/admin-monitoring-desafios.html"
chmod 0644 "$WEB/admin-monitoring-desafios.html"
cp -f "$WEB/admin-monitoring-desafios.html" "$WEB_ROOT/admin-monitoring-desafios.html" 2>/dev/null || true
grep -q 'Monitor de Desafios' "$WEB/admin-monitoring-desafios.html" || die "página sem título"
grep -q 'desafio_participations' "$WEB/admin-monitoring-desafios.html" || die "página sem query participations"
grep -q 'Etapa' "$WEB/admin-monitoring-desafios.html" || die "página sem coluna Etapa"

log "2/3 UI — v2-shell.js (item no menu Operação)"
dl "deploy/vps-supabase/static/v2/v2-shell.js" "$WEB/v2-shell.js"
chmod 0644 "$WEB/v2-shell.js"
cp -f "$WEB/v2-shell.js" "$WEB_ROOT/v2-shell.js" 2>/dev/null || true
grep -q 'monitoring-desafios' "$WEB/v2-shell.js" || die "shell sem Monitor de Desafios"
grep -q 'admin-monitoring-desafios.html' "$WEB/v2-shell.js" || die "shell sem href"

log "3/3 nginx redirect (se conf existir)"
CONF=""
for c in \
  /etc/nginx/conf.d/arbishield-cutover.conf \
  /etc/nginx/conf.d/arbishield.app.conf \
  /etc/nginx/sites-enabled/arbishield.app \
  /etc/nginx/sites-available/arbishield.app
do
  [[ -f "$c" ]] && CONF="$c" && break
done
if [[ -n "$CONF" ]]; then
  if ! grep -q 'monitoring-desafios' "$CONF"; then
    if grep -q 'monitoring-protections' "$CONF"; then
      sed -i '/monitoring-protections/a\    location = /admin/monitoring-desafios { return 302 /admin-monitoring-desafios.html; }' "$CONF"
      nginx -t && systemctl reload nginx || true
      echo "  ok nginx patch $CONF"
    else
      echo "  aviso: conf sem monitoring-protections — redirect manual se precisar"
    fi
  else
    echo "  nginx já tem monitoring-desafios"
  fi
else
  echo "  aviso: conf nginx não encontrada (página .html funciona direto)"
fi

log "OK — Ctrl+F5 no admin. Menu Operação → Monitor de Desafios."
echo "  Teste: https://arbishield.app/admin-monitoring-desafios.html"
