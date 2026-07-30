#!/usr/bin/env bash
# Atalho: só reinicia prelive/shim e valida health v10.
# Use quando os arquivos já foram copiados mas o hotfix morreu antes do restart
# (ex.: cache raw.githubusercontent com script antigo toast-v6d).
#
#   bash <(curl -fsSL "https://cdn.jsdelivr.net/gh/isaacgomes3/exchange@cursor/protecao-v10-fonte-verdade-501d/scripts/vps-restart-stake-lock-v10.sh")
set -euo pipefail

die() { echo "ERRO: $*" >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || die "rode como root"

echo "==> restart stake_lock v10"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
systemctl restart arbishield-prelive-events.service 2>/dev/null || true
systemctl restart arbishield-prelive.service 2>/dev/null || true
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart arbishield-serverfn-shim 2>/dev/null || true
  pm2 restart arbishield-prelive-events 2>/dev/null || true
fi
if pgrep -af 'arbishield-prelive-events\.mjs' >/dev/null 2>&1; then
  pkill -f 'arbishield-prelive-events\.mjs' || true
  sleep 1
  systemctl start arbishield-prelive-events.service 2>/dev/null || \
    systemctl start arbishield-prelive.service 2>/dev/null || true
fi
if pgrep -af 'arbishield-serverfn-shim\.mjs' >/dev/null 2>&1; then
  pkill -f 'arbishield-serverfn-shim\.mjs' || true
  sleep 1
  systemctl start arbishield-serverfn-shim.service 2>/dev/null || true
fi

sleep 2
H3098="$(curl -fsS --max-time 8 http://127.0.0.1:3098/health || true)"
H3101="$(curl -fsS --max-time 8 http://127.0.0.1:3101/health || true)"
echo "health :3098 → $H3098"
echo "health :3101 → $H3101"

echo "$H3098" | grep -q 'protection-runtime-stake-lock-v10' \
  || die "health :3098 sem protection-runtime-stake-lock-v10 — rode o hotfix completo via jsDelivr"
echo "$H3098" | grep -q 'stake_lock_v1' || die "health :3098 sem stake_lock_v1"
echo "$H3098" | grep -q 'protection-flow-contract-v10' || die "health :3098 sem contract-v10"
echo "$H3098" | grep -q 'protection-flow-contract-v1"' && die "ainda no processo v1" || true

echo "OK — runtime reiniciado sob stake_lock_v10"
echo "Validar: bash <(curl -fsSL \"https://cdn.jsdelivr.net/gh/isaacgomes3/exchange@cursor/protecao-v10-fonte-verdade-501d/scripts/vps-check-pos-deploy-v10.sh\")"
