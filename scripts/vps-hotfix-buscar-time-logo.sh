#!/usr/bin/env bash
# Corrige Buscar time + logo + autocomplete de mercados no Lançar Evento Manual
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-buscar-time-logo.sh")
set -euo pipefail
REF="${ARBISHIELD_REF:-bdb12eb}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT" "$SCRIPTS_DIR"

dl() {
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$RAW/$1?v=$BUST" -o "$2"
}

log "1/3 UI admin-jogos (Buscar time + logo + catálogo mercados)"
for f in admin-jogos.html market-catalog.js; do
  dl "deploy/vps-supabase/static/v2/$f" "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
done
# espelho legado se existir
if [[ -d "$WEB_ROOT" ]]; then
  dl "deploy/vps-supabase/static/admin-jogos-vps.html" "$WEB_ROOT/admin-jogos-vps.html" 2>/dev/null || true
fi
grep -q 'football-teams\|bindTeamPicker\|Buscar time' "$WEB/admin-jogos.html" \
  || die "admin-jogos sem busca de time"
grep -q 'bindMarketNamePicker\|market-suggest\|ARBISHIELD_MARKET_CATALOG' "$WEB/admin-jogos.html" \
  || die "admin-jogos sem autocomplete de mercados"
grep -q 'ARBISHIELD_MARKET_CATALOG' "$WEB/market-catalog.js" \
  || die "market-catalog.js ausente"

log "2/3 Backend prelive (API /football-teams)"
PRELIVE_DST="$SCRIPTS_DIR/arbishield-prelive-events.mjs"
[[ -f /opt/arbishield/scripts/arbishield-prelive-events.mjs ]] && \
  PRELIVE_DST="/opt/arbishield/scripts/arbishield-prelive-events.mjs"
dl "scripts/arbishield-prelive-events.mjs" "$PRELIVE_DST"
chmod 0755 "$PRELIVE_DST"
grep -q 'searchFootballTeams\|/api/arbishield/football-teams' "$PRELIVE_DST" \
  || die "prelive sem endpoint football-teams"
systemctl restart arbishield-prelive-events.service 2>/dev/null || \
  systemctl restart arbishield-prelive.service 2>/dev/null || true

log "3/3 Nginx — /api/arbishield/football-teams → :3098"
for conf in /etc/nginx/sites-enabled/arbishield.app \
  /etc/nginx/conf.d/arbishield.app.conf \
  /etc/nginx/sites-available/arbishield.app; do
  [[ -f "$conf" ]] || continue
  if ! grep -q 'location = /api/arbishield/football-teams' "$conf"; then
    if grep -q 'location = /api/arbishield/matches' "$conf"; then
      # inserir após o bloco matches (aprox.)
      awk '
        /location = \/api\/arbishield\/matches \{/ {inb=1}
        inb && /^\s*\}/ && !done {
          print
          print ""
          print "    location = /api/arbishield/football-teams {"
          print "        proxy_pass http://127.0.0.1:3098;"
          print "        proxy_http_version 1.1;"
          print "        proxy_set_header Host $host;"
          print "        proxy_set_header Authorization $http_authorization;"
          print "        proxy_read_timeout 60s;"
          print "    }"
          inb=0; done=1; next
        }
        {print}
      ' "$conf" > "$conf.tmp" && mv "$conf.tmp" "$conf"
    fi
  fi
  echo "checked $conf"
done
if command -v nginx >/dev/null && nginx -t 2>/dev/null; then
  systemctl reload nginx 2>/dev/null || true
fi

echo
echo "OK — Buscar time/logo + autocomplete de mercados"
echo "  Teste: https://arbishield.app/api/arbishield/football-teams?q=Flamengo"
echo "  Admin: https://arbishield.app/admin/matches  (Ctrl+Shift+R)"
