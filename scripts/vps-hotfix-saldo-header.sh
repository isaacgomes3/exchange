#!/usr/bin/env bash
# Alinha chip Apostador no refresh + script de diagnóstico de saldo.
#
# Na VPS (sem vírgula antes do bash):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-saldo-inconsistente-refresh-723d/scripts/vps-hotfix-saldo-header.sh?v=2")
set -euo pipefail
BRANCH="${ARBISHIELD_BRANCH:-cursor/fix-saldo-inconsistente-refresh-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
mkdir -p "$WEB" "$SCRIPTS_DIR"

echo "==> 1/3 UI v2-financeiro.js"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/v2-financeiro.js" -o "$WEB/v2-financeiro.js"
chmod 0644 "$WEB/v2-financeiro.js"
cp -f "$WEB/v2-financeiro.js" "$WEB_ROOT/v2-financeiro.js" 2>/dev/null || true
grep -q 'apostadorHeader' "$WEB/v2-financeiro.js" || { echo "ERRO: arquivo antigo"; exit 1; }

echo "==> 2/3 script diagnóstico"
curl -fsSL "$RAW/scripts/vps-diagnose-user-balance.mjs" -o "$SCRIPTS_DIR/vps-diagnose-user-balance.mjs"
chmod 0644 "$SCRIPTS_DIR/vps-diagnose-user-balance.mjs"
grep -q 'metadata' "$SCRIPTS_DIR/vps-diagnose-user-balance.mjs" || echo "AVISO: diag sem metadata"

echo "==> 3/3 shim (metadata em wallet_transactions)"
curl -fsSL "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
cp -f "$SHIM_DIR/arbishield-serverfn-shim.mjs" "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" 2>/dev/null || true
for u in arbishield-serverfn-shim.service; do
  if systemctl cat "$u" >/dev/null 2>&1; then
    exec="$(systemctl show -p ExecStart --value "$u" 2>/dev/null | head -1 || true)"
    if [[ "$exec" =~ (/[^[:space:]]+arbishield-serverfn-shim\.mjs) ]]; then
      cp -f "$SHIM_DIR/arbishield-serverfn-shim.mjs" "${BASH_REMATCH[1]}"
      echo "  wrote ${BASH_REMATCH[1]}"
    fi
  fi
done
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

echo
echo "OK — Ctrl+Shift+R em https://arbishield.app/app-carteira.html"
echo "Diagnóstico Carlos:"
echo "  EMAIL=carloskku4@gmail.com node $SCRIPTS_DIR/vps-diagnose-user-balance.mjs"
