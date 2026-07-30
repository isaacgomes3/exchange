#!/usr/bin/env bash
# Lista quem excluiu / cancelou / liquidou (Empate Anula) desafios.
#
# Na VPS (root):
#   bash <(curl -fsSL -H "Accept: application/vnd.github.raw" \
#     "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-quem-apagou-desafios.sh?ref=cursor/protecao-v10-fonte-verdade-501d&t=$(date +%s)")
set -euo pipefail

IDS="${IDS:-}"
LIMIT="${LIMIT:-50}"

die() { echo "ERRO: $*" >&2; exit 1; }
log() { echo; echo "==> $*"; }
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
command -v docker >/dev/null || die "docker"

DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1 || true)"
[[ -n "$DB_CONTAINER" ]] || die "container Postgres não encontrado"

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

ID_FILTER_D="TRUE"
ID_FILTER_S="TRUE"
if [[ -n "$IDS" ]]; then
  CLEAN="$(printf '%s' "$IDS" | tr ',' '\n' | sed -E 's/[^0-9a-fA-F-]//g' | grep -E '^[0-9a-fA-F-]{36}$' || true)"
  [[ -n "$CLEAN" ]] || die "IDS inválidos"
  LIST="$(printf "'%s'," $CLEAN | sed 's/,$//')"
  ID_FILTER_D="d.id IN ($LIST)"
  ID_FILTER_S="s.desafio_id IN ($LIST)"
fi

log "1) Soft-delete / cancel (metadata do desafio) — inclui restaurados se ainda tiver deleted_by"
psql_db <<SQL
\pset pager off
\x off
SELECT
  left(d.id::text, 8) AS id8,
  left(coalesce(d.title, '?'), 36) AS titulo,
  d.status,
  CASE WHEN d.deleted_at IS NOT NULL THEN 'SIM' ELSE 'nao' END AS excluido_agora,
  coalesce(
    d.metadata->>'deleted_by_email',
    d.metadata->>'cancelled_by_email',
    u_del.email::text,
    u_can.email::text,
    d.metadata->>'deleted_by_name',
    d.metadata->>'cancelled_by_name',
    p_del.full_name,
    p_can.full_name,
    nullif(left(coalesce(d.metadata->>'deleted_by', d.metadata->>'cancelled_by', ''), 8), '')
  ) AS admin,
  coalesce(d.metadata->>'deleted_ip', d.metadata->>'cancelled_ip') AS ip,
  coalesce(
    d.metadata->>'deleted_at',
    d.metadata->>'cancelled_at',
    d.deleted_at::text,
    d.updated_at::text
  ) AS quando
FROM public.desafios d
LEFT JOIN auth.users u_del
  ON u_del.id::text = nullif(d.metadata->>'deleted_by','')
LEFT JOIN auth.users u_can
  ON u_can.id::text = nullif(d.metadata->>'cancelled_by','')
LEFT JOIN public.profiles p_del
  ON p_del.id::text = nullif(d.metadata->>'deleted_by','')
LEFT JOIN public.profiles p_can
  ON p_can.id::text = nullif(d.metadata->>'cancelled_by','')
WHERE (
  d.deleted_at IS NOT NULL
  OR (d.metadata ? 'deleted_by')
  OR (d.metadata ? 'cancelled_by')
  OR (d.metadata ? 'deleted_ip')
  OR d.status IN ('deleted', 'cancelled')
)
AND (${ID_FILTER_D})
ORDER BY coalesce(d.deleted_at, d.updated_at) DESC NULLS LAST
LIMIT ${LIMIT};
SQL
echo "(se vazio: exclusões antigas sem audit, ou jogos só liquidados — veja seção 2)"

log "2) Liquidações / Empate Anula (etapas) — some o jogo no app sem ir pra Excluídos"
psql_db <<SQL
\pset pager off
SELECT
  left(s.desafio_id::text, 8) AS desafio,
  left(coalesce(d.title, s.match_label, '?'), 32) AS jogo,
  s.status,
  s.result,
  s.settled_at,
  coalesce(
    s.metadata->>'settled_by_email',
    u.email::text,
    s.metadata->>'settled_by_name',
    p.full_name,
    nullif(left(coalesce(s.settled_by::text, ''), 8), '')
  ) AS admin,
  s.metadata->>'settled_ip' AS ip,
  coalesce(s.metadata->>'settled_outcome', s.result::text) AS outcome
FROM public.desafio_steps s
LEFT JOIN public.desafios d ON d.id = s.desafio_id
LEFT JOIN auth.users u ON u.id = s.settled_by
LEFT JOIN public.profiles p ON p.id = s.settled_by
WHERE s.settled_at IS NOT NULL
  AND (${ID_FILTER_S})
ORDER BY s.settled_at DESC NULLS LAST
LIMIT ${LIMIT};
SQL

log "3) Nginx — só API real (/api/arbishield/desafio-delete|settle|cancel)"
FOUND=0
shopt -s nullglob
for f in /var/log/nginx/access.log /var/log/nginx/access.log.* /var/log/nginx/*access*.log; do
  [[ -e "$f" ]] || continue
done
# zgrep em access.log* (evita CSS ?v=desafio-cancelar-entrada)
if ls /var/log/nginx/access.log* >/dev/null 2>&1; then
  # shellcheck disable=SC2016
  MATCHES="$(
    zgrep -hE 'POST /api/arbishield/desafio-(delete|settle|cancel)|"/api/arbishield/desafio-(delete|settle|cancel)' \
      /var/log/nginx/access.log* 2>/dev/null \
      | grep -vE 'v2\.css|stadium-hero|\.jpg|\.js\?' \
      | tail -n 60 || true
  )"
  if [[ -n "${MATCHES// /}" ]]; then
    FOUND=1
    echo "$MATCHES" | awk '{
      ip=$1; ts=$4" "$5;
      for(i=1;i<=NF;i++) if($i ~ /desafio-(delete|settle|cancel)/) { api=$i; break }
      code="";
      for(i=NF;i>=1;i--) if($i ~ /^[0-9]{3}$/) { code=$i; break }
      print ip, ts, api, code
    }'
  fi
fi
if [[ "$FOUND" -eq 0 ]]; then
  echo "(nenhum POST /api/arbishield/desafio-delete|settle|cancel nos logs rotacionados)"
  echo "Dica: grep manual → zgrep -h 'desafio-settle' /var/log/nginx/access.log* | tail"
fi

log "4) Conf nginx (onde está o proxy :3101)"
NGINX_HITS="$(grep -RIl '3101\|desafio-settle\|desafio-delete' /etc/nginx 2>/dev/null | head -20 || true)"
if [[ -n "$NGINX_HITS" ]]; then
  echo "$NGINX_HITS"
else
  echo "(nenhum arquivo em /etc/nginx menciona 3101/desafio-settle — conf pode estar noutro path)"
  ls -la /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null || true
fi

echo
echo "OK"
echo "UI: Admin → Desafios → Excluídos (e-mail+IP se audit gravou)."
echo "Empate Anula/Liquidar = seção 2 deste script."
echo "Se seção 1/2 vazias e nginx sem POST API: ação foi antes do audit OU logs já rotacionaram."
