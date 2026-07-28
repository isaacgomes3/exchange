#!/usr/bin/env bash
# Hotfix: botão "Tirar da fila" no Admin Jogos (+ despublica "teste vs teste" se existir).
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/tirar-jogo-fila-47c1/scripts/vps-hotfix-tirar-jogo-fila.sh")
#
# Só despublicar o teste sem atualizar UI:
#   UNQUEUE_MATCH="teste" bash <(curl -fsSL ".../vps-hotfix-tirar-jogo-fila.sh") --only-unqueue
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/tirar-jogo-fila-47c1}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
ENV_FILE="${ENV_FILE:-/opt/arbishield/deploy/vps-supabase/.env}"
UNQUEUE_MATCH="${UNQUEUE_MATCH:-teste}"
ONLY_UNQUEUE=0
[[ "${1:-}" == "--only-unqueue" ]] && ONLY_UNQUEUE=1

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl

load_env() {
  [[ -f "$ENV_FILE" ]] || return 0
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
}

unqueue_by_name() {
  load_env
  local key="${ARBISHIELD_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}}"
  local url="${ARBISHIELD_SUPABASE_URL:-${SUPABASE_URL:-${API_EXTERNAL_URL:-http://127.0.0.1:8000}}}"
  url="${url%/}"
  [[ -n "$key" ]] || die "SERVICE_ROLE_KEY ausente em $ENV_FILE"
  local q
  q=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$UNQUEUE_MATCH")
  log "Despublicando jogos com nome ~ '$UNQUEUE_MATCH'…"
  local rows
  rows=$(curl -fsSL \
    -H "apikey: $key" \
    -H "Authorization: Bearer $key" \
    "$url/rest/v1/matches?or=(home_team.ilike.*${q}*,away_team.ilike.*${q}*)&is_published=eq.true&deleted_at=is.null&select=id,home_team,away_team,starts_at,is_published")
  echo "$rows" | python3 -c "
import json,sys
rows=json.load(sys.stdin)
if not rows:
  print('  (nenhum jogo publicado encontrado)')
  sys.exit(0)
for r in rows:
  print('  -', r.get('home_team'), 'vs', r.get('away_team'), '|', r.get('id'))
" || true
  local ids
  ids=$(echo "$rows" | python3 -c "import json,sys; print(' '.join(r['id'] for r in json.load(sys.stdin)))" 2>/dev/null || true)
  for id in $ids; do
    curl -fsSL -X PATCH \
      -H "apikey: $key" \
      -H "Authorization: Bearer $key" \
      -H "Content-Type: application/json" \
      -H "Prefer: return=minimal" \
      -d '{"is_published":false}' \
      "$url/rest/v1/matches?id=eq.${id}" >/dev/null
    echo "  OK despublicado: $id"
  done
}

if [[ "$ONLY_UNQUEUE" -eq 1 ]]; then
  unqueue_by_name
  exit 0
fi

need mkdir
mkdir -p "$WEB" "$WEB_ROOT"

log "1/2 UI — admin-jogos.html (Tirar da fila)"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/static/v2/admin-jogos.html?v=$BUST" -o "$WEB/admin-jogos.html"
chmod 0644 "$WEB/admin-jogos.html"
cp -f "$WEB/admin-jogos.html" "$WEB_ROOT/admin-jogos.html" 2>/dev/null || true
grep -q 'data-unqueue' "$WEB/admin-jogos.html" || die "admin-jogos sem botão Tirar da fila"
grep -q 'unqueueMatch' "$WEB/admin-jogos.html" || die "admin-jogos sem unqueueMatch"

log "2/2 Despublicar jogos de teste (~$UNQUEUE_MATCH)"
unqueue_by_name || log "(aviso) não foi possível despublicar via API — use o botão na UI"

echo
echo "OK — Ctrl+F5 em Admin Jogos."
echo "  Botão âmbar \"Tirar da fila\" nos jogos NA FILA sem proteção."
echo "  https://arbishield.app/v2/admin-jogos.html"
