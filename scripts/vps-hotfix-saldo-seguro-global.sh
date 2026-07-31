#!/usr/bin/env bash
# Protege TODAS as contas contra re-crédito no F5 / listagem.
#
# 1) Remove auto-estorno do contest_list
# 2) Estorno idempotente (claim + wallet check) no prelive + shim
# 3) Auditoria global de overcredit
#
# Na VPS (root) — SEM vírgula antes do bash:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-saldo-inconsistente-refresh-723d/scripts/vps-hotfix-saldo-seguro-global.sh?v=1")
#
# Depois (recomendado):
#   node /opt/arbishield/scripts/vps-audit-fix-overcredit-all.mjs
#   FIX=1 HEAL_CANCEL=1 node /opt/arbishield/scripts/vps-audit-fix-overcredit-all.mjs
set -euo pipefail
BRANCH="${ARBISHIELD_BRANCH:-cursor/fix-saldo-inconsistente-refresh-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
mkdir -p "$SHIM_DIR" "$SCRIPTS_DIR" "$WEB"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }

write_unit_path() {
  local unit="$1" file="$2" pattern="$3"
  if ! systemctl cat "$unit" >/dev/null 2>&1; then return 0; fi
  local exec
  exec="$(systemctl show -p ExecStart --value "$unit" 2>/dev/null | head -1 || true)"
  echo "  $unit ExecStart=$exec"
  if [[ "$exec" =~ $pattern ]]; then
    cp -f "$file" "${BASH_REMATCH[1]}"
    echo "  wrote ${BASH_REMATCH[1]}"
  fi
}

log "1/4 — prelive: sem auto-estorno no contest_list + refund idempotente"
curl -fsSL "$RAW/scripts/arbishield-prelive-events.mjs" -o "$SHIM_DIR/arbishield-prelive-events.mjs"
chmod 0644 "$SHIM_DIR/arbishield-prelive-events.mjs"
cp -f "$SHIM_DIR/arbishield-prelive-events.mjs" "$SCRIPTS_DIR/arbishield-prelive-events.mjs" 2>/dev/null || true
grep -q 'claimProtectionCancelled' "$SHIM_DIR/arbishield-prelive-events.mjs" || die "prelive sem claim"
grep -q 'sem auto-estorno na listagem' "$SHIM_DIR/arbishield-prelive-events.mjs" || die "prelive sem trava de listagem"
# garantir que NÃO chama refundAndCancelProtection dentro do contest_list
if awk '/async function contestList/,/async function contestApprove/' "$SHIM_DIR/arbishield-prelive-events.mjs" | grep -q 'refundAndCancelProtection'; then
  die "contest_list ainda chama refundAndCancelProtection — abortando"
fi
write_unit_path arbishield-prelive-events.service "$SHIM_DIR/arbishield-prelive-events.mjs" '(/[^[:space:]]+arbishield-prelive-events\.mjs)'

log "2/4 — shim: cancelamento idempotente"
curl -fsSL "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
cp -f "$SHIM_DIR/arbishield-serverfn-shim.mjs" "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" 2>/dev/null || true
grep -q 'claimProtectionCancelled' "$SHIM_DIR/arbishield-serverfn-shim.mjs" || die "shim sem claim"
write_unit_path arbishield-serverfn-shim.service "$SHIM_DIR/arbishield-serverfn-shim.mjs" '(/[^[:space:]]+arbishield-serverfn-shim\.mjs)'

log "3/4 — scripts auditoria global + diag"
curl -fsSL "$RAW/scripts/vps-audit-fix-overcredit-all.mjs" -o "$SCRIPTS_DIR/vps-audit-fix-overcredit-all.mjs"
curl -fsSL "$RAW/scripts/vps-diagnose-user-balance.mjs" -o "$SCRIPTS_DIR/vps-diagnose-user-balance.mjs"
chmod 0644 "$SCRIPTS_DIR/vps-audit-fix-overcredit-all.mjs" "$SCRIPTS_DIR/vps-diagnose-user-balance.mjs"
grep -q 'Auditoria GLOBAL' "$SCRIPTS_DIR/vps-audit-fix-overcredit-all.mjs" || die "audit script antigo"

# UI header (chip) — best effort
if curl -fsSL "$RAW/deploy/vps-supabase/static/v2/v2-financeiro.js" -o "$WEB/v2-financeiro.js" 2>/dev/null; then
  chmod 0644 "$WEB/v2-financeiro.js"
  cp -f "$WEB/v2-financeiro.js" "$WEB_ROOT/v2-financeiro.js" 2>/dev/null || true
  echo "  ok v2-financeiro.js"
fi

log "4/4 — reiniciar serviços"
systemctl daemon-reload 2>/dev/null || true
systemctl restart arbishield-prelive-events.service 2>/dev/null || echo "AVISO: prelive não reiniciou"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || echo "AVISO: shim não reiniciou"
sleep 2
curl -sS "http://127.0.0.1:3098/health" 2>/dev/null | head -c 200 || true
echo
curl -sS "http://127.0.0.1:3101/health" 2>/dev/null | head -c 200 || true
echo

echo
echo "=========================================="
echo " PROTEÇÃO ATIVA — listagem não credita mais"
echo
echo " 1) Relatório todas as contas:"
echo "    node $SCRIPTS_DIR/vps-audit-fix-overcredit-all.mjs"
echo
echo " 2) Corrigir saldos inflados + fechar cancelamentos presos:"
echo "    FIX=1 HEAL_CANCEL=1 node $SCRIPTS_DIR/vps-audit-fix-overcredit-all.mjs"
echo
echo " 3) Uma conta:"
echo "    EMAIL=carloskku4@gmail.com node $SCRIPTS_DIR/vps-diagnose-user-balance.mjs"
echo "=========================================="
