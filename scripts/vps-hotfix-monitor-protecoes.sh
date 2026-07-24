#!/usr/bin/env bash
# Hotfix: Monitor de Proteções com nome do usuário + encerrar/estornar + filtros.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/arbishield-v2-backup-723d/scripts/vps-hotfix-monitor-protecoes.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/arbishield-v2-backup-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB"

log "UI Monitor de Proteções"
for f in admin-monitoring-protections.html v2.css v2-shell.js; do
  curl -fsSL "$RAW/deploy/vps-supabase/static/v2/$f" -o "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
  echo "  ok $f"
done

log "Shim (protection-close / protection-cancel)"
if [[ -d "$SHIM_DIR" ]]; then
  curl -fsSL "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
  chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
  systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
  echo "  ok shim"
fi

# nginx: adiciona protection-close/cancel se faltar
for conf in \
  /etc/nginx/conf.d/arbishield-cutover.conf \
  /etc/nginx/conf.d/arbishield.app.conf \
  /etc/nginx/sites-enabled/arbishield.app \
  /etc/nginx/sites-enabled/arbishield
do
  [[ -f "$conf" ]] || continue
  if grep -q 'protection-close' "$conf"; then
    echo "  nginx já ok $conf"
    continue
  fi
  if grep -q 'desafio-settle' "$conf"; then
    sed -i 's/affiliate-withdraw)/affiliate-withdraw|protection-close|protection-cancel)/' "$conf" || true
    echo "  nginx patched $conf"
  fi
done

if command -v nginx >/dev/null 2>&1; then
  nginx -t && systemctl reload nginx || true
fi

grep -q 'Quem entrou\|protection-close\|Ver detalhes' "$WEB/admin-monitoring-protections.html" || die "HTML inválido"

echo
echo "OK — Monitor de Proteções"
echo "  https://arbishield.app/admin-monitoring-protections.html"
echo "  Abas: Em aberto / Pendentes / Ao vivo / Agendado / Encerrado / Canceladas"
echo "  Em Ver detalhes: Encerrar (sem estorno) e Cancelar e estornar"
