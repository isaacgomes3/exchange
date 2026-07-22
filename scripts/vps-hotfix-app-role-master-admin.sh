#!/usr/bin/env bash
# Corrige: invalid input value for enum app_role: "master_admin"
# (Dashboard ADM / policies RLS)
#
# Na VPS (root):
#   curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-app-role-master-admin-723d/scripts/vps-hotfix-app-role-master-admin.sh" -o /tmp/hotfix-role.sh
#   bash /tmp/hotfix-role.sh
set -euo pipefail
BRANCH="${ARBISHIELD_BRANCH:-cursor/fix-app-role-master-admin-723d}"
REF="${ARBISHIELD_REF:-$BRANCH}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
COMPOSE_DIR="${SUPABASE_COMPOSE_DIR:-/opt/arbishield/deploy/vps-supabase}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }

log "1/2 — baixar SQL"
SQL_TMP="$(mktemp)"
curl -fsSL "$RAW/supabase/migrations/20260722_fix_app_role_master_admin.sql" -o "$SQL_TMP"
grep -q 'app_role' "$SQL_TMP" || die "SQL inválido"
grep -q 'is_super_admin_uid' "$SQL_TMP" || die "SQL sem helper"

log "2/2 — aplicar no Postgres"
applied=0
if command -v docker >/dev/null 2>&1; then
  for c in $(docker ps --format '{{.Names}}' 2>/dev/null | grep -Ei 'db|postgres|supabase' || true); do
    if docker exec -i "$c" psql -U postgres -d postgres < "$SQL_TMP" 2>/tmp/role-sql.err; then
      echo "  SQL ok via $c"
      applied=1
      break
    else
      echo "  falha em $c:" >&2
      cat /tmp/role-sql.err >&2 || true
    fi
  done
  if [[ "$applied" -eq 0 && -d "$COMPOSE_DIR" ]]; then
    (cd "$COMPOSE_DIR" && docker compose exec -T db psql -U postgres -d postgres < "$SQL_TMP") && applied=1
  fi
fi
rm -f "$SQL_TMP"
[[ "$applied" -eq 1 ]] || die "não consegui aplicar SQL no container db"

echo
echo "OK — Ctrl+Shift+R no Dashboard ADM"
echo "  enum app_role + is_super_admin_uid corrigidos"
