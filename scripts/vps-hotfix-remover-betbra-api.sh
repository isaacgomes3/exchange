#!/usr/bin/env bash
# Remove catálogo/API BetBra: UI Admin Jogos só lançamento manual + para serviço :3099
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-remover-betbra-api.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/remover-betbra-api-723d}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT" "$SHIM_DIR" "$SCRIPTS_DIR" /opt/arbishield/scripts

log "1/4 Backend — prelive sem API BetBra (mantém settle/manual/proteções)"
PRELIVE_DST="$SCRIPTS_DIR/arbishield-prelive-events.mjs"
[[ -f /opt/arbishield/scripts/arbishield-prelive-events.mjs ]] && \
  PRELIVE_DST="/opt/arbishield/scripts/arbishield-prelive-events.mjs"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/arbishield-prelive-events.mjs?v=$BUST" -o "$PRELIVE_DST"
chmod 0755 "$PRELIVE_DST"
cp -f "$PRELIVE_DST" "$SCRIPTS_DIR/arbishield-prelive-events.mjs" 2>/dev/null || true
cp -f "$PRELIVE_DST" /opt/arbishield/scripts/arbishield-prelive-events.mjs 2>/dev/null || true
grep -q 'sem-betbra-api-v1' "$PRELIVE_DST" || die "prelive sem marker sem-betbra-api-v1"
! grep -q 'async function betbra\|async function listPreliveEventsForDay\|async function createMatchFromMarket' "$PRELIVE_DST" \
  || die "prelive ainda contém funções BetBra"
systemctl restart arbishield-prelive-events.service 2>/dev/null || \
  systemctl restart arbishield-prelive.service 2>/dev/null || true

log "2/4 Parar serviço de sugestões BetBra (:3099)"
systemctl disable --now arbishield-desafio-suggestions.service 2>/dev/null || true
rm -f /etc/systemd/system/arbishield-desafio-suggestions.service
rm -f "$SCRIPTS_DIR/arbishield-desafio-suggestions.mjs" \
  /opt/arbishield/scripts/arbishield-desafio-suggestions.mjs \
  /opt/arbishield/arbishield-desafio-suggestions.mjs 2>/dev/null || true
systemctl daemon-reload 2>/dev/null || true

log "3/4 UI — Admin Jogos / hub / desafios (sem catálogo BetBra)"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/static/v2/admin-jogos.html?v=$BUST" -o "$WEB/admin-jogos.html"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/static/admin-jogos-vps.html?v=$BUST" -o "$WEB_ROOT/admin-jogos-vps.html"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/static/admin-hub-vps.html?v=$BUST" -o "$WEB_ROOT/admin-hub-vps.html"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/static/v2/admin-desafios.html?v=$BUST" -o "$WEB/admin-desafios.html"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/static/admin-desafios-vps.html?v=$BUST" -o "$WEB_ROOT/admin-desafios-vps.html"
chmod 0644 "$WEB/admin-jogos.html" "$WEB/admin-desafios.html" \
  "$WEB_ROOT/admin-jogos-vps.html" "$WEB_ROOT/admin-hub-vps.html" \
  "$WEB_ROOT/admin-desafios-vps.html"
cp -f "$WEB/admin-jogos.html" "$WEB_ROOT/admin-jogos.html" 2>/dev/null || true
cp -f "$WEB/admin-desafios.html" "$WEB_ROOT/admin-desafios.html" 2>/dev/null || true
! grep -q 'Lançar jogo (BetBra)\|prelive-events\|Consultando BetBra' "$WEB/admin-jogos.html" \
  || die "admin-jogos ainda referencia BetBra"
grep -q 'Lançar jogo' "$WEB/admin-jogos.html" || die "admin-jogos sem CTA Lançar jogo"

rm -f "$WEB/admin-desafio-sugestoes.html" \
  "$WEB_ROOT/admin-desafio-sugestoes.html" \
  "$WEB_ROOT/desafio-sugestoes.html" \
  "$WEB/desafio-sugestoes.html" \
  "$WEB_ROOT/desafio-sugestoes-inject.js" \
  "$WEB/desafio-sugestoes-inject.js" 2>/dev/null || true

log "4/4 Nginx — desafio-suggestions → 410 (se conf legível)"
for conf in /etc/nginx/sites-enabled/arbishield.app \
  /etc/nginx/conf.d/arbishield.app.conf \
  /etc/nginx/sites-available/arbishield.app; do
  [[ -f "$conf" ]] || continue
  if grep -q 'location /api/arbishield/desafio-suggestions' "$conf"; then
    if ! grep -q 'Sugestões BetBra removidas' "$conf"; then
      python3 - "$conf" <<'PY' || true
import sys
from pathlib import Path
p = Path(sys.argv[1])
t = p.read_text(encoding="utf-8")
old = """    location /api/arbishield/desafio-suggestions {
        proxy_pass http://127.0.0.1:3099;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_read_timeout 120s;
    }"""
new = """    location /api/arbishield/desafio-suggestions {
        default_type application/json;
        return 410 '{"ok":false,"error":"Sugestões BetBra removidas"}';
    }"""
if old in t:
    p.write_text(t.replace(old, new), encoding="utf-8")
    print("patched", p)
else:
    print("skip pattern", p)
PY
    fi
  fi
done
if command -v nginx >/dev/null && nginx -t 2>/dev/null; then
  systemctl reload nginx 2>/dev/null || true
fi

code="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3098/health || echo 000)"
[[ "$code" == "200" ]] || die "health :3098 respondeu $code"
body="$(curl -sS http://127.0.0.1:3098/health || true)"
echo "$body" | grep -q 'sem-betbra-api-v1' || die "health sem marker sem-betbra-api-v1"
pre="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3098/api/arbishield/prelive-events || echo 000)"
[[ "$pre" == "410" ]] || die "prelive-events deveria ser 410, veio $pre"

echo
echo "OK — API/UI BetBra removidas"
echo "  Admin Jogos: só lançamento manual + liquidação"
echo "  Serviço :3098 ativo; :3099 desligado"
echo "  Ctrl+F5 em /admin/matches"
