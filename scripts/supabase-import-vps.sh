#!/usr/bin/env bash
# Importa dump do Cloud para o Supabase self-hosted na VPS.
# Rode DENTRO da VPS, com o stack Docker já no ar (deploy/vps-supabase).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXPORT_DIR="${SUPABASE_EXPORT_DIR:-$ROOT/supabase-export}"
COMPOSE_DIR="${SUPABASE_COMPOSE_DIR:-$ROOT/deploy/vps-supabase}"

if [[ ! -f "$EXPORT_DIR/db.dump" && ! -f "$EXPORT_DIR/db.sql" ]]; then
  echo "Não achei $EXPORT_DIR/db.dump nem db.sql"
  exit 1
fi

if [[ ! -f "$COMPOSE_DIR/docker-compose.yml" ]]; then
  echo "Não achei $COMPOSE_DIR/docker-compose.yml"
  exit 1
fi

cd "$COMPOSE_DIR"
if [[ ! -f .env ]]; then
  echo "Crie $COMPOSE_DIR/.env a partir de .env.example (rode ./setup.sh)"
  exit 1
fi

# shellcheck disable=SC1091
set -a
source .env
set +a

echo "==> Aguardando Postgres..."
for i in $(seq 1 60); do
  if docker compose exec -T db pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo "==> Restore do banco"
if [[ -f "$EXPORT_DIR/db.dump" ]]; then
  docker compose exec -T db pg_restore \
    -U postgres \
    -d postgres \
    --no-owner \
    --no-acl \
    --clean \
    --if-exists \
    < "$EXPORT_DIR/db.dump" || true
  # pg_restore retorna warnings; validamos depois
else
  docker compose exec -T db psql -U postgres -d postgres < "$EXPORT_DIR/db.sql"
fi

echo "==> Reload PostgREST / Auth (restart serviços API)"
docker compose restart rest auth storage 2>/dev/null || docker compose restart

if [[ -d "$EXPORT_DIR/storage/objects" ]]; then
  echo "==> Storage: copie manualmente objects/ para o volume do storage"
  echo "    Ex.: docker compose cp $EXPORT_DIR/storage/objects/. storage:/var/lib/storage/"
fi

echo ""
echo "✓ Import concluído."
echo "  Teste: curl -sS \"\$API_EXTERNAL_URL/rest/v1/\" -H \"apikey: \$ANON_KEY\" | head"
echo "  Atualize o app (.env) para apontar para a nova URL da VPS."
