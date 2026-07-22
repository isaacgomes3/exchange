#!/usr/bin/env bash
# Meu Perfil v2: campos do legado + Editar (dados, PIX, banco, senha)
# Inclui correção RLS: infinite recursion detected in policy for relation "profiles"
#
# Na VPS (root):
#   curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/perfil-editar-campos-723d/scripts/vps-hotfix-perfil-editar.sh" -o /tmp/hotfix-perfil.sh
#   bash /tmp/hotfix-perfil.sh
set -euo pipefail
BRANCH="${ARBISHIELD_BRANCH:-cursor/perfil-editar-campos-723d}"
REF="${ARBISHIELD_REF:-$BRANCH}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
COMPOSE_DIR="${SUPABASE_COMPOSE_DIR:-/opt/arbishield/deploy/vps-supabase}"
mkdir -p "$WEB"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }

apply_sql() {
  local label="$1"
  local url="$2"
  local sql_tmp
  sql_tmp="$(mktemp)"
  curl -fsSL "$url" -o "$sql_tmp" || {
    echo "  AVISO: não baixou $label"
    rm -f "$sql_tmp"
    return 1
  }
  [[ -s "$sql_tmp" ]] || {
    echo "  AVISO: $label vazio"
    rm -f "$sql_tmp"
    return 1
  }
  local applied=0
  if command -v docker >/dev/null 2>&1; then
    for c in $(docker ps --format '{{.Names}}' 2>/dev/null | grep -Ei 'db|postgres|supabase' || true); do
      if docker exec -i "$c" psql -U postgres -d postgres < "$sql_tmp" 2>/tmp/pf-sql.err; then
        echo "  SQL ok ($label) via $c"
        applied=1
        break
      fi
    done
    if [[ "$applied" -eq 0 && -d "$COMPOSE_DIR" ]]; then
      if (cd "$COMPOSE_DIR" && docker compose exec -T db psql -U postgres -d postgres < "$sql_tmp"); then
        echo "  SQL ok ($label) via docker compose"
        applied=1
      fi
    fi
  fi
  rm -f "$sql_tmp"
  [[ "$applied" -eq 1 ]] || {
    echo "  AVISO: SQL $label não aplicado"
    return 1
  }
  return 0
}

log "1/3 — UI perfil"
for f in app-perfil.html v2-perfil.js v2.css v2-shell.js; do
  curl -fsSL "$RAW/deploy/vps-supabase/static/v2/$f" -o "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
  echo "  ok $f ($(wc -c < "$WEB/$f" | tr -d ' ') bytes)"
done
grep -q 'v2-perfil.js' "$WEB/app-perfil.html" || die "app-perfil sem v2-perfil.js"
grep -q 'update_own_profile' "$WEB/v2-perfil.js" || die "v2-perfil sem update_own_profile"
grep -q 'pf-card' "$WEB/v2.css" || die "v2.css sem estilos pf-"

log "2/3 — SQL RLS + RPCs (obrigatório para salvar dados/PIX)"
# Migration completa: helper sem recursão + policies + RPCs com row_security=off
SQL_OK=0
if apply_sql "profiles_rls_no_recursion" \
  "$RAW/supabase/migrations/20260722_profiles_rls_no_recursion.sql"; then
  SQL_OK=1
elif apply_sql "profile_own_rpcs" \
  "$RAW/supabase/migrations/20260722_profile_own_rpcs.sql"; then
  SQL_OK=1
fi
if [[ "$SQL_OK" -ne 1 ]]; then
  die "SQL não aplicado — sem isso, Salvar dados pessoais / PIX falha com infinite recursion em profiles"
fi

log "3/3 — bucket avatars (best-effort)"
SK=""
for ef in $(systemctl cat arbishield-serverfn-shim.service 2>/dev/null | sed -n 's/^EnvironmentFile=-*//p'); do
  [[ -f "$ef" ]] || continue
  set -a; # shellcheck disable=SC1090
  source "$ef" 2>/dev/null || true
  set +a
done
SK="${ARBISHIELD_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}}"
if [[ -n "$SK" ]]; then
  curl -sS -X POST "http://127.0.0.1:8000/storage/v1/bucket" \
    -H "apikey: $SK" -H "Authorization: Bearer $SK" -H "Content-Type: application/json" \
    -d '{"id":"avatars","name":"avatars","public":true,"file_size_limit":2097152}' \
    | head -c 160 || true
  echo
fi

echo
echo "OK — Ctrl+Shift+R em https://arbishield.app/app-perfil.html"
echo "  PIX / dados / banco / senha — RLS recursion corrigida"
