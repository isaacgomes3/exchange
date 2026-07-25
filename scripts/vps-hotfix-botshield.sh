#!/usr/bin/env bash
# Atualiza só os arquivos do painel BotShield (UI).
# Se o site nginx ainda não existir, rode vps-enable-botshield.sh antes.
#
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-botshield.sh?ref=cursor/botshield-painel-e85c&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/botshield-painel-e85c}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${BOTSHIELD_WEB:-/var/www/arbishield-botshield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl

fetch() {
  local path="$1" out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/${path}?ref=${REF}&t=$(date +%s%N)" -o "$out" \
    && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    "$RAW/${path}?t=$(date +%s%N)" -o "$out"
  [[ -s "$out" ]]
}

echo "==> vps-hotfix-botshield.sh ($(date -Is)) ref=$REF"
mkdir -p "$WEB_ROOT"
tmpd="$(mktemp -d)"
n=0
for f in \
  index.html auth.html bots.html criar.html modelos.html ordens.html integracoes.html \
  conta-betbra.html botshield.css botshield.js botshield-shell.js; do
  fetch "deploy/vps-supabase/static/botshield/$f" "$tmpd/$f" || die "falha $f"
  cp -f "$tmpd/$f" "$WEB_ROOT/$f"
  chmod 0644 "$WEB_ROOT/$f"
  echo "  OK $f"
  n=$((n + 1))
done
rm -rf "$tmpd"

grep -q 'data-active="bots"' "$WEB_ROOT/bots.html" || die "bots.html sem marker"
grep -q 'conta-betbra' "$WEB_ROOT/botshield-shell.js" || die "nav sem Conta BetBra"
grep -q 'botshield.arbishield.app' "$WEB_ROOT/botshield.js" || die "host check ausente"

# API: login/senha BetBra + status (shim + service)
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield/scripts}"
[[ -d /opt/arbishield/scripts ]] || SHIM_DIR="/var/www/arbishield/scripts"
mkdir -p "$SHIM_DIR/lib"
fetch "scripts/lib/exchange-orders-service.mjs" "$SHIM_DIR/lib/exchange-orders-service.mjs" \
  || echo "  AVISO: service orders não atualizado"
fetch "scripts/lib/exchange-orders-adapter.mjs" "$SHIM_DIR/lib/exchange-orders-adapter.mjs" \
  || true
fetch "scripts/lib/exchange-orders-contract.mjs" "$SHIM_DIR/lib/exchange-orders-contract.mjs" \
  || true
if [[ -f "$SHIM_DIR/arbishield-serverfn-shim.mjs" ]] || fetch "scripts/arbishield-serverfn-shim.mjs" "$SHIM_DIR/arbishield-serverfn-shim.mjs"; then
  grep -q 'exchange-session/status' "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
    && echo "  OK shim com exchange-session/status" \
    || echo "  AVISO: shim sem status — rode hotfix exchange-orders"
  systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
fi

# nginx: inclui exchange-session/status
tmpc="$(mktemp)"
if [[ -f /etc/letsencrypt/live/botshield.arbishield.app/fullchain.pem ]] \
  && fetch "deploy/vps-supabase/nginx-botshield.arbishield.app.conf" "$tmpc"; then
  if [[ -d /etc/nginx/sites-available ]]; then
    cp -f "$tmpc" /etc/nginx/sites-available/botshield.arbishield.app
    ln -sfn /etc/nginx/sites-available/botshield.arbishield.app \
      /etc/nginx/sites-enabled/botshield.arbishield.app 2>/dev/null || true
  else
    cp -f "$tmpc" /etc/nginx/conf.d/botshield.arbishield.app.conf
  fi
  nginx -t && (systemctl reload nginx || true)
  echo "  OK nginx botshield (status path)"
fi
rm -f "$tmpc"

echo ""
echo "OK ($n arquivos UI). Conta BetBra: https://botshield.arbishield.app/conta-betbra.html"
echo "Hard refresh. Sem entrada no menu de clientes/admin."
