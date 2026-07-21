#!/usr/bin/env bash
# Hotfix: Falha Crítica de Integridade ao ativar proteção
#
# Causa: createProtection gravava a proteção ANTES do wallet_transactions.
# Trigger Postgres exige registro de débito (protection_lock) com ref=id
# no momento do INSERT.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-protecao-integridade-debito-723d/scripts/vps-hotfix-protecao-integridade-debito.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/fix-protecao-integridade-debito-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$SCRIPTS_DIR"

log "Backup prelive"
if [[ -f "$SCRIPTS_DIR/arbishield-prelive-events.mjs" ]]; then
  cp -a "$SCRIPTS_DIR/arbishield-prelive-events.mjs" \
    "$SCRIPTS_DIR/arbishield-prelive-events.mjs.bak.integridade.$(date +%Y%m%d%H%M%S)" || true
fi

log "Prelive :3098 (ledger antes da proteção)"
curl -fsSL "$RAW/scripts/arbishield-prelive-events.mjs" -o "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
chmod 0755 "$SCRIPTS_DIR/arbishield-prelive-events.mjs"

grep -q 'Trigger de integridade exige wallet_transactions' \
  "$SCRIPTS_DIR/arbishield-prelive-events.mjs" || die "prelive sem fix de integridade"
grep -q 'amount_cents: -amountCents' \
  "$SCRIPTS_DIR/arbishield-prelive-events.mjs" || die "prelive sem débito negativo no ledger"
grep -q 'id: protectionId' \
  "$SCRIPTS_DIR/arbishield-prelive-events.mjs" || die "prelive sem UUID explícito na proteção"

log "Reiniciar arbishield-prelive-events"
systemctl restart arbishield-prelive-events.service 2>/dev/null || true
sleep 1

log "Smoke health"
CODE=$(curl -sS -o /tmp/prelive-health.json -w "%{http_code}" \
  http://127.0.0.1:3098/health || echo 000)
BODY=$(cat /tmp/prelive-health.json 2>/dev/null || true)
echo "  HTTP $CODE · $BODY"
[[ "$CODE" == "200" ]] || die "prelive health falhou"

log "Smoke create-protection (sem token → 401, não integridade)"
CODE2=$(curl -sS -o /tmp/prot-integ.json -w "%{http_code}" -X POST \
  http://127.0.0.1:3098/api/arbishield/protections \
  -H 'Content-Type: application/json' \
  -d '{"matchId":"00000000-0000-0000-0000-000000000001","amountCents":100,"odd":2.0,"balanceType":"REAL"}' \
  || echo 000)
BODY2=$(cat /tmp/prot-integ.json 2>/dev/null || true)
echo "  HTTP $CODE2 · $BODY2"
echo "$BODY2" | grep -qi 'Falha Crítica de Integridade' && \
  die "Ainda retorna Falha Crítica de Integridade no smoke sem auth"
[[ "$CODE2" == "401" || "$CODE2" == "403" || "$CODE2" == "400" || "$CODE2" == "404" ]] \
  || echo "$BODY2" | grep -Eqi 'autoriz|negado|token|Login|Acesso|encontrado|obrigat|inválid' \
  || die "Resposta inesperada no smoke protections"

echo
echo "OK — Integridade de proteção (débito no ledger antes do INSERT)"
echo "  Teste: Proteger Aposta → Ativar proteção"
echo "  Não deve mais aparecer: Falha Crítica de Integridade"
