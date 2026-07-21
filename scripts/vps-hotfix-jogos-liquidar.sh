#!/usr/bin/env bash
# Hotfix: Admin Jogos lista jogos do Monitor + Encerrar partida (placar).
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/arbishield-v2-backup-723d/scripts/vps-hotfix-jogos-liquidar.sh?v=1")
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

log "UI Admin Jogos (A liquidar + Encerrar partida)"
for f in admin-jogos.html v2.css v2-shell.js; do
  curl -fsSL "$RAW/deploy/vps-supabase/static/v2/$f" -o "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
  echo "  ok $f"
done

log "Shim (match-settle)"
if [[ -d "$SHIM_DIR" ]]; then
  curl -fsSL "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
  chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
  systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
  echo "  ok shim"
fi

# nginx: adiciona match-settle se faltar
for conf in \
  /etc/nginx/conf.d/arbishield-cutover.conf \
  /etc/nginx/conf.d/arbishield.app.conf \
  /etc/nginx/sites-enabled/arbishield.app \
  /etc/nginx/sites-enabled/arbishield
do
  [[ -f "$conf" ]] || continue
  if grep -q 'match-settle' "$conf"; then
    echo "  nginx já ok $conf"
    continue
  fi
  if grep -q 'protection-cancel' "$conf"; then
    sed -i 's/protection-cancel)/protection-cancel|match-settle)/' "$conf" || true
    echo "  nginx patched $conf"
  elif grep -q 'affiliate-withdraw)' "$conf"; then
    sed -i 's/affiliate-withdraw)/affiliate-withdraw|protection-close|protection-cancel|match-settle)/' "$conf" || true
    echo "  nginx patched $conf"
  fi
done

if command -v nginx >/dev/null 2>&1; then
  nginx -t && systemctl reload nginx || true
fi

grep -q 'A liquidar\|match-settle\|Encerrar partida' "$WEB/admin-jogos.html" || die "HTML inválido"
grep -q 'match-settle\|settleMatch\|MATCH_SETTLE_SINGLE' "$SHIM_DIR/arbishield-serverfn-shim.mjs" 2>/dev/null || \
  grep -q 'match-settle\|settleMatch\|MATCH_SETTLE_SINGLE' /opt/arbishield/arbishield-serverfn-shim.mjs 2>/dev/null || \
  true

echo
echo "OK — Admin Jogos com A liquidar"
echo "  https://arbishield.app/admin-jogos.html"
echo "  Aba: Eventos ArbiShield (liquidar) → A liquidar → Encerrar partida"
echo "  API: POST /api/arbishield/match-settle"
