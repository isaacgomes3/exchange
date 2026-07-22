#!/usr/bin/env bash
# ADM Monitor Proteções — mostra campo Mercado nos detalhes
set -euo pipefail
BRANCH="${ARBISHIELD_BRANCH:-cursor/admin-protecoes-mercado-723d}"
REF="${ARBISHIELD_REF:-$BRANCH}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
mkdir -p "$WEB"

echo "==> admin-monitoring-protections.html (campo Mercado)"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/static/v2/admin-monitoring-protections.html" \
  -o "$WEB/admin-monitoring-protections.html"
chmod 0644 "$WEB/admin-monitoring-protections.html"
grep -q 'mon-market-val' "$WEB/admin-monitoring-protections.html" \
  || { echo "ERRO: HTML sem Mercado"; exit 1; }
cp -f "$WEB/admin-monitoring-protections.html" \
  "$WEB_ROOT/admin-monitoring-protections.html" 2>/dev/null || true
echo "OK — Ctrl+F5 em /v2/admin-monitoring-protections.html"
