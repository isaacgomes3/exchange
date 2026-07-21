#!/usr/bin/env bash
# Hotfix: Admin Jogos — Encerrar partida (onde bateu + valores) + API match-settle
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/arbishield-v2-backup-723d/scripts/vps-hotfix-jogos-liquidar.sh?v=3")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/arbishield-v2-backup-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB"

log "UI Admin Jogos (onde bateu + reembolso/dedução)"
for f in admin-jogos.html v2.css v2-shell.js; do
  curl -fsSL "$RAW/deploy/vps-supabase/static/v2/$f" -o "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
  echo "  ok $f"
done

log "Shim (match-settle + hashes SPA)"
if [[ -d "$SHIM_DIR" ]]; then
  curl -fsSL "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
  chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
  systemctl restart arbishield-serverfn-shim.service 2>/dev/null || \
    systemctl restart arbishield-shim.service 2>/dev/null || \
    (pkill -f arbishield-serverfn-shim || true; nohup node "$SHIM_DIR/arbishield-serverfn-shim.mjs" >/var/log/arbishield-shim.log 2>&1 &)
  sleep 1
  echo "  ok shim"
fi

patch_nginx() {
  local conf="$1"
  [[ -f "$conf" ]] || return 0
  local changed=0

  if grep -q 'match-settle' "$conf"; then
    echo "  nginx já tem match-settle: $conf"
  elif grep -q 'protection-cancel' "$conf"; then
    sed -i 's/protection-cancel)/protection-cancel|match-settle)/g' "$conf" || true
    changed=1
    echo "  nginx +match-settle (regex): $conf"
  elif grep -q 'affiliate-withdraw)' "$conf"; then
    sed -i 's/affiliate-withdraw)/affiliate-withdraw|protection-close|protection-cancel|match-settle)/g' "$conf" || true
    changed=1
    echo "  nginx +match-settle (regex via affiliate): $conf"
  fi

  if ! grep -q 'location = /api/arbishield/match-settle' "$conf"; then
    # Insere location exact antes do bloco desafio-suggestions ou após o regex do shim
    if grep -q 'location /api/arbishield/desafio-suggestions' "$conf"; then
      sed -i '/location \/api\/arbishield\/desafio-suggestions/i\    location = /api/arbishield/match-settle {\n        proxy_pass http://127.0.0.1:3101;\n        proxy_http_version 1.1;\n        proxy_set_header Host $host;\n        proxy_set_header Authorization $http_authorization;\n        proxy_pass_request_headers on;\n        proxy_read_timeout 120s;\n    }\n' "$conf" || true
      changed=1
      echo "  nginx +location exact match-settle: $conf"
    fi
  fi

  return 0
}

log "Nginx (match-settle → :3101)"
for conf in \
  /etc/nginx/conf.d/arbishield-cutover.conf \
  /etc/nginx/conf.d/arbishield.app.conf \
  /etc/nginx/sites-enabled/arbishield.app \
  /etc/nginx/sites-enabled/arbishield \
  /etc/nginx/sites-available/arbishield.app \
  /etc/nginx/conf.d/default.conf
do
  patch_nginx "$conf" || true
done

# Copia conf do repo se existir path conhecido
if [[ -d /opt/arbishield/deploy/vps-supabase ]]; then
  curl -fsSL "$RAW/deploy/vps-supabase/nginx-arbishield.app.conf" \
    -o /tmp/nginx-arbishield.app.conf.new || true
fi

if command -v nginx >/dev/null 2>&1; then
  nginx -t && systemctl reload nginx || true
fi

grep -q 'BATEU ARBISHIELD\|match-settle\|settleRefundHint' "$WEB/admin-jogos.html" || die "HTML inválido"
grep -q 'MATCH_SETTLE_SINGLE\|settleMatch\|match-settle' "$SHIM_DIR/arbishield-serverfn-shim.mjs" 2>/dev/null || \
  die "Shim sem match-settle"

# smoke local
if curl -fsS -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:3101/api/arbishield/match-settle \
  -H 'Content-Type: application/json' -d '{}' | grep -Eq '400|401|200'; then
  echo "  smoke shim match-settle OK (responde)"
else
  echo "  AVISO: shim local não respondeu em :3101 — confira systemctl status arbishield-serverfn-shim"
fi

echo
echo "OK — Encerrar partida com onde bateu"
echo "  https://arbishield.app/admin-jogos.html"
echo "  Aba Encerrar / Eventos ArbiShield → A liquidar → Encerrar partida"
echo "  Escolha: Bateu ArbiShield (reembolso) ou Casa externa (dedução)"
echo "  API: POST /api/arbishield/match-settle  |  fallback /_serverFn/<hash>"
