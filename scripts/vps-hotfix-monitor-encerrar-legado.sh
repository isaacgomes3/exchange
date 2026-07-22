#!/usr/bin/env bash
# Hotfix: Monitor proteções — Encerrar sem estorno como no site antigo
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/b55753a/scripts/vps-hotfix-monitor-encerrar-legado.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-b55753a}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
mkdir -p "$WEB"

echo "==> admin-monitoring-protections.html (legado: aviso forte + botão secundário)"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/static/v2/admin-monitoring-protections.html?v=$BUST" \
  -o "$WEB/admin-monitoring-protections.html"
chmod 0644 "$WEB/admin-monitoring-protections.html"
cp -f "$WEB/admin-monitoring-protections.html" \
  "$WEB_ROOT/admin-monitoring-protections.html" 2>/dev/null || true

grep -q 'Use APENAS quando o saldo já foi reconciliado' "$WEB/admin-monitoring-protections.html" \
  || { echo "ERRO: HTML sem prompt do legado"; exit 1; }
grep -q 'Cancelar e estornar' "$WEB/admin-monitoring-protections.html" \
  || { echo "ERRO: HTML sem Cancelar e estornar"; exit 1; }
grep -q 'Admin → Jogos' "$WEB/admin-monitoring-protections.html" \
  || { echo "ERRO: HTML sem aviso Admin Jogos"; exit 1; }

echo "OK — Ctrl+F5 em /v2/admin-monitoring-protections.html"
