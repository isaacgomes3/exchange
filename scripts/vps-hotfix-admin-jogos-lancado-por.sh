#!/usr/bin/env bash
# Publica Gestão de Jogos com "Lançado por" / "Encerrado por" (nomes).
# Também reinicia prelive + backfill SQL se possível.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/jogos-lancado-por-nome-8f4a/scripts/vps-hotfix-admin-jogos-lancado-por.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/jogos-lancado-por-nome-8f4a}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
COMPOSE_DIR="${ARBISHIELD_COMPOSE:-/opt/arbishield/deploy/vps-supabase}"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"

echo "==> hotfix admin-jogos lançado por ($(date -Is)) ref=$REF"

publish() {
  local rel="$1"
  local name
  name="$(basename "$rel")"
  local tmp
  tmp="$(mktemp)"
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$RAW/$rel?t=$(date +%s%N)" -o "$tmp"
  local n=0
  while IFS= read -r -d '' f; do
    cp -a "$f" "${f}.bak-lancado-por-$(date +%s)" 2>/dev/null || true
    cp -f "$tmp" "$f"
    chmod 0644 "$f"
    echo "  OK $f"
    n=$((n + 1))
  done < <(find /var/www -type f -name "$name" -print0 2>/dev/null)
  mkdir -p "$WEB_ROOT" "$WEB_ROOT/v2"
  cp -f "$tmp" "$WEB_ROOT/$name" 2>/dev/null || true
  cp -f "$tmp" "$WEB_ROOT/v2/$name" 2>/dev/null || true
  rm -f "$tmp"
  [[ "$n" -gt 0 ]] || echo "  AVISO: nenhum $name em /var/www (copiado em $WEB_ROOT)"
}

publish_script() {
  local rel="$1"
  local tmp
  tmp="$(mktemp)"
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$RAW/$rel?t=$(date +%s%N)" -o "$tmp"
  mkdir -p "$SHIM_DIR/scripts" "$SHIM_DIR"
  cp -f "$tmp" "$SHIM_DIR/scripts/$(basename "$rel")"
  cp -f "$tmp" "$SHIM_DIR/$(basename "$rel")"
  chmod 0644 "$SHIM_DIR/scripts/$(basename "$rel")" "$SHIM_DIR/$(basename "$rel")"
  echo "  OK $SHIM_DIR/$(basename "$rel")"
  rm -f "$tmp"
}

run_sql() {
  local sql="$1"
  if command -v docker >/dev/null 2>&1; then
    local ctr
    ctr="$(docker ps --format '{{.Names}}' | grep -E '^(supabase-db|db|postgres)$|db|postgres' | head -1 || true)"
    if [[ -n "$ctr" ]]; then
      docker exec -i "$ctr" psql -U postgres -d postgres -v ON_ERROR_STOP=0 -c "$sql" && return 0
      docker exec -i "$ctr" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=0 -c "$sql" && return 0
    fi
  fi
  return 1
}

publish deploy/vps-supabase/static/v2/admin-jogos.html
publish_script scripts/arbishield-prelive-events.mjs

echo "==> SQL backfill nomes reais (profiles + auth.users), corrige prefixos UUID"
SQL="$(cat <<'SQL'
-- Helper inline: nome amigável (nunca prefixo de UUID se houver email/nome)
-- Regrava created_by_name fraco (vazio ou 8 hex)
UPDATE public.matches m
SET metadata = coalesce(m.metadata, '{}'::jsonb) || jsonb_build_object(
  'created_by', m.created_by::text,
  'created_by_name', coalesce(
    nullif(btrim(p.full_name), ''),
    nullif(split_part(nullif(btrim(p.email), ''), '@', 1), ''),
    nullif(btrim(p.email), ''),
    nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
    nullif(btrim(u.raw_user_meta_data->>'name'), ''),
    nullif(split_part(nullif(btrim(u.email), ''), '@', 1), ''),
    nullif(btrim(u.email), '')
  )
)
FROM public.profiles p
LEFT JOIN auth.users u ON u.id = p.id
WHERE m.deleted_at IS NULL
  AND m.created_by IS NOT NULL
  AND m.created_by = p.id
  AND (
    coalesce(m.metadata->>'created_by_name', '') = ''
    OR m.metadata->>'created_by_name' ~* '^[0-9a-f]{8}$'
    OR m.metadata->>'created_by_name' ~* '^[0-9a-f-]{36}$'
  )
  AND coalesce(
    nullif(btrim(p.full_name), ''),
    nullif(btrim(p.email), ''),
    nullif(btrim(u.email), ''),
    nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
    nullif(btrim(u.raw_user_meta_data->>'name'), '')
  ) IS NOT NULL;

