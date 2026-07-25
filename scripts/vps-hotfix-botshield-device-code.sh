#!/usr/bin/env bash
# BotShield: campo para codigo de novo dispositivo (e-mail BetBra).
#
# Na VPS (root):
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-botshield-device-code.sh?ref=cursor/botshield-device-code-e85c&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/botshield-device-code-e85c}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"
WEB="${BOTSHIELD_WEB:-/var/www/arbishield-botshield}"

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

echo "==> vps-hotfix-botshield-device-code.sh ($(date -Is)) ref=$REF"
log "1/2 baixar libs + shim + Conta BetBra"
for pair in \
  "scripts/lib/betbra-client-api.mjs:$SCRIPTS_DIR/lib/betbra-client-api.mjs" \
  "scripts/lib/exchange-orders-service.mjs:$SCRIPTS_DIR/lib/exchange-orders-service.mjs" \
  "scripts/arbishield-serverfn-shim.mjs:$SHIM_DIR/scripts/arbishield-serverfn-shim.mjs" \
  "deploy/vps-supabase/static/botshield/conta-betbra.html:$WEB/conta-betbra.html"
do
  rel="${pair%%:*}"
  out="${pair#*:}"
  download_repo_file "$rel" "$out"
  echo "  OK $out"
done

for f in betbra-client-api.mjs exchange-orders-service.mjs; do
  cp -f "$SCRIPTS_DIR/lib/$f" "$SHIM_DIR/scripts/lib/$f" 2>/dev/null || true
  cp -f "$SCRIPTS_DIR/lib/$f" "$SHIM_DIR/lib/$f" 2>/dev/null || true
done
if [[ -f "$SHIM_DIR/arbishield-serverfn-shim.mjs" ]] || [[ -L "$SHIM_DIR/arbishield-serverfn-shim.mjs" ]]; then
  cp -f "$SHIM_DIR/scripts/arbishield-serverfn-shim.mjs" "$SHIM_DIR/arbishield-serverfn-shim.mjs" || true
fi

grep -q 'validationCode' "$SCRIPTS_DIR/lib/betbra-client-api.mjs" || die "betbra-client-api sem validationCode"
grep -q 'BETBRA_DEVICE_VALIDATION' "$SCRIPTS_DIR/lib/betbra-client-api.mjs" || die "sem BETBRA_DEVICE_VALIDATION"
grep -q 'validationCode' "$SCRIPTS_DIR/lib/exchange-orders-service.mjs" || die "service sem validationCode"
grep -q 'btnDeviceCode' "$WEB/conta-betbra.html" || die "UI sem btnDeviceCode"
grep -q 'validationCode' "$SHIM_DIR/scripts/arbishield-serverfn-shim.mjs" || die "shim sem validationCode no balance"

log "2/2 restart shim"
systemctl restart arbishield-serverfn-shim.service || die "restart shim falhou"
sleep 1
systemctl is-active --quiet arbishield-serverfn-shim.service || die "shim nao active"

echo "OK — Conta BetBra aceita codigo do e-mail."
echo "  1) https://botshield.arbishield.app/conta-betbra.html  (Ctrl+Shift+R)"
echo "  2) Cole o codigo do e-mail BetBra"
echo "  3) Enviar codigo e atualizar saldo"
echo "  4) Testar sessao → accountId"
echo "  Se o codigo expirou: clique Atualizar saldo para gerar outro e-mail"
