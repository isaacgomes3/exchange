#!/usr/bin/env bash
# Cria dois eventos futuros, publicados, com um mercado BACK cada.
#
# Uso na VPS:
#   export ARBISHIELD_ADMIN_TOKEN='token-de-uma-sessao-admin'
#   bash scripts/vps-create-back-test-events.sh
#
# Opcional:
#   ARBISHIELD_API=http://127.0.0.1:3098 \
#   ARBISHIELD_LIQUIDITY_BRL=1000 \
#   bash scripts/vps-create-back-test-events.sh
set -euo pipefail

API="${ARBISHIELD_API:-http://127.0.0.1:3098}"
TOKEN="${ARBISHIELD_ADMIN_TOKEN:-}"
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
[[ -n "$TOKEN" ]] || die "defina ARBISHIELD_ADMIN_TOKEN com uma sessão de administrador"
[[ "$LIQUIDITY_BRL" =~ ^[0-9]+([.][0-9]+)?$ ]] || die "ARBISHIELD_LIQUIDITY_BRL inválida"

create_event() {
  local number="$1"
  local odd="$2"
  local starts_at="$3"
  local market_id
  market_id="$(uuid)"

  local payload
  payload="$(cat <<EOF
{
  "mode": "manual",
  "home_team": "Teste BACK Casa ${number}",
  "away_team": "Teste BACK Fora ${number}",
  "league": "Teste automatizado BACK",
  "starts_at": "${starts_at}",
  "status": "open",
  "is_published": true,
  "sport_type": "futebol",
  "markets": [{
    "id": "${market_id}",
    "name": "BACK Casa",
    "market_type": "BACK",
    "odd": ${odd},
    "liquidity_brl": ${LIQUIDITY_BRL}
  }]
}
EOF
)"

  echo "Criando evento BACK ${number} (mercado ${market_id})..."
  curl --fail-with-body --silent --show-error \
    --request POST "${API%/}/api/arbishield/matches" \
    --header "Authorization: Bearer ${TOKEN}" \
    --header "Content-Type: application/json" \
    --data "$payload"
  echo
}

# Eventos futuros para permanecerem elegíveis à proteção.
create_event 1 2.00 "$(date -u -d '+2 hours' +%Y-%m-%dT%H:%M:%SZ)"
create_event 2 2.20 "$(date -u -d '+3 hours' +%Y-%m-%dT%H:%M:%SZ)"

echo "OK — dois eventos BACK de teste foram criados e publicados."
