#!/usr/bin/env bash
# Hotfix: busca de times + logos (fallback TheSportsDB + nginx/API)
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-visual-disponivel-6aef/scripts/vps-hotfix-times-busca-logo.sh?v=4")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/desafio-visual-disponivel-6aef}"
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

log "v2.js (busca de times com fallback TheSportsDB)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/v2.js" -o "$WEB/v2.js"
chmod 0644 "$WEB/v2.js"
cp -f "$WEB/v2.js" "$WEB_ROOT/v2.js" 2>/dev/null || true
grep -q 'searchFootballTeams' "$WEB/v2.js" || die "v2.js sem searchFootballTeams"
grep -q 'thesportsdb.com' "$WEB/v2.js" || die "v2.js sem fallback TheSportsDB"

log "UI Admin Jogos (busca de times + logos)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/admin-jogos.html" -o "$WEB/admin-jogos.html"
chmod 0644 "$WEB/admin-jogos.html"
cp -f "$WEB/admin-jogos.html" "$WEB_ROOT/admin-jogos.html" 2>/dev/null || true
grep -q 'searchFootballTeams' "$WEB/admin-jogos.html" || die "HTML sem searchFootballTeams"
grep -q 'manHomeSuggest' "$WEB/admin-jogos.html" || die "HTML sem manHomeSuggest"
grep -q 'v2.js?v=teams-search' "$WEB/admin-jogos.html" || die "HTML sem v2.js cache-bust"

log "UI Desafio (logos automáticas)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/app-desafio.html" -o "$WEB/app-desafio.html"
chmod 0644 "$WEB/app-desafio.html"
grep -q 'searchFootballTeams' "$WEB/app-desafio.html" || die "desafio sem searchFootballTeams"

log "UI Proteger + CSS"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/app-proteger.html" -o "$WEB/app-proteger.html"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/v2.css" -o "$WEB/v2.css"
chmod 0644 "$WEB/app-proteger.html" "$WEB/v2.css"
cp -f "$WEB/v2.css" "$WEB_ROOT/v2.css" 2>/dev/null || true

log "Prelive API (endpoint /football-teams)"
curl -fsSL "$RAW/scripts/arbishield-prelive-events.mjs" -o "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
chmod 0755 "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
grep -q 'searchFootballTeams' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" || die "prelive sem searchFootballTeams"
grep -q '/api/arbishield/football-teams' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" || die "prelive sem rota football-teams"
systemctl restart arbishield-prelive-events.service 2>/dev/null || true

ensure_nginx_location() {
  local conf="$1"
  [[ -f "$conf" ]] || return 0
  if grep -q 'football-teams' "$conf"; then
    log "Nginx já tem football-teams em $conf"
    return 0
  fi
  log "Nginx: inserindo location football-teams em $conf"
  python3 - "$conf" <<'PY'
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
    # tentativa mais flexível
    import re
    m = re.search(r"location /api/arbishield/prelive-events \{[\s\S]*?\n    \}", text)
    if not m:
        raise SystemExit(f"bloco prelive-events não encontrado em {path}")
    insert = m.group(0) + """

    location /api/arbishield/football-teams {
        proxy_pass http://127.0.0.1:3098;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_read_timeout 30s;
    }"""
    text = text[:m.start()] + insert + text[m.end():]
else:
    text = text.replace(needle, block, 1)
path.write_text(text)
print("nginx atualizado:", path)
PY
}

ensure_nginx_location "$NGINX_SITE"
ensure_nginx_location "/etc/nginx/sites-enabled/arbishield.app"
ensure_nginx_location "/etc/nginx/conf.d/arbishield.app.conf"

if command -v nginx >/dev/null; then
  nginx -t && systemctl reload nginx
fi

echo
echo "OK — busca de times com logo"
echo "  Teste API: curl -s 'https://arbishield.app/api/arbishield/football-teams?q=Flamengo' | head"
echo "  (mesmo sem API, o browser usa fallback TheSportsDB)"
echo "  https://arbishield.app/admin-jogos.html  (Ctrl+F5)"
echo "  https://arbishield.app/app-desafio.html  (Ctrl+F5)"
