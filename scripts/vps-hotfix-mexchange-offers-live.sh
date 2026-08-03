#!/usr/bin/env bash
# Liga place REAL na Mexchange (POST /offers) + UI de teste LAY/BACK + diagnóstico AccountId.
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

log "1/5 baixar libs + shim + UI"
for pair in \
  "scripts/lib/mexchange-offers.mjs:$SCRIPTS_DIR/lib/mexchange-offers.mjs" \
  "scripts/lib/exchange-orders-adapter.mjs:$SCRIPTS_DIR/lib/exchange-orders-adapter.mjs" \
  "scripts/lib/exchange-orders-service.mjs:$SCRIPTS_DIR/lib/exchange-orders-service.mjs" \
  "scripts/lib/exchange-orders-contract.mjs:$SCRIPTS_DIR/lib/exchange-orders-contract.mjs" \
  "scripts/lib/betbra-client-api.mjs:$SCRIPTS_DIR/lib/betbra-client-api.mjs" \
  "scripts/arbishield-serverfn-shim.mjs:$SHIM_DIR/scripts/arbishield-serverfn-shim.mjs" \
  "deploy/vps-supabase/static/botshield/ordens.html:$WEB/ordens.html" \
  "deploy/vps-supabase/static/botshield/conta-betbra.html:$WEB/conta-betbra.html" \
  "scripts/extract-mexchange-cookie-from-har.mjs:$SCRIPTS_DIR/extract-mexchange-cookie-from-har.mjs"
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
# shim às vezes fica em /opt/arbishield/arbishield-serverfn-shim.mjs
if [[ -f "$SHIM_DIR/arbishield-serverfn-shim.mjs" ]] || [[ -L "$SHIM_DIR/arbishield-serverfn-shim.mjs" ]]; then
  cp -f "$SHIM_DIR/scripts/arbishield-serverfn-shim.mjs" "$SHIM_DIR/arbishield-serverfn-shim.mjs" || true
fi

grep -q 'buildMexchangeOffersBody' "$SCRIPTS_DIR/lib/mexchange-offers.mjs" \
  || die "mexchange-offers.mjs sem buildMexchangeOffersBody"
grep -q 'sanitizeTradingCookieHeader' "$SCRIPTS_DIR/lib/mexchange-offers.mjs" \
  || die "mexchange-offers.mjs sem sanitizeTradingCookieHeader"
grep -q 'sessionMexchangeAccount' "$SCRIPTS_DIR/lib/exchange-orders-service.mjs" \
  || die "service sem sessionMexchangeAccount"
grep -q 'exchange-session/mexchange-account' "$SHIM_DIR/scripts/arbishield-serverfn-shim.mjs" \
  || die "shim sem rota mexchange-account"
grep -q 'btnTestMexchange' "$WEB/conta-betbra.html" || die "conta-betbra.html sem Testar sessão"
grep -q 'confirmLive' "$WEB/ordens.html" || die "ordens.html sem teste live"

log "2/5 env LIVE + paths /offers + cookie-only"
n=0
for f in "${ENV_FILES[@]}"; do
  if [[ -f "$f" ]] || [[ "$f" == /opt/arbishield/deploy/vps-supabase/.env ]]; then
    upsert_env "$f" "EXCHANGE_ORDERS_LIVE" "1"
    upsert_env "$f" "EXCHANGE_ORDERS_PROVIDER" "betbra"
    upsert_env "$f" "EXCHANGE_ORDERS_PLACE_PATH" "/offers"
    upsert_env "$f" "EXCHANGE_ORDERS_CANCEL_PATH" "/offers"
    upsert_env "$f" "EXCHANGE_ORDERS_STATUS_PATH" "/offers"
    upsert_env "$f" "EXCHANGE_ORDERS_PAYLOAD" "mexchange"
    upsert_env "$f" "EXCHANGE_ORDERS_AUTH_STYLE" "cookie"
    echo "  OK $f"
    n=$((n + 1))
  fi
done
[[ "$n" -gt 0 ]] || die "nenhum .env em /opt/arbishield"

log "3/5 nginx: liberar mexchange-account"
ALLOW_NEEDLE='exchange-session/mexchange-account'
for NGX in \
  /etc/nginx/sites-available/botshield.arbishield.app \
  /etc/nginx/sites-available/botshield.arbishield.app.http-only \
  /etc/nginx/sites-enabled/botshield.arbishield.app \
  /etc/nginx/sites-enabled/botshield.arbishield.app.http-only
do
  [[ -f "$NGX" ]] || continue
  if grep -qF "$ALLOW_NEEDLE" "$NGX" 2>/dev/null; then
    echo "  já ok: $NGX"
    continue
  fi
  if ! grep -q 'exchange-session' "$NGX" 2>/dev/null; then
    echo "  skip (sem exchange-session): $NGX"
    continue
  fi
  cp -a "$NGX" "${NGX}.bak.$(date +%Y%m%d%H%M%S)"
  # Insere mexchange-account após balance| na allowlist (formato atual do repo)
  if grep -q 'exchange-session/balance|' "$NGX"; then
    sed -i \
      's#exchange-session/balance|#exchange-session/balance|exchange-session/mexchange-account|#g' \
      "$NGX"
    echo "  patched (+mexchange-account): $NGX"
  elif grep -qE 'exchange-session/\(status\|connect' "$NGX"; then
    # formato antigo agrupado: (status|connect|cookie|balance|orders)
    sed -i -E \
      's#exchange-session/\(([^)]*)\)#exchange-session/(\1|mexchange-account)#g' \
      "$NGX"
    # evita duplicar se já rodou
    sed -i 's#|mexchange-account|mexchange-account#|mexchange-account#g' "$NGX"
    echo "  patched (grupo antigo): $NGX"
  else
    echo "  AVISO: não consegui patch automático em $NGX — edite manualmente"
  fi
done
if command -v nginx >/dev/null 2>&1; then
  nginx -t && systemctl reload nginx || die "nginx reload falhou"
  echo "  nginx reloaded"
fi

log "4/5 restart shim"
systemctl daemon-reload 2>/dev/null || true
systemctl restart arbishield-serverfn-shim.service || die "restart shim falhou"
sleep 1
systemctl is-active --quiet arbishield-serverfn-shim.service || {
  journalctl -u arbishield-serverfn-shim.service -n 40 --no-pager || true
  die "shim não active"
}

log "5/5 smoke local"
code=$(curl -sS -o /tmp/bs-place.json -w "%{http_code}" \
  -X POST "http://127.0.0.1:3101/api/arbishield/exchange-orders/place" \
  -H "Accept: application/json" -H "Content-Type: application/json" \
  -d '{}' || echo ERR)
echo "  place sem auth → HTTP $code (esperado 400)"
head -c 200 /tmp/bs-place.json 2>/dev/null; echo
code2=$(curl -sS -o /tmp/bs-acc.json -w "%{http_code}" \
  "http://127.0.0.1:3101/api/arbishield/exchange-session/mexchange-account" \
  -H "Accept: application/json" || echo ERR)
echo "  mexchange-account sem auth → HTTP $code2 (esperado 400/401)"
head -c 200 /tmp/bs-acc.json 2>/dev/null; echo

echo ""
echo "OK — Mexchange /offers LIVE + Testar sessão"
echo "  1) Conta BetBra → cURL → Extrair → Salvar → Testar sessão (precisa accountId)"
echo "  2) Se Testar sessão falhar: Cookie Chrome != IP VPS — use login/senha + device"
echo "  3) https://botshield.arbishield.app/ordens.html (LAY+BACK, confirmLive)"
echo "  Atenção: ordem REAL — use stake mínima"