UPDATE public.matches m
SET metadata = coalesce(m.metadata, '{}'::jsonb) || jsonb_build_object(
  'settled_by', m.settled_by::text,
  'settled_by_name', coalesce(
    nullif(btrim(p.full_name), ''),
    nullif(split_part(nullif(btrim(p.email), ''), '@', 1), ''),
    nullif(btrim(p.email), ''),
    nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
    nullif(btrim(u.raw_user_meta_data->>'name'), ''),
    nullif(split_part(nullif(btrim(u.email), ''), '@', 1), ''),
    nullif(btrim(u.email), '')
  )
)
FROM public.profiles p
LEFT JOIN auth.users u ON u.id = p.id
WHERE m.deleted_at IS NULL
  AND m.settled_by IS NOT NULL
  AND m.settled_by = p.id
  AND (
    coalesce(m.metadata->>'settled_by_name', '') = ''
    OR m.metadata->>'settled_by_name' ~* '^[0-9a-f]{8}$'
    OR m.metadata->>'settled_by_name' ~* '^[0-9a-f-]{36}$'
  )
  AND coalesce(
    nullif(btrim(p.full_name), ''),
    nullif(btrim(p.email), ''),
    nullif(btrim(u.email), ''),
    nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
    nullif(btrim(u.raw_user_meta_data->>'name'), '')
  ) IS NOT NULL;

-- Encerrado por: puxa admin_id do audit quando settled_by está vazio
UPDATE public.matches m
SET
  settled_by = a.admin_id,
  updated_by = coalesce(m.updated_by, a.admin_id),
  metadata = coalesce(m.metadata, '{}'::jsonb) || jsonb_build_object(
    'settled_by', a.admin_id::text,
    'settled_by_name', coalesce(
      nullif(btrim(p.full_name), ''),
      nullif(split_part(nullif(btrim(p.email), ''), '@', 1), ''),
      nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
      nullif(split_part(nullif(btrim(u.email), ''), '@', 1), ''),
      nullif(btrim(u.email), '')
    )
  )
FROM (
  SELECT DISTINCT ON (entity_id)
    entity_id,
    admin_id
  FROM public.admin_audit_logs
  WHERE entity_type = 'matches'
    AND admin_id IS NOT NULL
    AND (
      action ILIKE '%SETTLE%'
      OR action ILIKE '%ENCERR%'
    )
  ORDER BY entity_id, created_at DESC
) a
JOIN public.profiles p ON p.id = a.admin_id
LEFT JOIN auth.users u ON u.id = a.admin_id
WHERE m.deleted_at IS NULL
  AND m.settled_at IS NOT NULL
  AND m.settled_by IS NULL
  AND a.entity_id::text = m.id::text;

-- Lançado por: primeiro admin que tocou o jogo na auditoria
UPDATE public.matches m
SET
  created_by = a.admin_id,
  metadata = coalesce(m.metadata, '{}'::jsonb) || jsonb_build_object(
    'created_by', a.admin_id::text,
    'created_by_name', coalesce(
      nullif(btrim(p.full_name), ''),
      nullif(split_part(nullif(btrim(p.email), ''), '@', 1), ''),
      nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
      nullif(split_part(nullif(btrim(u.email), ''), '@', 1), ''),
      nullif(btrim(u.email), '')
    )
  )
FROM (
  SELECT DISTINCT ON (entity_id)
    entity_id,
    admin_id
  FROM public.admin_audit_logs
  WHERE entity_type = 'matches'
    AND admin_id IS NOT NULL
  ORDER BY entity_id, created_at ASC
) a
JOIN public.profiles p ON p.id = a.admin_id
LEFT JOIN auth.users u ON u.id = a.admin_id
WHERE m.deleted_at IS NULL
  AND (
    m.created_by IS NULL
    OR coalesce(m.metadata->>'created_by_name', '') = ''
    OR m.metadata->>'created_by_name' ~* '^[0-9a-f]{8}$'
  )
  AND a.entity_id::text = m.id::text
  AND coalesce(
    nullif(btrim(p.full_name), ''),
    nullif(btrim(p.email), ''),
    nullif(btrim(u.email), ''),
    nullif(btrim(u.raw_user_meta_data->>'full_name'), '')
  ) IS NOT NULL;
SQL
)"
if run_sql "$SQL"; then
  echo "  OK SQL backfill"
else
  echo "  AVISO: SQL backfill não rodou (docker/psql?). UI ainda tenta auditoria no browser."
fi

systemctl restart arbishield-prelive-events.service 2>/dev/null || true
systemctl restart arbishield-prelive-events-teste.service 2>/dev/null || true

html="$(curl -fsS -m 8 "https://arbishield.app/admin-jogos.html" 2>/dev/null || true)"
if echo "$html" | grep -q 'admin-jogos-lancado-por-v11'; then
  echo "  smoke admin-jogos.html → OK (v11)"
else
  echo "  AVISO: build v11 ainda não público"
fi

echo
echo "OK — Ctrl+Shift+R em https://arbishield.app/admin-jogos.html"
echo "Confira Finalizados: Lançado por / Encerrado por com nome."
