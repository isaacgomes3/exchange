#!/usr/bin/env bash
# Liga EXCHANGE_ORDERS_LIVE=1 + provider=betbra no shim (produção).
#
# Na VPS (root):
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-enable-exchange-orders-live.sh?ref=cursor/botshield-painel-e85c&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
#
# Desligar: LIVE=0 bash <(curl ...)
set -euo pipefail

LIVE="${LIVE:-1}"
PROVIDER="${EXCHANGE_ORDERS_PROVIDER:-betbra}"
ENV_FILES=(
  /opt/arbishield/deploy/vps-supabase/.env
  /opt/arbishield/.arbishield-odds-sync.env
  /opt/arbishield/.env
)

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }

upsert_env() {
  local file="$1" key="$2" val="$3"
  mkdir -p "$(dirname "$file")"
  touch "$file"
  if grep -qE "^${key}=" "$file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$file"
  else
    printf '\n%s=%s\n' "$key" "$val" >>"$file"
  fi
  # remove duplicatas deixando a última
  awk -F= -v k="$key" '
    $1==k { last=$0; next }
    { print }
    END { if (last!="") print last }
  ' "$file" >"${file}.tmp" && mv "${file}.tmp" "$file"
}

echo "==> vps-enable-exchange-orders-live.sh ($(date -Is)) LIVE=$LIVE PROVIDER=$PROVIDER"

log "1/3 gravar env"
n=0
for f in "${ENV_FILES[@]}"; do
  if [[ -f "$f" ]] || [[ "$f" == /opt/arbishield/deploy/vps-supabase/.env ]]; then
    upsert_env "$f" "EXCHANGE_ORDERS_LIVE" "$LIVE"
    upsert_env "$f" "EXCHANGE_ORDERS_PROVIDER" "$PROVIDER"
    echo "  OK $f"
    n=$((n + 1))
    grep -E '^EXCHANGE_ORDERS_(LIVE|PROVIDER)=' "$f" || true
  fi
done
[[ "$n" -gt 0 ]] || die "nenhum .env encontrado em /opt/arbishield"

log "2/3 restart shim"
systemctl daemon-reload 2>/dev/null || true
systemctl restart arbishield-serverfn-shim.service || die "restart shim falhou"
systemctl restart arbishield-serverfn-shim-teste.service 2>/dev/null || true
sleep 1
systemctl is-active --quiet arbishield-serverfn-shim.service || {
  journalctl -u arbishield-serverfn-shim.service -n 40 --no-pager || true
  die "shim não está active"
}
echo "  shim active"

log "3/3 conferir processo"
# best-effort: env do unit
systemctl show arbishield-serverfn-shim.service -p EnvironmentFiles --no-pager 2>/dev/null || true
if [[ "$LIVE" == "1" || "$LIVE" == "true" ]]; then
  echo ""
  echo "OK — LIVE LIGADO"
  echo "  EXCHANGE_ORDERS_LIVE=$LIVE"
  echo "  EXCHANGE_ORDERS_PROVIDER=$PROVIDER"
  echo "  Place real exige sessão BetBra salva no BotShield (Conta BetBra)."
  echo "  Teste: https://botshield.arbishield.app/integracoes.html → modo BetBra"
else
  echo ""
  echo "OK — LIVE DESLIGADO (demo)"
fi
