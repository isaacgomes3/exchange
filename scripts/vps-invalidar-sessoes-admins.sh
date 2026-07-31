#!/usr/bin/env bash
# Invalida sessões dos 4 admins + contas banidas (força novo login).
#
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/investigar-adm-jawadog-3e4b/scripts/vps-invalidar-sessoes-admins.sh?t=$(date +%s)")
set -euo pipefail

DB="$(docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1 || true)"
[[ -n "$DB" ]] || { echo "ERRO: postgres não encontrado"; exit 1; }

psql_db() {
  if docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; then
    return 0
  fi
  docker exec -i "$DB" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"
}

echo "==> invalidando refresh_tokens / sessions"
psql_db <<'SQL'
DO $$
DECLARE
  n_rt int := 0;
  n_ss int := 0;
BEGIN
  IF to_regclass('auth.refresh_tokens') IS NOT NULL THEN
    DELETE FROM auth.refresh_tokens
    WHERE user_id IN (
      SELECT id::text FROM auth.users
      WHERE lower(email) IN (
        'jawadog871@kierko.com',
        'admin.probe.1784500869@arbishield.local',
        'isaacgomes3@gmail.com',
        'financeiro@arbishield.com',
        'carlos@arbishield.com',
        'icaro@arbishield.com'
      )
      OR banned_until IS NOT NULL
    );
    GET DIAGNOSTICS n_rt = ROW_COUNT;
  END IF;

  IF to_regclass('auth.sessions') IS NOT NULL THEN
    DELETE FROM auth.sessions
    WHERE user_id IN (
      SELECT id FROM auth.users
      WHERE lower(email) IN (
        'jawadog871@kierko.com',
        'admin.probe.1784500869@arbishield.local',
        'isaacgomes3@gmail.com',
        'financeiro@arbishield.com',
        'carlos@arbishield.com',
        'icaro@arbishield.com'
      )
      OR banned_until IS NOT NULL
    );
    GET DIAGNOSTICS n_ss = ROW_COUNT;
  END IF;

  RAISE NOTICE 'refresh_tokens=% sessions=%', n_rt, n_ss;
END $$;
SQL

echo "OK — isaac/financeiro/carlos/icaro precisam logar de novo."
