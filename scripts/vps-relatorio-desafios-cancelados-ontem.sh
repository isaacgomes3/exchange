#!/usr/bin/env bash
# Relatório: devoluções de desafio no dia + clientes + saldo antes da entrada.
#
# Fonte da verdade = wallet_transactions tipo desafio_cancel_refund no dia (BRT).
# O status do desafio pode não ter ficado 'cancelled' no mesmo dia — por isso
# NÃO filtramos só por desafios.status.
#
# Na VPS (root):
#   DATE=2026-07-30 bash <(curl -fsSL -H "Accept: application/vnd.github.raw" \
#     "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-relatorio-desafios-cancelados-ontem.sh?ref=cursor/relatorio-desafios-cancelados-ontem-4759&t=$(date +%s)")
set -euo pipefail

DATE="${DATE:-}"
BRANCH_REF="${ARBISHIELD_BRANCH:-cursor/relatorio-desafios-cancelados-ontem-4759}"

die() { echo "ERRO: $*" >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || die "rode como root na VPS"
command -v docker >/dev/null || die "docker"

DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1 || true)"
[[ -n "$DB_CONTAINER" ]] || die "container Postgres não encontrado"

if [[ -z "$DATE" ]]; then
  DATE="$(TZ=America/Sao_Paulo date -d 'yesterday' +%F 2>/dev/null \
    || python3 - <<'PY'
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
print((datetime.now(ZoneInfo("America/Sao_Paulo")) - timedelta(days=1)).date())
PY
)"
fi

FROM_ISO="${DATE}T00:00:00-03:00"
TO_ISO="$(python3 - <<PY
from datetime import datetime, timedelta
print((datetime.fromisoformat("${DATE}") + timedelta(days=1)).strftime("%Y-%m-%dT00:00:00-03:00"))
PY
)"

psql_db() {
  local err; err="$(mktemp)"
  if docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@" 2>"$err"; then
    rm -f "$err"; return 0
  fi
  if docker exec -i "$DB_CONTAINER" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@" 2>"$err"; then
    rm -f "$err"; return 0
  fi
  echo "--- psql erro ---" >&2
  cat "$err" >&2 || true
  rm -f "$err"
  return 1
}

echo "════════════════════════════════════════════════════════════════════════"
echo "RELATÓRIO · Devoluções de desafio cancelado + carteira Desafio"
echo "Dia (BRT): $DATE"
echo "Janela: $FROM_ISO → $TO_ISO"
echo "Regra: entrar debita desafio_balance; cancel devolve (desafio_cancel_refund)."
echo "════════════════════════════════════════════════════════════════════════"

REFUND_N="$(psql_db -At <<SQL
SELECT count(*)::text
FROM public.wallet_transactions wt
WHERE wt.type = 'desafio_cancel_refund'
  AND wt.created_at >= timestamptz '${FROM_ISO}'
  AND wt.created_at < timestamptz '${TO_ISO}';
SQL
)"
REFUND_N="$(echo -n "${REFUND_N}" | tr -d '[:space:]')"
echo "Devoluções (desafio_cancel_refund) no dia: ${REFUND_N:-0}"

if [[ "${REFUND_N:-0}" == "0" ]]; then
  echo
  echo "Nenhuma devolução de cancelamento de desafio neste dia."
  echo "Tente outro dia, ex. DATE=2026-07-30"
  exit 0
fi

