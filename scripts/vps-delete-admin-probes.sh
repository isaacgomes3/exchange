#!/usr/bin/env bash
# Remove contas probe admin.probe.*@arbishield.local (teste de migração).
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-visual-disponivel-6aef/scripts/vps-delete-admin-probes.sh?v=1")
set -euo pipefail

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need docker

DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1 || true)"
[[ -n "$DB_CONTAINER" ]] || die "container Postgres não encontrado"

psql_db() {
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@" \
    || docker exec -i "$DB_CONTAINER" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"
}

log "contas probe encontradas"
psql_db <<'SQL'
SELECT id, email, created_at, banned_until
FROM auth.users
WHERE lower(email) LIKE 'admin.probe.%@arbishield.local'
   OR lower(email) LIKE '%@arbishield.local'
ORDER BY created_at;
SQL

log "removendo dependências + contas probe"
psql_db <<'SQL'
BEGIN;

CREATE TEMP TABLE _probe_uids AS
SELECT id
FROM auth.users
WHERE lower(email) LIKE 'admin.probe.%@arbishield.local';

-- limpa FKs comuns que apontam para profiles/users
DELETE FROM public.affiliate_stats
WHERE profile_id IN (SELECT id FROM _probe_uids);

DELETE FROM public.user_roles
WHERE user_id IN (SELECT id FROM _probe_uids);

-- best-effort em outras tabelas comuns (ignora se não existir)
DO $$
DECLARE
  t text;
  stmts text[] := ARRAY[
    'DELETE FROM public.affiliate_referrals WHERE referrer_id IN (SELECT id FROM _probe_uids) OR referred_id IN (SELECT id FROM _probe_uids)',
    'DELETE FROM public.affiliate_commissions WHERE user_id IN (SELECT id FROM _probe_uids)',
    'DELETE FROM public.wallet_transactions WHERE user_id IN (SELECT id FROM _probe_uids)',
    'DELETE FROM public.unified_wallet_transactions WHERE user_id IN (SELECT id FROM _probe_uids)',
    'DELETE FROM public.manual_deposits WHERE user_id IN (SELECT id FROM _probe_uids)',
    'DELETE FROM public.withdrawals WHERE user_id IN (SELECT id FROM _probe_uids)',
    'DELETE FROM public.desafio_participations WHERE user_id IN (SELECT id FROM _probe_uids)',
    'DELETE FROM public.protections WHERE user_id IN (SELECT id FROM _probe_uids)',
    'DELETE FROM public.back_protections WHERE user_id IN (SELECT id FROM _probe_uids)',
    'DELETE FROM public.support_tickets WHERE user_id IN (SELECT id FROM _probe_uids)',
    'DELETE FROM public.signup_attempts WHERE user_id IN (SELECT id FROM _probe_uids)'
  ];
BEGIN
  FOREACH t IN ARRAY stmts LOOP
    BEGIN
      EXECUTE t;
    EXCEPTION WHEN undefined_table OR undefined_column THEN
      NULL;
    END;
  END LOOP;
END $$;

DELETE FROM public.profiles
WHERE id IN (SELECT id FROM _probe_uids);

DELETE FROM auth.sessions
WHERE user_id IN (SELECT id FROM _probe_uids);

DELETE FROM auth.refresh_tokens
WHERE user_id::text IN (SELECT id::text FROM _probe_uids);

DELETE FROM auth.users
WHERE id IN (SELECT id FROM _probe_uids);

COMMIT;

SELECT count(*) AS probes_restantes
FROM auth.users
WHERE lower(email) LIKE 'admin.probe.%@arbishield.local';
SQL

log "OK — probes removidas (ou já inexistentes)"
