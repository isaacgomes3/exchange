#!/usr/bin/env bash
# Relatório: desafios cancelados no dia + clientes + devolução + saldo antes da entrada.
#
# Na VPS (root):
#   bash <(curl -fsSL -H "Accept: application/vnd.github.raw" \
#     "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-relatorio-desafios-cancelados-ontem.sh?ref=cursor/relatorio-desafios-cancelados-ontem-4759&t=$(date +%s)")
#
# Ou com data explícita (BRT):
#   DATE=2026-07-31 bash <(curl …)
#
# DATE vazio = ontem (America/Sao_Paulo).
set -euo pipefail

DATE="${DATE:-}"
ONLY_WITH_CLIENTS="${ONLY_WITH_CLIENTS:-1}"

die() { echo "ERRO: $*" >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || die "rode como root na VPS"
command -v docker >/dev/null || die "docker"

DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1 || true)"
[[ -n "$DB_CONTAINER" ]] || die "container Postgres não encontrado"

if [[ -z "$DATE" ]]; then
  DATE="$(TZ=America/Sao_Paulo date -d 'yesterday' +%F 2>/dev/null \
    || TZ=America/Sao_Paulo date -v-1d +%F 2>/dev/null \
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
d = datetime.fromisoformat("${DATE}")
print((d + timedelta(days=1)).strftime("%Y-%m-%dT00:00:00-03:00"))
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
echo "RELATÓRIO · Desafios cancelados + carteira Desafio"
echo "Dia (BRT): $DATE"
echo "UTC: $(date -u -d "$FROM_ISO" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || true) → $(date -u -d "$TO_ISO" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || true)"
echo "Regra: ao entrar debita desafio_balance; no cancel devolve (desafio_cancel_refund)."
echo "       Congelado/Apostador não entra neste fluxo."
echo "════════════════════════════════════════════════════════════════════════"

psql_db <<SQL
\pset pager off
\pset format aligned
\pset border 1