echo
echo "── 1) Devoluções do dia (bruto) ──"
psql_db <<SQL
\pset pager off
\pset format aligned
\pset border 1
SELECT
  to_char(wt.created_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') AS quando_brt,
  left(coalesce(pr.full_name, u.email::text, left(wt.user_id::text, 8)), 30) AS cliente,
  coalesce(u.email::text, '—') AS email,
  trim(to_char(wt.amount_cents / 100.0, 'FM999999990.00')) AS devolvido,
  left(coalesce(wt.metadata->>'desafio_id', '—'), 8) AS desafio8,
  left(coalesce(wt.metadata->>'participation_id', '—'), 8) AS part8,
  left(coalesce(wt.metadata->>'reason', '—'), 28) AS motivo
FROM public.wallet_transactions wt
LEFT JOIN public.profiles pr ON pr.id = wt.user_id
LEFT JOIN auth.users u ON u.id = wt.user_id
WHERE wt.type = 'desafio_cancel_refund'
  AND wt.created_at >= timestamptz '${FROM_ISO}'
  AND wt.created_at < timestamptz '${TO_ISO}'
ORDER BY wt.created_at ASC, pr.full_name NULLS LAST;
SQL

echo
echo "── 2) Comparativo: stake · devolvido · saldo antes de entrar · saldo agora ──"
psql_db <<SQL
\pset pager off
\pset format aligned
\pset border 1

WITH bounds AS (
  SELECT timestamptz '${FROM_ISO}' AS t0, timestamptz '${TO_ISO}' AS t1
),
refunds AS (
  SELECT
    wt.id AS tx_id,
    wt.user_id,
    wt.amount_cents AS refund_cents,
    wt.created_at AS refund_at,
    CASE
      WHEN coalesce(wt.metadata->>'desafio_id','')
           ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (wt.metadata->>'desafio_id')::uuid
      ELSE NULL
    END AS desafio_id,
    CASE
      WHEN coalesce(wt.metadata->>'participation_id','')
           ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (wt.metadata->>'participation_id')::uuid
      ELSE NULL
    END AS participation_id,
    CASE
      WHEN coalesce(wt.metadata->>'step_id','')
           ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN (wt.metadata->>'step_id')::uuid
      ELSE NULL
    END AS step_id,
    wt.metadata->>'desafio_id' AS desafio_id_raw,
    wt.metadata->>'reason' AS reason
  FROM public.wallet_transactions wt, bounds b
  WHERE wt.type = 'desafio_cancel_refund'
    AND wt.created_at >= b.t0
    AND wt.created_at < b.t1
),
parts AS (
  SELECT
    p.id AS participation_id,
    p.user_id,
    p.desafio_id,
    p.step_id,
    p.amount_cents AS stake_cents,
    p.created_at AS entered_at,
    p.result
  FROM public.desafio_participations p
  WHERE p.id IN (SELECT participation_id FROM refunds WHERE participation_id IS NOT NULL)
     OR (
       p.user_id IN (SELECT user_id FROM refunds)
       AND p.desafio_id IN (SELECT desafio_id FROM refunds WHERE desafio_id IS NOT NULL)
       AND p.result = 'cancelled'
     )
),
-- escolhe a participação da linha do refund
joined AS (
  SELECT
    r.tx_id,
    r.user_id,
    r.refund_cents,
    r.refund_at,
    coalesce(r.desafio_id, p.desafio_id) AS desafio_id,
    r.desafio_id_raw,
    coalesce(p.participation_id, r.participation_id) AS participation_id,
    coalesce(p.step_id, r.step_id) AS step_id,
    coalesce(p.stake_cents, r.refund_cents) AS stake_cents,
    p.entered_at,
    r.reason
  FROM refunds r
  LEFT JOIN LATERAL (
    SELECT p.*
    FROM parts p
    WHERE (r.participation_id IS NOT NULL AND p.participation_id = r.participation_id)
       OR (
         r.participation_id IS NULL
         AND p.user_id = r.user_id
         AND r.desafio_id IS NOT NULL
         AND p.desafio_id = r.desafio_id
       )
    ORDER BY
      CASE WHEN r.participation_id IS NOT NULL AND p.participation_id = r.participation_id THEN 0 ELSE 1 END,
      p.entered_at ASC NULLS LAST
    LIMIT 1
  ) p ON TRUE
),
mov AS (
  SELECT
    j.tx_id,
    j.user_id,
    j.entered_at,
    coalesce((
      SELECT sum(wt.amount_cents)
      FROM public.wallet_transactions wt
      WHERE wt.user_id = j.user_id
        AND j.entered_at IS NOT NULL
        AND wt.created_at > j.entered_at
        AND wt.type IN (
          'desafio_deposit', 'desafio_cancel_refund', 'desafio_void_refund',
          'admin_adjustment_credit'
        )
    ), 0) AS creditos_apos,
    coalesce((
      SELECT sum(abs(wt.amount_cents))
      FROM public.wallet_transactions wt
      WHERE wt.user_id = j.user_id
        AND j.entered_at IS NOT NULL
        AND wt.created_at > j.entered_at
        AND wt.type IN ('admin_adjustment_debit', 'admin_adjustment')
        AND (
          coalesce(wt.metadata->>'wallet','') = 'desafio'
          OR coalesce(wt.metadata->>'field','') = 'desafio_balance_cents'
        )
    ), 0) AS debitos_tx_apos,
    coalesce((
      SELECT sum(p2.amount_cents)
      FROM public.desafio_participations p2
      WHERE p2.user_id = j.user_id
        AND j.entered_at IS NOT NULL
        AND p2.created_at > j.entered_at
        AND p2.id IS DISTINCT FROM j.participation_id
    ), 0) AS outras_entradas_apos,
    coalesce((
      SELECT sum(coalesce(p2.amount_cents,0) + coalesce(p2.profit_cents,0))
      FROM public.desafio_participations p2
      WHERE p2.user_id = j.user_id
        AND j.entered_at IS NOT NULL
        AND p2.result = 'won'
        AND coalesce(p2.updated_at, p2.created_at) > j.entered_at
    ), 0) AS wins_apos
  FROM joined j
),
ajustes AS (
  SELECT
    wt.user_id,
    sum(
      CASE
        WHEN wt.type = 'admin_adjustment_credit' THEN wt.amount_cents
        WHEN wt.type IN ('admin_adjustment_debit', 'admin_adjustment') THEN -abs(wt.amount_cents)
        ELSE 0
      END
    )::bigint AS ajuste_cents
  FROM public.wallet_transactions wt, bounds b
  WHERE wt.created_at >= b.t0
    AND wt.created_at < b.t1
    AND wt.type IN ('admin_adjustment', 'admin_adjustment_credit', 'admin_adjustment_debit')
    AND (
      coalesce(wt.metadata->>'wallet','') IN ('desafio', 'challenge')
      OR coalesce(wt.metadata->>'field','') = 'desafio_balance_cents'
      OR coalesce(wt.metadata->>'reason','') ILIKE '%desafio%'
    )
  GROUP BY wt.user_id
)
SELECT
  coalesce('#' || d.number::text, left(coalesce(j.desafio_id_raw, '—'), 8)) AS desafio,
  left(coalesce(d.title, '(desafio sem título)'), 36) AS titulo,
  left(coalesce(
    nullif(s.match_label, ''),
    nullif(trim(both FROM coalesce(s.home_team,'') || ' x ' || coalesce(s.away_team,'')), ' x '),
    '—'
  ), 32) AS evento,
  to_char(j.refund_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') AS devolvido_em,
  left(coalesce(pr.full_name, u.email::text, left(j.user_id::text, 8)), 28) AS cliente,
  coalesce(u.email::text, '—') AS email,
  trim(to_char(j.stake_cents / 100.0, 'FM999999990.00')) AS stake_entrada,
  trim(to_char(j.refund_cents / 100.0, 'FM999999990.00')) AS devolvido_cancel,
  CASE
    WHEN j.entered_at IS NULL THEN '—'
    ELSE trim(to_char(
      (
        coalesce(pr.desafio_balance_cents, 0)
        - coalesce(m.creditos_apos, 0)
        + coalesce(m.debitos_tx_apos, 0)
        + coalesce(m.outras_entradas_apos, 0)
        - coalesce(m.wins_apos, 0)
        + coalesce(j.stake_cents, 0)
      ) / 100.0,
      'FM999999990.00'
    ))
  END AS saldo_antes_entrada,
  trim(to_char(coalesce(pr.desafio_balance_cents, 0) / 100.0, 'FM999999990.00')) AS saldo_desafio_agora,
  trim(to_char(coalesce(a.ajuste_cents, 0) / 100.0, 'FM999999990.00')) AS ajuste_admin_dia,
  coalesce(d.status, '—') AS status_desafio
FROM joined j
LEFT JOIN public.desafios d ON d.id = j.desafio_id
LEFT JOIN public.desafio_steps s ON s.id = j.step_id
LEFT JOIN public.profiles pr ON pr.id = j.user_id
LEFT JOIN auth.users u ON u.id = j.user_id
LEFT JOIN mov m ON m.tx_id = j.tx_id
LEFT JOIN ajustes a ON a.user_id = j.user_id
ORDER BY j.refund_at ASC, pr.full_name NULLS LAST;
SQL

echo
echo "── 3) Resumo por cliente ──"
psql_db <<SQL
\pset pager off
\pset format aligned
\pset border 1
SELECT
  left(coalesce(pr.full_name, u.email::text, left(wt.user_id::text, 8)), 32) AS cliente,
  coalesce(u.email::text, '—') AS email,
  count(*) AS qtd_devolucoes,
  trim(to_char(sum(wt.amount_cents) / 100.0, 'FM999999990.00')) AS total_devolvido,
  trim(to_char(coalesce(pr.desafio_balance_cents, 0) / 100.0, 'FM999999990.00')) AS saldo_desafio_agora
FROM public.wallet_transactions wt
LEFT JOIN public.profiles pr ON pr.id = wt.user_id
LEFT JOIN auth.users u ON u.id = wt.user_id
WHERE wt.type = 'desafio_cancel_refund'
  AND wt.created_at >= timestamptz '${FROM_ISO}'
  AND wt.created_at < timestamptz '${TO_ISO}'
GROUP BY pr.full_name, u.email, wt.user_id, pr.desafio_balance_cents
ORDER BY sum(wt.amount_cents) DESC;
SQL

echo
echo "── 4) Total do dia ──"
psql_db <<SQL
\pset pager off
SELECT
  count(*) AS devolucoes,
  count(DISTINCT user_id) AS clientes,
  trim(to_char(sum(amount_cents) / 100.0, 'FM999999990.00')) AS total_devolvido_rs
FROM public.wallet_transactions
WHERE type = 'desafio_cancel_refund'
  AND created_at >= timestamptz '${FROM_ISO}'
  AND created_at < timestamptz '${TO_ISO}';
SQL

echo
echo "Colunas:"
echo "  stake_entrada       = debitado da carteira Desafio ao entrar"
echo "  devolvido_cancel    = creditado de volta no cancel"
echo "  saldo_antes_entrada = estimativa do Desafio antes daquela entrada"
echo "  saldo_desafio_agora = saldo Desafio atual"
echo "  ajuste_admin_dia    = ajuste manual Desafio no mesmo dia (se houver)"
echo
echo "Fim. (branch $BRANCH_REF)"
