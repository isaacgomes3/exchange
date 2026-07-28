#!/usr/bin/env bash
# Diagnóstico V1-ONLY — falha se detectar modelo paralelo de proteção.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/protecao-do-zero-47c1/scripts/vps-diagnostico-logica-protecao.sh")
set -euo pipefail

SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield}/v2"
FAIL=0

ok() { echo "  OK  $*"; }
bad() { echo "  FAIL $*"; FAIL=1; }
info() { echo "  ·   $*"; }

echo
echo "=============================================================="
echo "  Diagnóstico FLUXO_PROTECAO_V1 (único modelo permitido)"
echo "=============================================================="
echo

PRELIVE=""
for p in \
  "$SCRIPTS_DIR/arbishield-prelive-events.mjs" \
  /opt/arbishield/scripts/arbishield-prelive-events.mjs
do
  [[ -f "$p" ]] && PRELIVE="$p" && break
done

SHIM=""
for p in \
  "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  /opt/arbishield/arbishield-serverfn-shim.mjs \
  /opt/arbishield/scripts/arbishield-serverfn-shim.mjs
do
  [[ -f "$p" ]] && SHIM="$p" && break
done

check_v1_file() {
  local label="$1" file="$2"
  echo "==> $label ($file)"
  if [[ -z "$file" || ! -f "$file" ]]; then
    bad "arquivo ausente"
    return
  fi
  if grep -q 'FLUXO_PROTECAO_V1' "$file"; then
    ok "marker FLUXO_PROTECAO_V1"
  else
    bad "sem FLUXO_PROTECAO_V1"
  fi
  if grep -qE 'fee_upfront|lock_fee_after' "$file"; then
    bad "modelo antigo fee_upfront/lock_fee_after presente"
  else
    ok "sem fee_upfront/lock_fee_after"
  fi
  if grep -q 'settle-arbishield-saldo-real-v1' "$file"; then
    bad "marker settle-arbishield-saldo-real-v1 (modelo paralelo)"
  else
    ok "sem settle-arbishield-saldo-real-v1"
  fi
  if grep -q 'Liquidação em reconstrução' "$file"; then
    bad "stub 501 de liquidação"
  else
    ok "sem stub Liquidação em reconstrução"
  fi
  if grep -q 'protection_lock\|locked_balance_cents' "$file"; then
    ok "lock Congelado presente"
  else
    info "lock Congelado não encontrado neste arquivo (ok se shim só settle)"
  fi
}

check_v1_file "Prelive :3098" "$PRELIVE"
check_v1_file "Shim :3101" "$SHIM"

echo "==> Contrato antigo"
CONTRACT=""
for p in \
  "$SCRIPTS_DIR/lib/protection-flow-contract.mjs" \
  /opt/arbishield/scripts/lib/protection-flow-contract.mjs \
  /opt/arbishield/lib/protection-flow-contract.mjs
do
  [[ -f "$p" ]] && CONTRACT="$p" && break
done
if [[ -n "$CONTRACT" ]]; then
  bad "protection-flow-contract.mjs ainda no disco: $CONTRACT (exclua)"
else
  ok "protection-flow-contract.mjs ausente"
fi

echo "==> Admin Jogos settle UI"
ADMIN="$WEB/admin-jogos.html"
if [[ -f "$ADMIN" ]]; then
  grep -q 'REEMBOLSO' "$ADMIN" && ok "botão REEMBOLSO" || bad "sem REEMBOLSO"
  grep -qi 'VENCEU EXCHANGE' "$ADMIN" && ok "botão VENCEU EXCHANGE" || bad "sem VENCEU EXCHANGE"
  if grep -qi 'BATEU ARBISHIELD' "$ADMIN"; then
    bad "ainda diz BATEU ARBISHIELD"
  else
    ok "sem BATEU ARBISHIELD"
  fi
  if grep -qi 'Tirar da fila\|Fila (atuais)' "$ADMIN"; then
    bad "ainda tem Fila"
  else
    ok "sem Fila"
  fi
else
  bad "admin-jogos.html ausente em $ADMIN"
fi

echo "==> Cliente Proteger"
PROT="$WEB/app-proteger.html"
if [[ -f "$PROT" ]]; then
  if grep -E '\bglobal\.ArbiV2Shell' "$PROT" >/dev/null; then
    bad "app-proteger usa global.ArbiV2Shell (Node)"
  else
    ok "sem global.ArbiV2Shell"
  fi
  grep -q 'window.ArbiV2Shell\|balances-changed' "$PROT" \
    && ok "refresh pós-proteger" || info "sem refresh explícito"
else
  info "app-proteger.html ausente em $PROT"
fi

echo "==> Hotfixes antigos (devem ser abort-only)"
for name in \
  vps-hotfix-settle-credito-carteira.sh \
  vps-hotfix-settle-arbishield-saldo-real.sh \
  vps-hotfix-consolidado-proteger-settle.sh \
  vps-hotfix-salvar-protecao.sh \
  vps-deploy-protections.sh
do
  f="$SCRIPTS_DIR/$name"
  if [[ -L "$f" ]]; then
    ok "$name → symlink abort"
  elif [[ -f "$f" ]]; then
    if head -20 "$f" | grep -q 'exit 1' && ! grep -q 'curl -fsSL' "$f"; then
      ok "$name abort-only"
    else
      bad "$name ainda tem corpo de deploy antigo"
    fi
  else
    info "$name ausente (ok)"
  fi
done

echo
if [[ $FAIL -ne 0 ]]; then
  echo "RESULTADO: FALHOU — há modelo paralelo ou artefato antigo."
  echo "Corrija com: scripts/vps-hotfix-protecao-do-zero.sh"
  exit 1
fi
echo "RESULTADO: OK — apenas FLUXO_PROTECAO_V1."
exit 0
