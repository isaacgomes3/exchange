#!/usr/bin/env bash
# Exporta o projeto Supabase Cloud (wknyfxikmmvjzpbevlid) para ./supabase-export/
# Aceita:
#   DATABASE_URL  — URI completa (Dashboard → Database → Connection string)
#   ou DB_PASSWORD — só a senha do banco (monta a URI do pooler us-east-2)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${SUPABASE_EXPORT_DIR:-$ROOT/supabase-export}"
PROJECT_REF="${SUPABASE_PROJECT_REF:-wknyfxikmmvjzpbevlid}"
POOLER_HOST="${SUPABASE_POOLER_HOST:-aws-1-us-east-2.pooler.supabase.com}"
mkdir -p "$OUT"

# Carrega URL + service role de .env.local sem `source` (evita quebras com caracteres especiais)
if [[ -f "$ROOT/.env.local" ]]; then
  eval "$(python3 - "$ROOT/.env.local" <<'PY'
import shlex, sys
from pathlib import Path
path = Path(sys.argv[1])
wanted = {
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "DB_PASSWORD",
    "DATABASE_URL",
}
for line in path.read_text().splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    k = k.strip()
    v = v.strip().strip("\"'")
    if k in wanted and k not in __import__("os").environ:
        print(f"export {k}={shlex.quote(v)}")
PY
)"
fi

if [[ -z "${DATABASE_URL:-}" && -n "${DB_PASSWORD:-}" ]]; then
  ENC_PW="$(DB_PASSWORD="$DB_PASSWORD" python3 -c 'import os,urllib.parse; print(urllib.parse.quote(os.environ["DB_PASSWORD"], safe=""))')"
  # Session mode (:5432) is required for pg_dump; transaction pooler (:6543) can auth but is flaky for dumps.
  DATABASE_URL="postgresql://postgres.${PROJECT_REF}:${ENC_PW}@${POOLER_HOST}:5432/postgres?sslmode=require"
  export DATABASE_URL
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  cat <<EOF
Defina a senha do banco Cloud (ou a URI completa).

Opção A — só a senha (recomendado):
  export DB_PASSWORD='sua-senha-do-dashboard'
  ./scripts/supabase-export-cloud.sh

Opção B — URI completa:
  Dashboard → Project Settings → Database → Connection string (URI)
  Região deste projeto: aws-1-us-east-2
  Exemplo:
    export DATABASE_URL='postgresql://postgres.${PROJECT_REF}:SENHA@${POOLER_HOST}:6543/postgres?sslmode=require'
  ./scripts/supabase-export-cloud.sh
EOF
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump não encontrado. Instale postgresql-client (versão >= servidor Cloud, hoje 17.x)."
  exit 1
fi

PG_DUMP_VER="$(pg_dump --version | grep -oE '[0-9]+' | head -1)"
if [[ "${PG_DUMP_VER:-0}" -lt 17 ]]; then
  cat <<EOF
pg_dump local é ${PG_DUMP_VER}.x, mas o Cloud está em Postgres 17.
Rode o dump na VPS (tem pg_dump 17 no container db):

  # na VPS, com DB_PASSWORD definido:
  cd /opt/arbishield/deploy/vps-supabase
  docker compose exec -T -e PGPASSWORD="\$DB_PASSWORD" db pg_dump \\
    -h ${POOLER_HOST} -p 5432 -U postgres.${PROJECT_REF} -d postgres \\
    --no-owner --no-acl -Fc -f /tmp/db.dump
EOF
  exit 1
fi

echo "==> Testando conexão..."
psql "$DATABASE_URL" -c 'select current_database(), current_user;' >/dev/null

echo "==> Dump schema+data → $OUT/db.dump"
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

SUPABASE_URL="${SUPABASE_URL:-${NEXT_PUBLIC_SUPABASE_URL:-https://$PROJECT_REF.supabase.co}}"
export SUPABASE_URL

if [[ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" && -n "${SUPABASE_URL:-}" ]]; then
  echo "==> Export storage metadata + objects → $OUT/storage"
  mkdir -p "$OUT/storage"
  node "$ROOT/scripts/supabase-export-storage.mjs" "$OUT/storage"
else
  echo "WARN: Pulei Storage. Defina SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY para exportar arquivos."
fi

cat > "$OUT/meta.json" <<EOF
{
  "projectRef": "$PROJECT_REF",
  "poolerHost": "$POOLER_HOST",
  "exportedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "sourceUrl": "$SUPABASE_URL"
}
EOF

echo ""
echo "OK: Export pronto em $OUT"
echo "  Proximo: rsync para a VPS e rode ./scripts/supabase-import-vps.sh"
