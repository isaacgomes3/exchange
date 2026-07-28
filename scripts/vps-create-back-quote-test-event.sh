#!/usr/bin/env bash
# Cria um evento futuro publicado com uma cotação BACK de teste.
#
# Uso na VPS:
#   export ARBISHIELD_ADMIN_TOKEN='JWT de uma sessão admin'
#   bash scripts/vps-create-back-quote-test-event.sh
set -euo pipefail

API="${ARBISHIELD_API:-http://127.0.0.1:3098}"
TOKEN="${ARBISHIELD_ADMIN_TOKEN:-}"
ODD="${ARBISHIELD_BACK_ODD:-2.00}"
LIQUIDITY_BRL="${ARBISHIELD_LIQUIDITY_BRL:-1000}"

die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
uuid() {
  if [[ -r /proc/sys/kernel/random/uuid ]]; then
    tr -d '\n' < /proc/sys/kernel/random/uuid
  else
    uuidgen
  fi
}

need curl
need date
[[ -n "$TOKEN" ]] || die "defina ARBISHIELD_ADMIN_TOKEN com o JWT de uma sessão admin"
[[ "$ODD" =~ ^[0-9]+([.][0-9]+)?$ ]] || die "ARBISHIELD_BACK_ODD inválida"
[[ "$LIQUIDITY_BRL" =~ ^[0-9]+([.][0-9]+)?$ ]] || die "ARBISHIELD_LIQUIDITY_BRL inválida"

MARKET_ID="$(uuid)"
STARTS_AT="$(date -u -d '+2 hours' +%Y-%m-%dT%H:%M:%SZ)"
PAYLOAD="$(cat <<EOF
{
  "mode": "manual",
  "home_team": "Teste Cotação BACK Casa",
  "away_team": "Teste Cotação BACK Fora",
  "league": "Teste automatizado BACK",
  "starts_at": "${STARTS_AT}",
  "status": "open",
  "is_published": true,
  "sport_type": "futebol",
  "markets": [{
    "id": "${MARKET_ID}",
    "name": "Cotação BACK",
    "market_type": "BACK",
    "odd": ${ODD},
    "liquidity_brl": ${LIQUIDITY_BRL}
  }]
}
EOF
)"

echo "Criando evento BACK com mercado ${MARKET_ID}..."
curl --fail-with-body --silent --show-error \
  --request POST "${API%/}/api/arbishield/matches" \
  --header "Authorization: Bearer ${TOKEN}" \
  --header "Content-Type: application/json" \
  --data "$PAYLOAD"
echo
echo "OK — evento futuro BACK criado (odd ${ODD}, liquidez R$ ${LIQUIDITY_BRL})."
