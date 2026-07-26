#!/usr/bin/env bash
# BotShield: voltar autenticacao/place para BetBra (padrao Mexchange).
# Mantem fixes: Chrome UA, IP publico, gate accountId, fallback saldo.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-botshield-betbra.sh?ref=cursor/botshield-betbra-e85c&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/botshield-betbra-e85c}"
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

echo "==> vps-hotfix-botshield-betbra.sh ($(date -Is)) ref=$REF"

log "1/3 baixar libs + Conta BetBra + shell"
for pair in \
  "scripts/lib/betbra-client-api.mjs:$SCRIPTS_DIR/lib/betbra-client-api.mjs" \
  "scripts/lib/mexchange-offers.mjs:$SCRIPTS_DIR/lib/mexchange-offers.mjs" \
  "scripts/lib/exchange-orders-service.mjs:$SCRIPTS_DIR/lib/exchange-orders-service.mjs" \
  "scripts/arbishield-serverfn-shim.mjs:$SHIM_DIR/scripts/arbishield-serverfn-shim.mjs" \
  "deploy/vps-supabase/static/botshield/conta-betbra.html:$WEB/conta-betbra.html" \
  "deploy/vps-supabase/static/botshield/botshield-shell.js:$WEB/botshield-shell.js"
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

grep -q 'resolveExchangeBrand' "$SCRIPTS_DIR/lib/betbra-client-api.mjs" || die "betbra-client-api sem brand"
grep -q 'BETBRA_API_BLOCKED' "$SCRIPTS_DIR/lib/betbra-client-api.mjs" || die "betbra-client-api sem mapa API blocked"
grep -q 'resolveLoginPublicIp' "$SCRIPTS_DIR/lib/betbra-client-api.mjs" || die "betbra-client-api sem IP publico"
grep -q 'Chrome/' "$SCRIPTS_DIR/lib/betbra-client-api.mjs" || die "betbra-client-api sem Chrome UA"
if grep -q 'ArbiShieldBotShield' "$SCRIPTS_DIR/lib/betbra-client-api.mjs"; then
  die "UA de bot ainda presente (causa API blocked)"
fi
if grep -qE 'BETBRA_LOGIN_IP", "0\.0\.0\.0"' "$SCRIPTS_DIR/lib/betbra-client-api.mjs"; then
  die "login ainda manda ip 0.0.0.0 (causa API blocked)"
fi
grep -q 'mexchange/account/info' "$SCRIPTS_DIR/lib/exchange-orders-service.mjs" || die "service sem fallback saldo Mexchange"
grep -q 'exchangeBrandDefaults' "$SCRIPTS_DIR/lib/mexchange-offers.mjs" || die "mexchange-offers sem brand defaults"
grep -q 'betbra\.bet\.br' "$WEB/conta-betbra.html" || die "UI sem mencao BetBra"
grep -q 'accountId vazio' "$WEB/conta-betbra.html" || die "UI Testar sessao sem exigir accountId"
grep -q 'API bloqueada' "$WEB/botshield-shell.js" || die "shell sem tratamento API bloqueada"

log "2/3 env → BetBra"
n=0
for f in "${ENV_FILES[@]}"; do
  if [[ -f "$f" ]] || [[ "$f" == /opt/arbishield/deploy/vps-supabase/.env ]]; then
    upsert_env "$f" "EXCHANGE_BRAND" "betbra"
    upsert_env "$f" "BOTSHIELD_EXCHANGE_BRAND" "betbra"
    upsert_env "$f" "EXCHANGE_SITE_ORIGIN" "https://betbra.bet.br"
    upsert_env "$f" "BETBRA_CLIENT_API_BASE" "https://betbra.bet.br/client/api"
    upsert_env "$f" "BETBRA_ORIGIN" "https://betbra.bet.br"
    upsert_env "$f" "BETBRA_REFERER" "https://betbra.bet.br/"
    upsert_env "$f" "MEXCHANGE_API_BASE_URL" "https://mexchange-api.betbra.bet.br/api"
    upsert_env "$f" "MEXCHANGE_ORDERS_API_BASE" "https://mexchange-api.betbra.bet.br/api"
    upsert_env "$f" "EXCHANGE_ORDERS_BASE_URL" "https://mexchange-api.betbra.bet.br/api"
    upsert_env "$f" "MEXCHANGE_ORIGIN" "https://mexchange.betbra.bet.br"
    upsert_env "$f" "MEXCHANGE_REFERER" "https://mexchange.betbra.bet.br/"
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

echo "OK — BotShield autenticando na BetBra"
echo "  Conta: https://botshield.arbishield.app/conta-betbra.html  (Ctrl+Shift+R)"
echo "  Use LOGIN/SENHA da BetBra"
echo "  Atualizar saldo → codigo do e-mail BetBra → Enviar codigo"
echo "  Ou: Chrome logado → cURL mexchange-api.betbra.bet.br → Extrair/Salvar"
echo "  Testar sessao → accountId → Ordens LAY+BACK"
echo "  Para Fulltbet: rode vps-hotfix-botshield-fulltbet.sh"
