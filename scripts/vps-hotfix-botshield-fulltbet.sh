#!/usr/bin/env bash
# BotShield: apontar autenticacao/place para Fulltbet (mesmo stack Mexchange).
#
# Na VPS (root):
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-botshield-fulltbet.sh?ref=cursor/botshield-fulltbet-e85c&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/botshield-fulltbet-e85c}"
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

echo "==> vps-hotfix-botshield-fulltbet.sh ($(date -Is)) ref=$REF"

log "1/3 baixar libs + Conta Exchange"
for pair in \
  "scripts/lib/betbra-client-api.mjs:$SCRIPTS_DIR/lib/betbra-client-api.mjs" \
  "scripts/lib/mexchange-offers.mjs:$SCRIPTS_DIR/lib/mexchange-offers.mjs" \
  "scripts/lib/exchange-orders-service.mjs:$SCRIPTS_DIR/lib/exchange-orders-service.mjs" \
  "scripts/arbishield-serverfn-shim.mjs:$SHIM_DIR/scripts/arbishield-serverfn-shim.mjs" \
  "deploy/vps-supabase/static/botshield/conta-betbra.html:$WEB/conta-betbra.html"
do
  rel="${pair%%:*}"
  out="${pair#*:}"
  download_repo_file "$rel" "$out"
  echo "  OK $out"
done

for f in betbra-client-api.mjs mexchange-offers.mjs exchange-orders-service.mjs; do
  cp -f "$SCRIPTS_DIR/lib/$f" "$SHIM_DIR/scripts/lib/$f" 2>/dev/null || true
  cp -f "$SCRIPTS_DIR/lib/$f" "$SHIM_DIR/lib/$f" 2>/dev/null || true
done
if [[ -f "$SHIM_DIR/arbishield-serverfn-shim.mjs" ]] || [[ -L "$SHIM_DIR/arbishield-serverfn-shim.mjs" ]]; then
  cp -f "$SHIM_DIR/scripts/arbishield-serverfn-shim.mjs" "$SHIM_DIR/arbishield-serverfn-shim.mjs" || true
fi

grep -q 'fulltbet' "$SCRIPTS_DIR/lib/betbra-client-api.mjs" || die "betbra-client-api sem fulltbet"
grep -q 'exchangeBrandDefaults' "$SCRIPTS_DIR/lib/mexchange-offers.mjs" || die "mexchange-offers sem brand defaults"
grep -q 'fulltbet' "$WEB/conta-betbra.html" || die "UI sem mencao Fulltbet"

log "2/3 env → Fulltbet"
n=0
for f in "${ENV_FILES[@]}"; do
  if [[ -f "$f" ]] || [[ "$f" == /opt/arbishield/deploy/vps-supabase/.env ]]; then
    upsert_env "$f" "EXCHANGE_BRAND" "fulltbet"
    upsert_env "$f" "BOTSHIELD_EXCHANGE_BRAND" "fulltbet"
    upsert_env "$f" "EXCHANGE_SITE_ORIGIN" "https://fulltbet.bet.br"
    upsert_env "$f" "BETBRA_CLIENT_API_BASE" "https://fulltbet.bet.br/client/api"
    upsert_env "$f" "BETBRA_ORIGIN" "https://fulltbet.bet.br"
    upsert_env "$f" "BETBRA_REFERER" "https://fulltbet.bet.br/"
    upsert_env "$f" "MEXCHANGE_API_BASE_URL" "https://mexchange-api.fulltbet.bet.br/api"
    upsert_env "$f" "MEXCHANGE_ORDERS_API_BASE" "https://mexchange-api.fulltbet.bet.br/api"
    upsert_env "$f" "EXCHANGE_ORDERS_BASE_URL" "https://mexchange-api.fulltbet.bet.br/api"
    upsert_env "$f" "MEXCHANGE_ORIGIN" "https://mexchange.fulltbet.bet.br"
    upsert_env "$f" "MEXCHANGE_REFERER" "https://mexchange.fulltbet.bet.br/"
    upsert_env "$f" "EXCHANGE_ORDERS_LIVE" "1"
    upsert_env "$f" "EXCHANGE_ORDERS_AUTH_STYLE" "cookie"
    upsert_env "$f" "EXCHANGE_ORDERS_PAYLOAD" "mexchange"
    upsert_env "$f" "EXCHANGE_ORDERS_PLACE_PATH" "/offers"
    echo "  OK $f"
    n=$((n + 1))
  fi
done
[[ "$n" -gt 0 ]] || die "nenhum .env em /opt/arbishield"

log "3/3 restart shim"
systemctl restart arbishield-serverfn-shim.service || die "restart shim falhou"
sleep 1
systemctl is-active --quiet arbishield-serverfn-shim.service || die "shim nao active"

echo "OK — BotShield autenticando na Fulltbet"
echo "  Conta: https://botshield.arbishield.app/conta-betbra.html  (Ctrl+Shift+R)"
echo "  Use LOGIN/SENHA da Fulltbet (nao da BetBra)"
echo "  Atualizar saldo → codigo do e-mail Fulltbet → Enviar codigo"
echo "  Testar sessao → accountId → Ordens LAY+BACK"
echo "  Para voltar a BetBra: EXCHANGE_BRAND=betbra nos .env e restart shim"
