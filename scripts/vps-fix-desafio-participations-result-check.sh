#!/usr/bin/env bash
# Corrige CHECK desafio_participations_result_check que bloqueia won/lost/pending/cancelled.
#
# Sintoma no admin (Encerrar etapa / registrar entrada):
#   new row for relation "desafio_participations" violates check constraint
#   "desafio_participations_result_check"
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-visual-disponivel-6aef/scripts/vps-fix-desafio-participations-result-check.sh?v=1")
set -euo pipefail

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need docker

DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1 || true)"
[[ -n "$DB_CONTAINER" ]] || die "container Postgres não encontrado"

psql_db() {
  if docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@" 2>/tmp/psql-dp-result.err; then
    return 0
  fi
  docker exec -i "$DB_CONTAINER" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"
}

log "constraint atual"
psql_db -At <<'SQL' || true
SELECT coalesce(pg_get_constraintdef(oid), '(sem definição)')
FROM pg_constraint
WHERE conname = 'desafio_participations_result_check'
LIMIT 1;
SQL

# Mostra distinct de result atuais (diagnóstico)
log "valores atuais em desafio_participations.result"
psql_db -At <<'SQL' || true
SELECT coalesce(result::text, '(null)') || ' → ' || count(*)::text
FROM public.desafio_participations
GROUP BY 1
ORDER BY 2 DESC;
SQL

log "recriando constraint (pending/won/lost/cancelled + aliases)"
psql_db <<'SQL'
BEGIN;

ALTER TABLE public.desafio_participations
  DROP CONSTRAINT IF EXISTS desafio_participations_result_check;

ALTER TABLE public.desafio_participations
  ADD CONSTRAINT desafio_participations_result_check
  CHECK (
    result IS NULL
    OR lower(btrim(result::text)) = ANY (
      ARRAY[
        'pending',
        'open',
        'won',
        'win',
        'lost',
        'lose',
        'cancelled',
        'canceled',
        'void',
        'refunded'
      ]
    )
  );

COMMIT;

SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'desafio_participations_result_check'
LIMIT 1;
SQL

log "ok — tente Encerrar etapa / registrar entrada de novo (Ctrl+F5)"
