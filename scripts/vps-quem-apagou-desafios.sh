#!/usr/bin/env bash
# Lista quem excluiu / cancelou / liquidou (Empate Anula) desafios.
# Resolve e-mail do admin via auth.users.
#
# Na VPS (root):
#   bash <(curl -fsSL -H "Accept: application/vnd.github.raw" \
#     "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-quem-apagou-desafios.sh?ref=cursor/protecao-v10-fonte-verdade-501d&t=$(date +%s)")
#
# Só os 4 de hoje:
#   IDS='9dd0901f-a449-47c1-8443-c1b0c66303c4,e502804b-05ca-4c0d-8f69-a3a45d9d18ee,8beb938c-fa29-4bb6-9d97-fd1650bba3c4,b598561a-abe0-41c3-aeaa-5f1bd7c90d52' \
#     bash <(curl ...)
set -euo pipefail

IDS="${IDS:-}"
LIMIT="${LIMIT:-40}"

die() { echo "ERRO: $*" >&2; exit 1; }
log() { echo "==> $*"; }
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
command -v docker >/dev/null || die "docker"

DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1 || true)"
[[ -n "$DB_CONTAINER" ]] || die "container Postgres não encontrado"

psql_db() {
  if docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@" 2>/tmp/psql-quem.err; then
    return 0
  fi
  docker exec -i "$DB_CONTAINER" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"
}

ID_FILTER_D="TRUE"
ID_FILTER_S="TRUE"
if [[ -n "$IDS" ]]; then
  CLEAN="$(printf '%s' "$IDS" | tr ',' '\n' | sed -E 's/[^0-9a-fA-F-]//g' | grep -E '^[0-9a-fA-F-]{36}$' || true)"
  [[ -n "$CLEAN" ]] || die "IDS inválidos"
  LIST="$(printf "'%s'," $CLEAN | sed 's/,$//')"
  ID_FILTER_D="d.id IN ($LIST)"
  ID_FILTER_S="s.desafio_id IN ($LIST)"
fi

log "1) Soft-delete / cancel no metadata do desafio"
psql_db <<SQL
SELECT
  left(d.id::text, 8) AS id8,
  left(coalesce(d.title, d.name, '?'), 40) AS titulo,
  d.status,
  d.deleted_at,
  coalesce(
    d.metadata->>'deleted_by_email',
    d.metadata->>'cancelled_by_email',
    u_del.email::text,
    u_can.email::text,
    d.metadata->>'deleted_by_name',
    d.metadata->>'cancelled_by_name',
    p_del.full_name,
    p_can.full_name,
    left(coalesce(d.metadata->>'deleted_by', d.metadata->>'cancelled_by', ''), 8)
  ) AS admin,
  coalesce(d.metadata->>'deleted_ip', d.metadata->>'cancelled_ip') AS ip,
  coalesce(d.metadata->>'deleted_at', d.metadata->>'cancelled_at', d.deleted_at::text) AS quando
FROM public.desafios d
LEFT JOIN auth.users u_del ON u_del.id::text = nullif(d.metadata->>'deleted_by','')
LEFT JOIN auth.users u_can ON u_can.id::text = nullif(d.metadata->>'cancelled_by','')
LEFT JOIN public.profiles p_del ON p_del.id::text = nullif(d.metadata->>'deleted_by','')
LEFT JOIN public.profiles p_can ON p_can.id::text = nullif(d.metadata->>'cancelled_by','')
WHERE (
  d.deleted_at IS NOT NULL
  OR d.metadata ? 'deleted_by'
  OR d.metadata ? 'cancelled_by'
  OR d.status IN ('deleted', 'cancelled')
)
AND (${ID_FILTER_D})
ORDER BY coalesce(d.deleted_at, d.updated_at) DESC NULLS LAST
LIMIT ${LIMIT};
SQL

log "2) Liquidações / Empate Anula (etapas) — isso também some o jogo no app"
psql_db <<SQL
SELECT
  left(s.desafio_id::text, 8) AS desafio,
  left(s.id::text, 8) AS step,
  left(coalesce(s.match_label, s.title, '?'), 36) AS jogo,
  s.status,
  s.result,
  s.settled_at,
  coalesce(
    s.metadata->>'settled_by_email',
    u.email::text,
    s.metadata->>'settled_by_name',
    p.full_name,
    left(coalesce(s.settled_by::text, s.metadata->>'settled_by', ''), 8)
  ) AS admin,
  s.metadata->>'settled_ip' AS ip,
  s.metadata->>'settled_outcome' AS outcome
FROM public.desafio_steps s
LEFT JOIN auth.users u ON u.id = s.settled_by
LEFT JOIN public.profiles p ON p.id = s.settled_by
WHERE (
  s.settled_at IS NOT NULL
  OR s.result IN ('void', 'cancelled')
  OR (s.status = 'done' AND s.settled_by IS NOT NULL)
)
AND (${ID_FILTER_S})
ORDER BY s.settled_at DESC NULLS LAST
LIMIT ${LIMIT};
SQL

log "3) Nginx (últimos delete/settle/cancel com IP)"
if [[ -f /var/log/nginx/access.log ]]; then
  zgrep -hE 'desafio-delete|desafio-settle|desafio-cancel' /var/log/nginx/access.log* 2>/dev/null \
    | tail -n 40 \
    | awk '{ip=$1; ts=$4" "$5; req=$6" "$7; code=$9; print ip, ts, req, code}' \
    || echo "(sem linhas recentes)"
else
  echo "(sem access.log nginx)"
fi

echo
echo "OK — se admin/IP vazios, a ação foi ANTES do hotfix de audit."
echo "UI: Admin → Desafios → aba Excluídos (e-mail + IP quando gravado)."
echo "Obs: Empate Anula/Liquidar aparece na seção 2 (não na aba Excluídos)."
