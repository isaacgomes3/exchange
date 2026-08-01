#!/usr/bin/env bash
# Hotfix: Encerrar partida falhava com
#   null value in column "admin_id" of relation "match_change_logs"
# Causa: settle PATCH sem updated_by + status_v2="settled" inválido na VPS.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-proteger-js-e85c/scripts/vps-hotfix-encerrar-admin-id.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield}"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"

echo "==> vps-hotfix-encerrar-admin-id.sh ($(date -Is))"

curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/arbishield-prelive-events.mjs" -o "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
chmod 0755 "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
grep -q 'updated_by: adminId' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" || {
  echo "ERRO: prelive sem updated_by no settle"
  exit 1
}
grep -q 'status_v2: "closed"' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" || {
  echo "ERRO: prelive sem status_v2 closed"
  exit 1
}

curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
grep -q 'updated_by: adminId' "$SHIM_DIR/arbishield-serverfn-shim.mjs" || {
  echo "ERRO: shim sem updated_by no settle"
  exit 1
}

systemctl restart arbishield-prelive-events.service 2>/dev/null || true
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
# sandbox worker se existir
systemctl restart arbishield-prelive-events-teste.service 2>/dev/null || true
systemctl restart arbishield-serverfn-shim-teste.service 2>/dev/null || true

sleep 1
echo "OK — Encerrar partida com updated_by/admin_id"
echo "  Teste de novo em Admin → Gestão de Jogos → Encerrar partida"
