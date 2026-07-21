#!/usr/bin/env bash
# Hotfix v2: Falha Crítica de Integridade ao ativar proteção
#
# Causa: trigger Postgres exige lançamento no ledger ANTES do INSERT.
# LAY usa type=anchor_lock; BACK usa protection_lock (com fallbacks).
#
# Na VPS (obrigatório — só o GitHub não atualiza o Node :3098):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-protecao-integridade-debito-723d/scripts/vps-hotfix-protecao-integridade-debito.sh?v=2")
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

log "Prelive :3098 (integridade-debito-v2: anchor_lock + retries)"
curl -fsSL "$RAW/scripts/arbishield-prelive-events.mjs" -o "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
chmod 0755 "$SCRIPTS_DIR/arbishield-prelive-events.mjs"

grep -q 'integridade-debito-v2' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" \
  || die "prelive sem marcador integridade-debito-v2"
grep -q 'anchor_lock' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" \
  || die "prelive sem anchor_lock"
grep -q 'id: protectionId' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" \
  || die "prelive sem UUID explícito na proteção"

log "Reiniciar arbishield-prelive-events"
systemctl restart arbishield-prelive-events.service 2>/dev/null || true
sleep 1

log "Smoke health (deve reportar integridade-debito-v2)"
CODE=$(curl -sS -o /tmp/prelive-health.json -w "%{http_code}" \
  http://127.0.0.1:3098/health || echo 000)
BODY=$(cat /tmp/prelive-health.json 2>/dev/null || true)
echo "  HTTP $CODE · $BODY"
[[ "$CODE" == "200" ]] || die "prelive health falhou"
echo "$BODY" | grep -q 'integridade-debito-v2' \
  || die "Serviço ainda sem v2 — restart falhou ou arquivo antigo"

log "Smoke create-protection (sem token → 401)"
CODE2=$(curl -sS -o /tmp/prot-integ.json -w "%{http_code}" -X POST \
  http://127.0.0.1:3098/api/arbishield/protections \
  -H 'Content-Type: application/json' \
  -d '{"matchId":"00000000-0000-0000-0000-000000000001","amountCents":100,"odd":2.0,"balanceType":"REAL"}' \
  || echo 000)
BODY2=$(cat /tmp/prot-integ.json 2>/dev/null || true)
echo "  HTTP $CODE2 · $BODY2"
echo "$BODY2" | grep -qi 'Falha Crítica de Integridade' && \
  die "Ainda retorna Falha Crítica de Integridade no smoke sem auth"

echo
echo "OK — Integridade v2 aplicada no :3098"
echo "  Confirme: curl -s http://127.0.0.1:3098/health | grep integridade-debito-v2"
echo "  Teste: https://arbishield.app/app-proteger.html → Ativar proteção"
