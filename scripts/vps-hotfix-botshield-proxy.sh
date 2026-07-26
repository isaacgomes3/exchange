#!/usr/bin/env bash
# BotShield: Soft2Bet/Mexchange via proxy residencial Sticky BR.
# Desliga bridge local (nao precisa PC ligado).
#
# Na VPS (root):
#   export EXCHANGE_PROXY_DSN='host:port:user:pass'
#   # ou: export EXCHANGE_PROXY='http://user:pass@host:port'
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-botshield-proxy.sh?ref=cursor/botshield-proxy-e85c&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/botshield-proxy-e85c}"
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
need node
mkdir -p "$SCRIPTS_DIR/lib" "$SHIM_DIR/lib" "$SHIM_DIR/scripts/lib" "$WEB"

PROXY_URL="${EXCHANGE_PROXY:-}"
PROXY_DSN="${EXCHANGE_PROXY_DSN:-${BETBRA_PROXY_DSN:-}}"
[[ -n "$PROXY_URL" || -n "$PROXY_DSN" ]] || die "exporte EXCHANGE_PROXY_DSN='host:port:user:pass' ou EXCHANGE_PROXY='http://user:pass@host:port'"

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
  # evita quebrar sed com caracteres especiais — usa python
  python3 - <<PY
from pathlib import Path
p = Path("$file")
key = """$key"""
val = """$val"""
lines = p.read_text(encoding="utf-8", errors="ignore").splitlines() if p.exists() else []
out = []
found = False
for line in lines:
    if line.startswith(key + "="):
        if not found:
            out.append(key + "=" + val)
            found = True
        # drop duplicates
        continue
    out.append(line)
if not found:
    out.append(key + "=" + val)
p.write_text("\n".join(out).rstrip() + "\n", encoding="utf-8")
PY
}

echo "==> vps-hotfix-botshield-proxy.sh ($(date -Is)) ref=$REF"

log "1/4 undici (ProxyAgent)"
mkdir -p /opt/arbishield
if [[ ! -f /opt/arbishield/package.json ]]; then
  printf '%s\n' '{"name":"arbishield","private":true,"type":"module"}' >/opt/arbishield/package.json
fi
(cd /opt/arbishield && npm install undici@7 --no-audit --no-fund) || die "npm install undici falhou"
# NODE_PATH: o smoke/shim resolvem undici mesmo rodando de /root ou scripts/lib
export NODE_PATH="/opt/arbishield/node_modules${NODE_PATH:+:$NODE_PATH}"
(cd /opt/arbishield && node -e "const u=require('undici'); if(!u.ProxyAgent) process.exit(1); console.log('undici OK', !!u.ProxyAgent)") \
  || die "undici indisponivel em /opt/arbishield/node_modules"

log "2/4 baixar libs + shim"
for pair in \
  "scripts/lib/exchange-proxy-fetch.mjs:$SCRIPTS_DIR/lib/exchange-proxy-fetch.mjs" \
  "scripts/lib/betbra-client-api.mjs:$SCRIPTS_DIR/lib/betbra-client-api.mjs" \
  "scripts/lib/mexchange-offers.mjs:$SCRIPTS_DIR/lib/mexchange-offers.mjs" \
  "scripts/lib/exchange-orders-adapter.mjs:$SCRIPTS_DIR/lib/exchange-orders-adapter.mjs" \
  "scripts/lib/exchange-orders-service.mjs:$SCRIPTS_DIR/lib/exchange-orders-service.mjs" \
  "scripts/arbishield-serverfn-shim.mjs:$SHIM_DIR/scripts/arbishield-serverfn-shim.mjs"
do
  rel="${pair%%:*}"
  out="${pair#*:}"
  download_repo_file "$rel" "$out"
  echo "  OK $out"
done

for f in exchange-proxy-fetch.mjs betbra-client-api.mjs mexchange-offers.mjs exchange-orders-adapter.mjs exchange-orders-service.mjs; do
  cp -f "$SCRIPTS_DIR/lib/$f" "$SHIM_DIR/scripts/lib/$f" 2>/dev/null || true
  cp -f "$SCRIPTS_DIR/lib/$f" "$SHIM_DIR/lib/$f" 2>/dev/null || true
