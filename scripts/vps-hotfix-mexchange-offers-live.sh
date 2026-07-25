#!/usr/bin/env bash
# Liga place REAL na Mexchange (POST /offers) + UI de teste LAY/BACK.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-mexchange-offers-live.sh?ref=cursor/botshield-painel-e85c&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
#
# Ou: cole este arquivo e rode bash vps-hotfix-mexchange-offers-live.sh
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/botshield-painel-e85c}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"
WEB="${BOTSHIELD_WEB:-/var/www/arbishield-botshield}"
ENV_FILES=(
  /opt/arbishield/deploy/vps-supabase/.env
  /opt/arbishield/.arbishield-odds-sync.env
  /opt/arbishield/.env
)

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
mkdir -p "$SCRIPTS_DIR/lib" "$SHIM_DIR/lib" "$SHIM_DIR/scripts/lib" "$WEB"

download_repo_file() {
  local rel="$1"
  local out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/$rel?ref=${REF}&t=$(date +%s%N)" -o "$out" \
    && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "$RAW/$rel?v=$BUST&t=$(date +%s%N)" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

upsert_env() {
  local file="$1" key="$2" val="$3"
  mkdir -p "$(dirname "$file")"
  touch "$file"
  if grep -qE "^${key}=" "$file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$file"
  else
    printf '\n%s=%s\n' "$key" "$val" >>"$file"
  fi
  awk -F= -v k="$key" '
    $1==k { last=$0; next }
    { print }
    END { if (last!="") print last }
  ' "$file" >"${file}.tmp" && mv "${file}.tmp" "$file"
}

echo "==> vps-hotfix-mexchange-offers-live.sh ($(date -Is)) ref=$REF"

log "1/4 baixar libs + UI"
for pair in \
  "scripts/lib/mexchange-offers.mjs:$SCRIPTS_DIR/lib/mexchange-offers.mjs" \
  "scripts/lib/exchange-orders-adapter.mjs:$SCRIPTS_DIR/lib/exchange-orders-adapter.mjs" \
  "scripts/lib/exchange-orders-service.mjs:$SCRIPTS_DIR/lib/exchange-orders-service.mjs" \
  "scripts/lib/exchange-orders-contract.mjs:$SCRIPTS_DIR/lib/exchange-orders-contract.mjs" \
  "scripts/lib/betbra-client-api.mjs:$SCRIPTS_DIR/lib/betbra-client-api.mjs" \
  "deploy/vps-supabase/static/botshield/ordens.html:$WEB/ordens.html" \
  "deploy/vps-supabase/static/botshield/conta-betbra.html:$WEB/conta-betbra.html"
do
  rel="${pair%%:*}"
  out="${pair#*:}"
  download_repo_file "$rel" "$out"
  echo "  OK $out"
done

# espelhar libs onde o shim costuma importar
for f in mexchange-offers.mjs exchange-orders-adapter.mjs exchange-orders-service.mjs exchange-orders-contract.mjs betbra-client-api.mjs; do
  cp -f "$SCRIPTS_DIR/lib/$f" "$SHIM_DIR/scripts/lib/$f" 2>/dev/null || true
  cp -f "$SCRIPTS_DIR/lib/$f" "$SHIM_DIR/lib/$f" 2>/dev/null || true
done

grep -q 'buildMexchangeOffersBody' "$SCRIPTS_DIR/lib/mexchange-offers.mjs" \
  || die "mexchange-offers.mjs sem buildMexchangeOffersBody"
grep -q 'EXCHANGE_ORDERS_PLACE_PATH", "/offers"' "$SCRIPTS_DIR/lib/exchange-orders-adapter.mjs" \
  || grep -q 'PLACE_PATH", "/offers"' "$SCRIPTS_DIR/lib/exchange-orders-adapter.mjs" \
  || die "adapter sem default /offers"
grep -q 'confirmLive' "$WEB/ordens.html" || die "ordens.html sem teste live"

log "2/4 env LIVE + paths /offers"
n=0
for f in "${ENV_FILES[@]}"; do
  if [[ -f "$f" ]] || [[ "$f" == /opt/arbishield/deploy/vps-supabase/.env ]]; then
    upsert_env "$f" "EXCHANGE_ORDERS_LIVE" "1"
    upsert_env "$f" "EXCHANGE_ORDERS_PROVIDER" "betbra"
    upsert_env "$f" "EXCHANGE_ORDERS_PLACE_PATH" "/offers"
    upsert_env "$f" "EXCHANGE_ORDERS_CANCEL_PATH" "/offers"
    upsert_env "$f" "EXCHANGE_ORDERS_STATUS_PATH" "/offers"
    upsert_env "$f" "EXCHANGE_ORDERS_PAYLOAD" "mexchange"
    upsert_env "$f" "EXCHANGE_ORDERS_AUTH_STYLE" "auto"
    echo "  OK $f"
    n=$((n + 1))
  fi
done
[[ "$n" -gt 0 ]] || die "nenhum .env em /opt/arbishield"

log "3/4 restart shim"
systemctl daemon-reload 2>/dev/null || true
systemctl restart arbishield-serverfn-shim.service || die "restart shim falhou"
sleep 1
systemctl is-active --quiet arbishield-serverfn-shim.service || {
  journalctl -u arbishield-serverfn-shim.service -n 40 --no-pager || true
  die "shim não active"
}

log "4/4 smoke local"
code=$(curl -sS -o /tmp/bs-place.json -w "%{http_code}" \
  -X POST "http://127.0.0.1:3101/api/arbishield/exchange-orders/place" \
  -H "Accept: application/json" -H "Content-Type: application/json" \
  -d '{}' || echo ERR)
echo "  place sem auth → HTTP $code (esperado 400)"
head -c 200 /tmp/bs-place.json 2>/dev/null; echo

echo ""
echo "OK — Mexchange /offers LIVE ligado"
echo "  1) Aprove dispositivo na BetBra e Atualizar saldo"
echo "  2) https://botshield.arbishield.app/ordens.html"
echo "  3) Marque confirmLive e envie LAY + BACK (stake R\$1)"
echo "  Atenção: ordem REAL — use stake mínima"
