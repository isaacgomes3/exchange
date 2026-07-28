#!/usr/bin/env bash
# Hotfix: busca de times + logos no Lançar Evento Manual (mesma API do desafio)
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/manual-evento-escudo-times-bb44/scripts/vps-hotfix-times-busca-logo.sh?v=6")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/manual-evento-escudo-times-bb44}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield}"
NGINX_SITE="${ARBISHIELD_NGINX_SITE:-/etc/nginx/sites-available/arbishield.app}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$SCRIPTS_DIR"

log "v2.js (ArbiV2.searchFootballTeams + fallback TheSportsDB)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/v2.js" -o "$WEB/v2.js"
chmod 0644 "$WEB/v2.js"
cp -f "$WEB/v2.js" "$WEB_ROOT/v2.js" 2>/dev/null || true
grep -q 'searchFootballTeams' "$WEB/v2.js" || die "v2.js sem searchFootballTeams"

log "UI Admin Jogos (busca de times + logos, fallback TheSportsDB)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/admin-jogos.html" -o "$WEB/admin-jogos.html"
chmod 0644 "$WEB/admin-jogos.html"
cp -f "$WEB/admin-jogos.html" "$WEB_ROOT/admin-jogos.html" 2>/dev/null || true
cp -f "$WEB/admin-jogos.html" "$WEB_ROOT/admin-jogos-vps.html" 2>/dev/null || true

grep -q 'positionTeamSuggest' "$WEB/admin-jogos.html" || die "HTML sem positionTeamSuggest"
grep -q 'fetchTeamsForPicker' "$WEB/admin-jogos.html" || die "HTML sem fetchTeamsForPicker"
grep -q 'Lançar manual' "$WEB/admin-jogos.html" || die "HTML sem Lançar manual"
! grep -q 'Lançar jogo (BetBra)' "$WEB/admin-jogos.html" || die "HTML ainda tem botão BetBra"

log "UI Proteger (exibe logos)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/app-proteger.html" -o "$WEB/app-proteger.html"
chmod 0644 "$WEB/app-proteger.html"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/v2.css" -o "$WEB/v2.css"
chmod 0644 "$WEB/v2.css"
grep -q 'home_logo' "$WEB/app-proteger.html" || die "proteger sem home_logo"
grep -q 'term-team-logo' "$WEB/v2.css" || die "v2.css sem term-team-logo"

log "Prelive API (endpoint /football-teams)"
curl -fsSL "$RAW/scripts/arbishield-prelive-events.mjs" -o "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
chmod 0755 "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
grep -q 'searchFootballTeams' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" || die "prelive sem searchFootballTeams"
grep -q '/api/arbishield/football-teams' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" || die "prelive sem rota football-teams"
systemctl restart arbishield-prelive-events.service 2>/dev/null || true

if [[ -f "$NGINX_SITE" ]]; then
  if ! grep -q 'football-teams' "$NGINX_SITE"; then
    log "Nginx: inserindo location football-teams"
    python3 - <<'PY' "$NGINX_SITE"
import pathlib, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text()
needle = """    location /api/arbishield/prelive-events {
        proxy_pass http://127.0.0.1:3098;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_read_timeout 120s;
    }
"""
block = """    location /api/arbishield/prelive-events {
        proxy_pass http://127.0.0.1:3098;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_read_timeout 120s;
    }

    location /api/arbishield/football-teams {
        proxy_pass http://127.0.0.1:3098;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_read_timeout 30s;
    }
"""
if needle not in text:
    raise SystemExit("bloco prelive-events não encontrado no nginx")
path.write_text(text.replace(needle, block, 1))
print("nginx atualizado")
PY
    nginx -t
    systemctl reload nginx
  else
    log "Nginx já tem football-teams"
  fi
else
  log "Nginx site não encontrado em $NGINX_SITE — aplique o conf do repo manualmente"
fi

echo
echo "OK — busca de times com logo (fallback TheSportsDB se API offline)"
echo "  https://arbishield.app/admin-jogos.html  (Ctrl+F5)"
echo "  Lançar manual → digite o time → escolha na lista (logo auto)"
echo "  Teste API: curl -s 'https://arbishield.app/api/arbishield/football-teams?q=Flamengo' | head"
echo "  (Se API retornar not_found, o frontend ainda busca via TheSportsDB)"