WITH bounds AS (
  SELECT
    timestamptz '${FROM_ISO}' AS t0,
    timestamptz '${TO_ISO}' AS t1
),
-- Desafios cancelados no dia (metadata.cancelled_at ou updated_at)
desafios_dia AS (
  SELECT
    d.id,
    d.number,
    d.title,
    d.subtitle,
    d.status,
    d.initial_balance_cents,
    coalesce(
      nullif(d.metadata->>'cancelled_at','')::timestamptz,
      d.updated_at
    ) AS cancelled_at,
    coalesce(
      d.metadata->>'cancelled_by_email',
      d.metadata->>'cancelled_by_name',
      left(coalesce(d.metadata->>'cancelled_by',''), 8)
    ) AS cancelled_by
  FROM public.desafios d, bounds b
  WHERE (
    d.status = 'cancelled'
    OR (d.metadata ? 'cancelled_by')
    OR (d.metadata ? 'cancelled_at')
  )
  AND coalesce(
        nullif(d.metadata->>'cancelled_at','')::timestamptz,
        d.updated_at
      ) >= b.t0
  AND coalesce(
        nullif(d.metadata->>'cancelled_at','')::timestamptz,
        d.updated_at
      ) < b.t1
),
-- Reembolsos do cancel no dia
refunds AS (
  SELECT
    wt.id AS tx_id,
    wt.user_id,
    wt.amount_cents AS refund_cents,
    wt.created_at AS refund_at,
    nullif(wt.metadata->>'desafio_id','')::uuid AS desafio_id,
    nullif(wt.metadata->>'participation_id','')::uuid AS participation_id,
    nullif(wt.metadata->>'step_id','')::uuid AS step_id,
    wt.metadata->>'reason' AS reason
  FROM public.wallet_transactions wt, bounds b
  WHERE wt.type = 'desafio_cancel_refund'
    AND wt.created_at >= b.t0
    AND wt.created_at < b.t1
),
-- Participações canceladas ligadas aos desafios do dia (ou ao refund)
parts AS (
  SELECT
    p.id AS participation_id,
    p.user_id,
    p.desafio_id,
    p.step_id,
    p.amount_cents AS stake_cents,
    p.side,
    p.created_at AS entered_at,
    p.updated_at AS cancelled_part_at,
    p.result
  FROM public.desafio_participations p
  WHERE p.result = 'cancelled'
    AND (
      p.desafio_id IN (SELECT id FROM desafios_dia)
      OR p.id IN (SELECT participation_id FROM refunds WHERE participation_id IS NOT NULL)
    )
),
-- Evento (partida) da etapa
steps AS (
  SELECT
    s.id AS step_id,
    s.desafio_id,
    s.step_index,
    coalesce(
      nullif(s.match_label,''),
      nullif(trim(both FROM coalesce(s.home_team,'') || ' x ' || coalesce(s.away_team,'')), ' x '),
      '?'
    ) AS evento,
    s.starts_at
  FROM public.desafio_steps s
  WHERE s.desafio_id IN (SELECT id FROM desafios_dia)
     OR s.id IN (SELECT step_id FROM parts WHERE step_id IS NOT NULL)
),
-- Linha por cliente × desafio (prioriza refund; senão stake da participação)
linhas AS (
  SELECT
    coalesce(r.desafio_id, p.desafio_id) AS desafio_id,
    coalesce(r.user_id, p.user_id) AS user_id,
    coalesce(p.stake_cents, r.refund_cents, 0) AS stake_cents,
    coalesce(r.refund_cents, p.stake_cents, 0) AS refund_cents,
    p.entered_at,
    coalesce(r.refund_at, p.cancelled_part_at) AS refund_at,
    p.participation_id,
    coalesce(p.step_id, r.step_id) AS step_id,
    CASE
      WHEN r.tx_id IS NOT NULL AND p.participation_id IS NOT NULL THEN 'entrada+devolucao'
      WHEN r.tx_id IS NOT NULL THEN 'so_devolucao_tx'
      ELSE 'so_participacao'
    END AS origem
  FROM refunds r
  FULL OUTER JOIN parts p
    ON p.participation_id = r.participation_id
    OR (
      r.participation_id IS NULL
      AND p.user_id = r.user_id
      AND p.desafio_id = r.desafio_id
    )
),
-- Ajustes admin na carteira Desafio no mesmo dia (estorno operacional, se houver)
ajustes AS (
  SELECT
    wt.user_id,
    sum(wt.amount_cents)::bigint AS ajuste_cents,
    string_agg(distinct coalesce(wt.metadata->>'reason', wt.type), ' | ') AS motivos
  FROM public.wallet_transactions wt, bounds b
  WHERE wt.created_at >= b.t0
    AND wt.created_at < b.t1
    AND wt.type IN ('admin_adjustment', 'admin_adjustment_credit', 'admin_adjustment_debit')
    AND (
      coalesce(wt.metadata->>'wallet','') IN ('desafio', 'challenge')
      OR coalesce(wt.metadata->>'field','') = 'desafio_balance_cents'
      OR coalesce(wt.metadata->>'reason','') ILIKE '%desafio%cancel%'
      OR coalesce(wt.metadata->>'reason','') ILIKE '%estorno%desafio%'
    )
  GROUP BY wt.user_id
),
-- Movimentos após a entrada (para estimar saldo antes)
mov_apos AS (
  SELECT
    l.participation_id,
    l.user_id,
    l.entered_at,
    -- créditos depois da entrada (aumentam saldo)
    coalesce((
      SELECT sum(wt.amount_cents)
      FROM public.wallet_transactions wt
      WHERE wt.user_id = l.user_id
        AND wt.created_at > l.entered_at
        AND wt.type IN (
          'desafio_deposit', 'desafio_cancel_refund', 'desafio_void_refund',
          'internal_transfer', 'admin_adjustment_credit'
        )
        AND (
          wt.type <> 'internal_transfer'
          OR coalesce(wt.metadata->>'to_bucket','') IN ('desafio_balance_cents', 'desafio')
          OR coalesce(wt.metadata->>'wallet','') = 'desafio'
        )
    ), 0) AS creditos_apos,
    -- débitos ledger depois da entrada
    coalesce((
      SELECT sum(abs(wt.amount_cents))
      FROM public.wallet_transactions wt
      WHERE wt.user_id = l.user_id
        AND wt.created_at > l.entered_at
        AND (
          wt.type IN ('admin_adjustment_debit', 'admin_adjustment')
          AND (
            coalesce(wt.metadata->>'wallet','') = 'desafio'
            OR coalesce(wt.metadata->>'field','') = 'desafio_balance_cents'
          )
        )
    ), 0) AS debitos_tx_apos,
    -- outras entradas em desafio depois desta (sem tx de débito)
    coalesce((
      SELECT sum(p2.amount_cents)
      FROM public.desafio_participations p2
      WHERE p2.user_id = l.user_id
        AND p2.created_at > l.entered_at
        AND p2.id IS DISTINCT FROM l.participation_id
    ), 0) AS outras_entradas_apos,
    -- vitórias creditadas sem tx (profit+stake típico: amount+profit quando won)
    coalesce((
      SELECT sum(coalesce(p2.amount_cents,0) + coalesce(p2.profit_cents,0))
      FROM public.desafio_participations p2
      WHERE p2.user_id = l.user_id
        AND p2.result = 'won'
        AND coalesce(p2.updated_at, p2.created_at) > l.entered_at
    ), 0) AS wins_apos
  FROM linhas l
  WHERE l.entered_at IS NOT NULL
)
SELECT
  coalesce('#' || d.number::text, '#?') AS desafio,
  left(coalesce(d.title, '?'), 40) AS titulo,
  left(coalesce(st.evento, '—'), 36) AS evento,
  to_char(d.cancelled_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') AS cancel_brt,
  left(coalesce(pr.full_name, u.email::text, left(l.user_id::text, 8)), 28) AS cliente,
  coalesce(u.email::text, '—') AS email,
  trim(to_char(l.stake_cents / 100.0, 'FM999999990.00')) AS stake_entrada,
  trim(to_char(l.refund_cents / 100.0, 'FM999999990.00')) AS devolvido_cancel,
  -- saldo_antes ≈ saldo_atual - créditos_após + débitos_após + outras_entradas_após - wins_após + stake
  trim(to_char(
    (
      coalesce(pr.desafio_balance_cents, 0)
      - coalesce(m.creditos_apos, 0)
      + coalesce(m.debitos_tx_apos, 0)
      + coalesce(m.outras_entradas_apos, 0)
      - coalesce(m.wins_apos, 0)
      + coalesce(l.stake_cents, 0)
    ) / 100.0,
    'FM999999990.00'
  )) AS saldo_antes_entrada,
  trim(to_char(coalesce(pr.desafio_balance_cents, 0) / 100.0, 'FM999999990.00')) AS saldo_desafio_agora,
  trim(to_char(coalesce(a.ajuste_cents, 0) / 100.0, 'FM999999990.00')) AS ajuste_admin_dia,
  l.origem,
  left(coalesce(d.cancelled_by, '—'), 24) AS admin
FROM linhas l
LEFT JOIN desafios_dia d ON d.id = l.desafio_id
LEFT JOIN public.profiles pr ON pr.id = l.user_id
LEFT JOIN auth.users u ON u.id = l.user_id
LEFT JOIN steps st ON st.step_id = l.step_id
LEFT JOIN mov_apos m ON m.participation_id = l.participation_id
LEFT JOIN ajustes a ON a.user_id = l.user_id
WHERE (
  ${ONLY_WITH_CLIENTS} = 0
  OR l.user_id IS NOT NULL
)
ORDER BY d.cancelled_at DESC NULLS LAST, d.number NULLS LAST, pr.full_name NULLS LAST;

\echo
\echo '── Resumo por desafio ──'
WITH bounds AS (
  SELECT timestamptz '${FROM_ISO}' AS t0, timestamptz '${TO_ISO}' AS t1
),
desafios_dia AS (
  SELECT d.id, d.number, d.title,
    coalesce(nullif(d.metadata->>'cancelled_at','')::timestamptz, d.updated_at) AS cancelled_at
  FROM public.desafios d, bounds b
  WHERE (
    d.status = 'cancelled'
    OR (d.metadata ? 'cancelled_by')
    OR (d.metadata ? 'cancelled_at')
  )
  AND coalesce(nullif(d.metadata->>'cancelled_at','')::timestamptz, d.updated_at) >= b.t0
  AND coalesce(nullif(d.metadata->>'cancelled_at','')::timestamptz, d.updated_at) < b.t1
),
refunds AS (
  SELECT
    nullif(wt.metadata->>'desafio_id','')::uuid AS desafio_id,
    wt.user_id,
    wt.amount_cents
  FROM public.wallet_transactions wt, bounds b
  WHERE wt.type = 'desafio_cancel_refund'
    AND wt.created_at >= b.t0 AND wt.created_at < b.t1
)
SELECT
  coalesce('#' || d.number::text, '#?') AS desafio,
  left(coalesce(d.title,'?'), 40) AS titulo,
  count(DISTINCT r.user_id) AS clientes,
  trim(to_char(coalesce(sum(r.amount_cents),0) / 100.0, 'FM999999990.00')) AS total_devolvido
FROM desafios_dia d
LEFT JOIN refunds r ON r.desafio_id = d.id
GROUP BY d.id, d.number, d.title
ORDER BY d.number NULLS LAST;

\echo
\echo '── Totais do dia ──'
WITH bounds AS (
  SELECT timestamptz '${FROM_ISO}' AS t0, timestamptz '${TO_ISO}' AS t1
)
SELECT
  (SELECT count(*) FROM public.desafios d, bounds b
    WHERE (d.status='cancelled' OR d.metadata ? 'cancelled_at')
      AND coalesce(nullif(d.metadata->>'cancelled_at','')::timestamptz, d.updated_at) >= b.t0
      AND coalesce(nullif(d.metadata->>'cancelled_at','')::timestamptz, d.updated_at) < b.t1
  ) AS desafios_cancelados,
  (SELECT count(*) FROM public.wallet_transactions wt, bounds b
    WHERE wt.type='desafio_cancel_refund' AND wt.created_at >= b.t0 AND wt.created_at < b.t1
  ) AS txs_devolucao,
  trim(to_char(coalesce((
    SELECT sum(wt.amount_cents) FROM public.wallet_transactions wt, bounds b
    WHERE wt.type='desafio_cancel_refund' AND wt.created_at >= b.t0 AND wt.created_at < b.t1
  ),0) / 100.0, 'FM999999990.00')) AS total_devolvido_rs;
SQL

echo
echo "Colunas:"
echo "  stake_entrada       = valor debitado da carteira Desafio ao entrar"
echo "  devolvido_cancel    = valor creditado de volta no cancel (desafio_cancel_refund)"
echo "  saldo_antes_entrada = estimativa do Desafio imediatamente antes da entrada"
echo "  saldo_desafio_agora = saldo Desafio atual do cliente"
echo "  ajuste_admin_dia    = ajustes manuais na carteira Desafio no mesmo dia (se houver)"
echo
echo "Fim."
