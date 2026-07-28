#!/usr/bin/env bash
# Hotfix: Salvar proteção (Proteger Aposta) — nginx 405 → :3098
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-salvar-protecao-723d/scripts/vps-hotfix-salvar-protecao.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/fix-salvar-protecao-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
need python3
mkdir -p "$WEB" "$SCRIPTS_DIR"

insert_after_location() {
  local conf="$1"
  local after_loc="$2"   # e.g. location = /api/arbishield/matches
  local new_loc="$3"     # e.g. location = /api/arbishield/protections
  local block="$4"
  [[ -f "$conf" ]] || return 0
  if grep -qF "$new_loc" "$conf"; then
    echo "  ok $new_loc · $conf"
    return 0
  fi
  AFTER_LOC="$after_loc" NEW_LOC="$new_loc" BLOCK="$block" python3 - "$conf" <<'PY'
import os, sys
path = sys.argv[1]
after = os.environ["AFTER_LOC"]
needle = os.environ["NEW_LOC"]
block = os.environ["BLOCK"].strip("\n") + "\n\n"
text = open(path, encoding="utf-8", errors="replace").read()
if needle in text:
    print("already", path)
    raise SystemExit(0)
idx = text.find(after)
if idx < 0:
    # try protections as anchor for create-protection
    for alt in (
        "location = /api/arbishield/protections",
        "location = /api/arbishield/matches",
        "location /api/arbishield/prelive-events",
    ):
        idx = text.find(alt)
        if idx >= 0:
            after = alt
            break
if idx < 0:
    print("skip (sem âncora):", path)
    raise SystemExit(0)
brace = text.find("{", idx)
depth = 0
end = None
for i, ch in enumerate(text[brace:], brace):
    if ch == "{":
        depth += 1
    elif ch == "}":
        depth -= 1
        if depth == 0:
            end = i + 1
            break
if end is None:
    print("skip (bloco inválido):", path)
    raise SystemExit(0)
j = end
while j < len(text) and text[j] in " \t\r":
    j += 1
if j < len(text) and text[j] == "\n":
    j += 1
open(path, "w", encoding="utf-8").write(text[:j] + block + text[j:])
print("patched", needle, "→", path)
PY
}

BLOCK_PROTECTIONS='    location = /api/arbishield/protections {
        proxy_pass http://127.0.0.1:3098;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_read_timeout 60s;
    }'

BLOCK_CREATE='    location = /api/arbishield/create-protection {
        proxy_pass http://127.0.0.1:3098;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_read_timeout 60s;
    }'

log "UI Proteger Aposta"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/app-proteger.html" -o "$WEB/app-proteger.html"
chmod 0644 "$WEB/app-proteger.html"
cp -f "$WEB/app-proteger.html" "$WEB_ROOT/app-proteger.html" 2>/dev/null || true
grep -q 'create-protection' "$WEB/app-proteger.html" || die "HTML sem fallback create-protection"

log "Prelive :3098 (createProtection + alias)"
curl -fsSL "$RAW/scripts/arbishield-prelive-events.mjs" -o "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
chmod 0755 "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
grep -q 'create-protection' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" || die "prelive sem alias create-protection"
systemctl restart arbishield-prelive-events.service 2>/dev/null || true

log "Nginx /protections + /create-protection → :3098"
for conf in \
  /etc/nginx/conf.d/arbishield-cutover.conf \
  /etc/nginx/conf.d/arbishield.app.conf \
  /etc/nginx/sites-enabled/arbishield.app \
  /etc/nginx/sites-enabled/arbishield \
  /etc/nginx/sites-available/arbishield.app
do
  [[ -f "$conf" ]] || continue
  insert_after_location "$conf" "location = /api/arbishield/matches" \
    "location = /api/arbishield/protections" "$BLOCK_PROTECTIONS"
  insert_after_location "$conf" "location = /api/arbishield/protections" \
    "location = /api/arbishield/create-protection" "$BLOCK_CREATE"
done

if command -v nginx >/dev/null 2>&1; then
  nginx -t && systemctl reload nginx || die "nginx -t/reload falhou"
fi

sleep 1
log "Smoke"
CODE=$(curl -sS -o /tmp/prot-smoke.json -w "%{http_code}" -X POST http://127.0.0.1:3098/api/arbishield/protections \
  -H 'Content-Type: application/json' -d '{"matchId":"x","amountCents":100,"odd":1.5}' || echo 000)
echo "  local :3098 protections HTTP $CODE (espera 401)"
[[ "$CODE" == "401" ]] || die "prelive não aceita POST /protections (HTTP $CODE)"

EXT=$(curl -sS -o /tmp/prot-ext.json -w "%{http_code}" -X POST https://127.0.0.1/api/arbishield/protections \
  -H 'Host: arbishield.app' -H 'Content-Type: application/json' \
  -d '{"matchId":"x","amountCents":100,"odd":1.5}' --insecure 2>/dev/null || \
  curl -sS -o /tmp/prot-ext.json -w "%{http_code}" -X POST http://127.0.0.1/api/arbishield/protections \
  -H 'Host: arbishield.app' -H 'Content-Type: application/json' \
  -d '{"matchId":"x","amountCents":100,"odd":1.5}' || echo 000)
echo "  via nginx local /protections HTTP $EXT (espera 401, NÃO 405)"
[[ "$EXT" != "405" ]] || die "nginx ainda responde 405 em /protections"
head -c 220 /tmp/prot-ext.json; echo

echo
echo "OK — salvar proteção"
echo "  https://arbishield.app/app-proteger.html  (Ctrl+F5)"
echo "  POST /api/arbishield/protections → :3098"
