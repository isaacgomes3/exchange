#!/usr/bin/env bash
# Exporta o projeto Supabase Cloud (wknyfxikmmvjzpbevlid) para ./supabase-export/
# Requer: DATABASE_URL (Connection string do Dashboard → Database → URI)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${SUPABASE_EXPORT_DIR:-$ROOT/supabase-export}"
PROJECT_REF="${SUPABASE_PROJECT_REF:-wknyfxikmmvjzpbevlid}"
mkdir -p "$OUT"

if [[ -z "${DATABASE_URL:-}" ]]; then
  cat <<EOF
Defina DATABASE_URL com a connection string do Supabase Cloud.

Dashboard → Project Settings → Database → Connection string (URI)
Exemplo:
  export DATABASE_URL='postgresql://postgres.[REF]:SENHA@aws-0-sa-east-1.pooler.supabase.com:6543/postgres'

Depois:
  ./scripts/supabase-export-cloud.sh
EOF
  exit 1
fi

echo "==> Dump schema+data → $OUT/db.dump"
# Formato custom (-Fc) para pg_restore
pg_dump "$DATABASE_URL" \
  --no-owner \
  --no-acl \
  --format=custom \
  --file="$OUT/db.dump"

echo "==> Dump SQL plain (fallback) → $OUT/db.sql"
pg_dump "$DATABASE_URL" \
  --no-owner \
  --no-acl \
  --format=plain \
  --file="$OUT/db.sql"

# Storage via API (secret key)
if [[ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" && -n "${SUPABASE_URL:-}" ]]; then
  echo "==> Export storage metadata + objects → $OUT/storage"
  mkdir -p "$OUT/storage"
  node "$ROOT/scripts/supabase-export-storage.mjs" "$OUT/storage"
else
  echo "⚠ Pulei Storage. Defina SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY para exportar arquivos."
fi

cat > "$OUT/meta.json" <<EOF
{
  "projectRef": "$PROJECT_REF",
  "exportedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "sourceUrl": "${SUPABASE_URL:-https://$PROJECT_REF.supabase.co}"
}
EOF

echo ""
echo "✓ Export pronto em $OUT"
echo "  Próximo: copie para a VPS e rode ./scripts/supabase-import-vps.sh"