done
if [[ -f "$SHIM_DIR/arbishield-serverfn-shim.mjs" ]] || [[ -L "$SHIM_DIR/arbishield-serverfn-shim.mjs" ]]; then
  cp -f "$SHIM_DIR/scripts/arbishield-serverfn-shim.mjs" "$SHIM_DIR/arbishield-serverfn-shim.mjs" || true
fi

grep -q 'exchangeFetch' "$SCRIPTS_DIR/lib/betbra-client-api.mjs" || die "betbra-client sem exchangeFetch"
grep -q 'ProxyAgent' "$SCRIPTS_DIR/lib/exchange-proxy-fetch.mjs" || die "exchange-proxy-fetch sem ProxyAgent"
grep -q 'exchangeFetch' "$SCRIPTS_DIR/lib/mexchange-offers.mjs" || die "mexchange-offers sem exchangeFetch"
grep -q 'exchangeFetch' "$SCRIPTS_DIR/lib/exchange-orders-adapter.mjs" || die "adapter sem exchangeFetch"

log "3/4 env → proxy + BetBra (bridge local OFF)"
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
    upsert_env "$f" "EXCHANGE_LOCAL_BRIDGE" "0"
    upsert_env "$f" "EXCHANGE_PROXY_ENABLED" "1"
    if [[ -n "$PROXY_DSN" ]]; then
      upsert_env "$f" "EXCHANGE_PROXY_DSN" "$PROXY_DSN"
    fi
    if [[ -n "$PROXY_URL" ]]; then
      upsert_env "$f" "EXCHANGE_PROXY" "$PROXY_URL"
    fi
    echo "  OK $f"
    n=$((n + 1))
  fi
done
[[ "$n" -gt 0 ]] || die "nenhum .env"

log "4/4 systemd NODE_PATH + restart + smoke IP"
DROP_IN=/etc/systemd/system/arbishield-serverfn-shim.service.d/proxy.conf
mkdir -p "$(dirname "$DROP_IN")"
cat >"$DROP_IN" <<EOF
[Service]
Environment=NODE_PATH=/opt/arbishield/node_modules
Environment=EXCHANGE_PROXY_ENABLED=1
Environment=EXCHANGE_LOCAL_BRIDGE=0
EOF
systemctl daemon-reload || die "daemon-reload falhou"
systemctl restart arbishield-serverfn-shim.service || die "restart shim falhou"
sleep 1
systemctl is-active --quiet arbishield-serverfn-shim.service || die "shim nao active"

SMOKE_ENV=""
[[ -n "$PROXY_DSN" ]] && SMOKE_ENV="EXCHANGE_PROXY_DSN=$PROXY_DSN"
[[ -n "$PROXY_URL" ]] && SMOKE_ENV="EXCHANGE_PROXY=$PROXY_URL"
if [[ -f "$SCRIPTS_DIR/lib/exchange-proxy-fetch.mjs" ]]; then
  (
    export NODE_PATH="/opt/arbishield/node_modules"
    cd /opt/arbishield
    # shellcheck disable=SC2086
    env $SMOKE_ENV EXCHANGE_PROXY_ENABLED=1 NODE_PATH=/opt/arbishield/node_modules \
      node --input-type=module -e "
      import { exchangeFetch, proxyPublicInfo } from '${SCRIPTS_DIR}/lib/exchange-proxy-fetch.mjs';
      const info = proxyPublicInfo();
      console.log('proxy', JSON.stringify(info));
      const r = await exchangeFetch('https://api.ipify.org', { signal: AbortSignal.timeout(20000) });
      const ip = (await r.text()).trim();
      console.log('egress_ip', ip);
      if (!/^\\d+\\.\\d+\\.\\d+\\.\\d+\$/.test(ip)) process.exit(2);
    "
  ) && echo "  smoke OK" || echo "  AVISO: smoke IP falhou — confira DSN/credencial Sticky BR"
fi

echo "OK — BotShield via proxy residencial (bridge local desligado)"
echo "  Conta: https://botshield.arbishield.app/conta-betbra.html  (Ctrl+Shift+R)"
echo "  Atualizar saldo → codigo e-mail se pedir → Testar sessao → accountId"
echo "  PC nao precisa ficar ligado"
