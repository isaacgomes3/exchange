#!/usr/bin/env bash
# PARA o bug: F5 / contest_list re-credita estorno de cancelamento.
# Atualiza prelive + shim (estorno idempotente) + diagnóstico.
#
# Na VPS (root) — SEM vírgula antes do bash:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-saldo-inconsistente-refresh-723d/scripts/vps-hotfix-saldo-f5-overcredit.sh?v=1")
#
# Depois auditar/corrigir Carlos:
#   EMAIL=carloskku4@gmail.com node /opt/arbishield/scripts/vps-diagnose-user-balance.mjs
#   FIX_OVERCREDIT=1 EMAIL=carloskku4@gmail.com node /opt/arbishield/scripts/vps-diagnose-user-balance.mjs
set -euo pipefail
BRANCH="${ARBISHIELD_BRANCH:-cursor/fix-saldo-inconsistente-refresh-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
mkdir -p "$SHIM_DIR" "$SCRIPTS_DIR"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }

log "1/3 — prelive-events (refund idempotente)"
curl -fsSL "$RAW/scripts/arbishield-prelive-events.mjs" -o "$SHIM_DIR/arbishield-prelive-events.mjs"
chmod 0644 "$SHIM_DIR/arbishield-prelive-events.mjs"
cp -f "$SHIM_DIR/arbishield-prelive-events.mjs" "$SCRIPTS_DIR/arbishield-prelive-events.mjs" 2>/dev/null || true
grep -q 'claimProtectionCancelled' "$SHIM_DIR/arbishield-prelive-events.mjs" || die "prelive sem claimProtectionCancelled"

# path real do systemd prelive
for u in arbishield-prelive-events.service; do
  if systemctl cat "$u" >/dev/null 2>&1; then
    exec="$(systemctl show -p ExecStart --value "$u" 2>/dev/null | head -1 || true)"
    echo "  ExecStart=$exec"
    if [[ "$exec" =~ (/[^[:space:]]+arbishield-prelive-events\.mjs) ]]; then
      cp -f "$SHIM_DIR/arbishield-prelive-events.mjs" "${BASH_REMATCH[1]}"
      echo "  wrote ${BASH_REMATCH[1]}"
    fi
  fi
done

log "2/3 — serverfn-shim (cancelamento idempotente)"
curl -fsSL "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
cp -f "$SHIM_DIR/arbishield-serverfn-shim.mjs" "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" 2>/dev/null || true
grep -q 'claimProtectionCancelled' "$SHIM_DIR/arbishield-serverfn-shim.mjs" || die "shim sem claimProtectionCancelled"
for u in arbishield-serverfn-shim.service; do
  if systemctl cat "$u" >/dev/null 2>&1; then
    exec="$(systemctl show -p ExecStart --value "$u" 2>/dev/null | head -1 || true)"
    if [[ "$exec" =~ (/[^[:space:]]+arbishield-serverfn-shim\.mjs) ]]; then
      cp -f "$SHIM_DIR/arbishield-serverfn-shim.mjs" "${BASH_REMATCH[1]}"
      echo "  wrote ${BASH_REMATCH[1]}"
    fi
  fi
done

log "3/3 — script diagnóstico"
curl -fsSL "$RAW/scripts/vps-diagnose-user-balance.mjs" -o "$SCRIPTS_DIR/vps-diagnose-user-balance.mjs"
chmod 0644 "$SCRIPTS_DIR/vps-diagnose-user-balance.mjs"
grep -q 'FIX_OVERCREDIT\|overcredit\|Auditoria estornos' "$SCRIPTS_DIR/vps-diagnose-user-balance.mjs" || die "diag antigo"

systemctl daemon-reload 2>/dev/null || true
systemctl restart arbishield-prelive-events.service 2>/dev/null || echo "AVISO: não reiniciou prelive"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || echo "AVISO: não reiniciou shim"
sleep 2
curl -sS "http://127.0.0.1:3098/health" 2>/dev/null | head -c 200 || true
echo
curl -sS "http://127.0.0.1:3101/health" 2>/dev/null | head -c 200 || true
echo

echo "=========================================="
echo " OK — agora rode:"
echo "  EMAIL=carloskku4@gmail.com node $SCRIPTS_DIR/vps-diagnose-user-balance.mjs"
echo " Se mostrar EXCESSO / OVERCREDIT:"
echo "  FIX_OVERCREDIT=1 EMAIL=carloskku4@gmail.com node $SCRIPTS_DIR/vps-diagnose-user-balance.mjs"
echo "=========================================="
