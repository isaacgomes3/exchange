#!/usr/bin/env bash
# Hotfix v6: Contestação cliente (Supabase direto + prelive) + ADM
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/contestacao-aposta-completa-723d/scripts/vps-hotfix-contestacao-aposta.sh?v=6")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/contestacao-aposta-completa-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS_DIR:-/opt/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$SHIM_DIR" "$SCRIPTS_DIR"

log "Prelive :3098 (contest_submit/list/approve/reject em /api/arbishield/protections)"
curl -fsSL "$RAW/scripts/arbishield-prelive-events.mjs" -o "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
chmod 0755 "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
grep -q 'contest_submit\|contestSubmit\|contestList' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" || \
  die "prelive sem handlers de contestação"
if systemctl is-active --quiet arbishield-prelive-events.service 2>/dev/null; then
  systemctl restart arbishield-prelive-events.service
  echo "  prelive reiniciado"
else
  echo "AVISO: arbishield-prelive-events inativo" >&2
fi

log "Shim :3101 (fallback + patch sem updated_at)"
curl -fsSL "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
grep -q 'patchProtectionSafe\|CONTESTATION_SUBMIT' "$SHIM_DIR/arbishield-serverfn-shim.mjs" || \
  die "shim sem contestação"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
sleep 1

log "UI cliente + admin"
for f in app-protecoes.html admin-contestations.html v2-shell.js; do
  curl -fsSL "$RAW/deploy/vps-supabase/static/v2/$f" -o "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
  echo "  ok $f"
done
grep -q 'submitViaSupabase' "$WEB/app-protecoes.html" || die "cliente sem submitViaSupabase (v6)"
grep -q 'contest_submit\|action: "contest_submit"' "$WEB/app-protecoes.html" || die "cliente sem contest_submit"
grep -q 'loadFromSupabase' "$WEB/admin-contestations.html" || die "admin sem loadFromSupabase"
grep -q 'contest_list\|action: "contest_list"' "$WEB/admin-contestations.html" || die "admin sem contest_list"

# nginx contestations (opcional; primary usa /protections)
NGINX_CONF=""
for c in /etc/nginx/sites-enabled/arbishield.app \
         /etc/nginx/conf.d/arbishield.app.conf \
         /etc/nginx/sites-available/arbishield.app; do
  if [[ -f "$c" ]]; then NGINX_CONF="$c"; break; fi
done
if [[ -n "$NGINX_CONF" ]] && ! grep -q 'location ^~ /api/arbishield/contestations' "$NGINX_CONF"; then
  log "Inserir location contestations no nginx (opcional)"
  python3 - <<'PY' "$NGINX_CONF"
import sys
path = sys.argv[1]
text = open(path).read()
block = """
    location ^~ /api/arbishield/contestations {
        proxy_pass http://127.0.0.1:3101;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_pass_request_headers on;
        proxy_read_timeout 120s;
    }
"""
if "location ^~ /api/arbishield/contestations" not in text:
    anchor = "location ^~ /_serverFn/"
    if anchor in text:
        text = text.replace(anchor, block + "\n    " + anchor, 1)
        open(path, "w").write(text)
        print("nginx patched")
PY
  nginx -t >/dev/null 2>&1 && systemctl reload nginx 2>/dev/null || true
fi

log "Sanity :3098 contest_list sem token → 401 (não pode ser matchId)"
code="$(curl -sS -o /tmp/contest-sanity.json -w '%{http_code}' -X POST \
  http://127.0.0.1:3098/api/arbishield/protections \
  -H 'Content-Type: application/json' \
  -d '{"action":"contest_list"}' || true)"
body="$(head -c 200 /tmp/contest-sanity.json 2>/dev/null || true)"
echo "  HTTP $code $body"
if echo "$body" | grep -qi 'matchId'; then
  die "prelive AINDA antigo (contest_list → matchId). Reinicie arbishield-prelive-events."
fi
echo "$code" | grep -qE '401|403|200' || echo "AVISO: prelive não respondeu contest_list" >&2

echo
echo "OK — Contestação v6"
echo "  • Cliente grava review_odd direto no Supabase (não depende do prelive)"
echo "  • ADM lista via contest_list (:3098) ou fallback Supabase"
echo "  1) Ctrl+F5 em /app-protecoes.html"
echo "  2) Contestar de novo (envios antigos que falharam NÃO existem no banco)"
echo "  3) Ctrl+F5 em /admin-contestations.html → Atualizar"
