#!/usr/bin/env bash
# Alinha chip Apostador no refresh (inclui demo como no shell/legado).
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-saldo-inconsistente-refresh-723d/scripts/vps-hotfix-saldo-header.sh?v=1")
set -euo pipefail
BRANCH="${ARBISHIELD_BRANCH:-cursor/fix-saldo-inconsistente-refresh-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
mkdir -p "$WEB"
echo "==> Atualizando v2-financeiro.js"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/v2-financeiro.js" -o "$WEB/v2-financeiro.js"
chmod 0644 "$WEB/v2-financeiro.js"
cp -f "$WEB/v2-financeiro.js" "$WEB_ROOT/v2-financeiro.js" 2>/dev/null || true
grep -q 'apostadorHeader' "$WEB/v2-financeiro.js" || { echo "ERRO: arquivo antigo"; exit 1; }
grep -q 'demo_balance_cents' "$WEB/v2-financeiro.js" || { echo "ERRO: sem demo_balance_cents"; exit 1; }
echo "OK — hard refresh em https://arbishield.app/app-carteira.html"
echo "Diagnóstico conta:"
echo "  EMAIL=carloskku4@gmail.com node /opt/arbishield/scripts/vps-diagnose-user-balance.mjs"
