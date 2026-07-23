#!/usr/bin/env bash
# Corrige settles antigos em que profit_cents era só o lucro líquido
# (faltava devolver o stake = “Você recebe” − lucro).
#
# Na VPS (com docker Postgres / SERVICE_ROLE via shim DB):
#   bash scripts/vps-fix-desafio-frozen-payout.sh
#   DRY_RUN=1 bash scripts/vps-fix-desafio-frozen-payout.sh
set -euo pipefail

DRY_RUN="${DRY_RUN:-0}"
DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1 || true)"
if [[ -z "${DB_CONTAINER:-}" ]]; then
  echo "ERRO: container Postgres não encontrado" >&2
  exit 1
fi

psql_c() {
  if docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; then
    return 0
  fi
  docker exec -i "$DB_CONTAINER" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"
}

echo "==> Participações ArbiShield won com profit < stake (legado)"
psql_c <<'SQL'
SELECT p.id, p.user_id, p.amount_cents, p.profit_cents,
       (p.amount_cents + p.profit_cents) AS payout_corrigido,
       p.amount_cents AS credito_faltante
FROM desafio_participations p
WHERE lower(coalesce(p.side, '')) = 'arbishield'
  AND lower(coalesce(p.result, '')) IN ('won', 'win')
  AND coalesce(p.profit_cents, 0) > 0
  AND coalesce(p.amount_cents, 0) > 0
  AND p.profit_cents < p.amount_cents
ORDER BY p.created_at DESC
LIMIT 50;
SQL

if [[ "$DRY_RUN" == "1" ]]; then
  echo "==> DRY_RUN=1 — nenhuma alteração"
  exit 0
fi

echo "==> Aplicando correção (profit_cents = stake + lucro; credita stake faltante na carteira)"
psql_c <<'SQL'
BEGIN;

WITH legacy AS (
  SELECT p.id, p.user_id, p.amount_cents, p.profit_cents,
         (p.amount_cents + p.profit_cents) AS payout
  FROM desafio_participations p
  WHERE lower(coalesce(p.side, '')) = 'arbishield'
    AND lower(coalesce(p.result, '')) IN ('won', 'win')
    AND coalesce(p.profit_cents, 0) > 0
    AND coalesce(p.amount_cents, 0) > 0
    AND p.profit_cents < p.amount_cents
),
upd_parts AS (
  UPDATE desafio_participations d
  SET profit_cents = l.payout,
      updated_at = now()
  FROM legacy l
  WHERE d.id = l.id
  RETURNING d.id, d.user_id, l.amount_cents AS credit
),
upd_bal AS (
  UPDATE profiles pr
  SET desafio_balance_cents = coalesce(pr.desafio_balance_cents, 0) + u.credit,
      updated_at = now()
  FROM (
    SELECT user_id, SUM(credit) AS credit
    FROM upd_parts
    GROUP BY user_id
  ) u
  WHERE pr.id = u.user_id
  RETURNING pr.id, u.credit
)
SELECT
  (SELECT count(*) FROM upd_parts) AS participations_fixed,
  (SELECT coalesce(sum(credit), 0) FROM upd_bal) AS balance_credited_cents;

COMMIT;
SQL

echo "==> OK — rode hotfix v30 e Ctrl+F5 no app-desafio"
