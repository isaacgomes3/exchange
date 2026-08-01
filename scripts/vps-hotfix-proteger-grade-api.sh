#!/usr/bin/env bash
# Proteger: grade vazia com jogo na Fila — RLS bloqueava leitura de matches.
# Serve a grade via GET /api/arbishield/matches (service_role) + libera RLS.
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"
COMPOSE_DIR="${ARBISHIELD_COMPOSE_DIR:-/opt/arbishield/deploy/vps-supabase}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT" "$SCRIPTS_DIR"

download_repo_file() {
  local rel="$1"
  local out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/$rel?ref=${REF}&t=$(date +%s)" -o "$out" \
    && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "$RAW/$rel?v=$BUST&t=$(date +%s)" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

log "1/4 UI app-proteger.html"
tmp_html="$(mktemp)"
download_repo_file "deploy/vps-supabase/static/v2/app-proteger.html" "$tmp_html"
grep -q 'proteger-grade-api-v9' "$tmp_html" || die "sem marker proteger-grade-api-v9"
grep -q 'API_BASE + "/matches"' "$tmp_html" || die "sem fetch API /matches"

while IFS= read -r -d '' f; do
  cp -a "$f" "${f}.bak-grade-api-$(date +%s)" 2>/dev/null || true
  cp -f "$tmp_html" "$f"
  chmod 0644 "$f"
  echo "  OK $f"
done < <(find /var/www -type f -name 'app-proteger.html' -print0 2>/dev/null || true)
for f in "$WEB/app-proteger.html" "$WEB_ROOT/app-proteger.html" "$WEB_ROOT/sandbox/app-proteger.html"; do
  mkdir -p "$(dirname "$f")" 2>/dev/null || true
  [[ -d "$(dirname "$f")" ]] || continue
  cp -f "$tmp_html" "$f"
  chmod 0644 "$f"
  echo "  OK $f"
done
rm -f "$tmp_html"

log "2/4 prelive GET /matches"
tmp_pre="$(mktemp)"
download_repo_file "scripts/arbishield-prelive-events.mjs" "$tmp_pre"
grep -q 'listAvailableMatchesForClient' "$tmp_pre" || die "prelive sem listAvailableMatchesForClient"
grep -q 'unpublishExpiredPublishedMatches' "$tmp_pre" || die "prelive sem unpublishExpired"
for dest in \
  "$SCRIPTS_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/arbishield-prelive-events.mjs" \
  "$SHIM_DIR/scripts/arbishield-prelive-events.mjs"
do
  mkdir -p "$(dirname "$dest")"
  cp -f "$tmp_pre" "$dest"
  chmod 0755 "$dest"
  echo "  OK $dest"
done
rm -f "$tmp_pre"

systemctl restart arbishield-prelive-events.service 2>/dev/null || \
  systemctl restart arbishield-prelive.service 2>/dev/null || true

log "3/4 RLS — clientes leem matches publicados"
SQL_TMP="$(mktemp)"
cat > "$SQL_TMP" <<'SQL'
grant select on public.matches to anon, authenticated;

drop policy if exists matches_select_published_clients on public.matches;

create policy matches_select_published_clients
on public.matches
for select
to anon, authenticated
using (
  deleted_at is null
  and is_published is true
);

notify pgrst, 'reload schema';
SQL

applied=0
if command -v docker >/dev/null 2>&1; then
  for c in $(docker ps --format '{{.Names}}' 2>/dev/null | grep -Ei 'db|postgres|supabase' || true); do
    if docker exec -i "$c" psql -U postgres -d postgres < "$SQL_TMP" 2>/tmp/matches-rls.err; then
      echo "  SQL ok via $c"
      applied=1
      break
    fi
  done
  if [[ "$applied" -eq 0 && -d "$COMPOSE_DIR" ]]; then
    if (cd "$COMPOSE_DIR" && docker compose exec -T db psql -U postgres -d postgres < "$SQL_TMP"); then
      echo "  SQL ok via docker compose"
      applied=1
    fi
  fi
fi
rm -f "$SQL_TMP"
if [[ "$applied" -ne 1 ]]; then
  echo "  aviso: RLS nao aplicado via docker — a grade ainda funciona pela API /matches" >&2
fi

log "4/4 smoke"
sleep 2
CODE=$(curl -sS -o /tmp/avail-matches.json -w "%{http_code}" \
  "http://127.0.0.1:3098/api/arbishield/matches" || true)
echo "  local GET /matches → HTTP $CODE"
if [[ -s /tmp/avail-matches.json ]]; then
  python3 - <<'PY'
import json
try:
  d=json.load(open("/tmp/avail-matches.json"))
  print("  total=", d.get("total"), "ok=", d.get("ok"))
  for m in (d.get("matches") or [])[:5]:
    print("   -", m.get("home_team"), "×", m.get("away_team"), m.get("starts_at"))
except Exception as e:
  print("  parse:", e)
PY
fi
EXT=$(curl -sS -o /tmp/avail-ext.json -w "%{http_code}" \
  "https://127.0.0.1/api/arbishield/matches" -k 2>/dev/null || \
  curl -sS -o /tmp/avail-ext.json -w "%{http_code}" \
  "http://127.0.0.1/api/arbishield/matches" || true)
echo "  nginx GET /api/arbishield/matches → HTTP $EXT"

log "OK — Ctrl+Shift+R em /app-proteger.html"
echo "  Celtic deve aparecer se ainda estiver publicado e na janela +2h30."
