#!/usr/bin/env bash
# Backup completo ArbiShield na VPS → pasta local + artefatos seguros p/ GitHub.
#
# - Schema SQL → pode ir pro GitHub
# - Data dump → SÓ /opt/arbishield/backups (NÃO commit)
# - Espelho frontend público → backup/frontend-mirror
#
# Uso (root na VPS):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/arbishield-v2-backup-723d/scripts/vps-backup-full.sh?v=1")
set -euo pipefail

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_ROOT="${BACKUP_ROOT:-/opt/arbishield/backups}"
OUT="$BACKUP_ROOT/$STAMP"
REPO="${REPO_DIR:-/opt/arbishield/app}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/arbishield/deploy/vps-supabase}"
PUBLIC_URL="${PUBLIC_URL:-https://arbishield.app}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }

mkdir -p "$OUT" "$OUT/infra" "$OUT/www-meta"

log "1/5 — schema SQL (seguro p/ GitHub)"
DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1 || true)"
if [[ -z "$DB_CONTAINER" ]]; then
  die "container Postgres não encontrado (docker ps)"
fi

# Tenta user padrão supabase
if docker exec "$DB_CONTAINER" pg_dump -U postgres --schema-only --no-owner --no-privileges postgres \
  > "$OUT/schema.sql" 2>/tmp/pg_dump_schema.err; then
  log "schema ok ($(wc -c < "$OUT/schema.sql") bytes)"
else
  # fallback supabase_admin
  docker exec "$DB_CONTAINER" pg_dump -U supabase_admin --schema-only --no-owner --no-privileges postgres \
    > "$OUT/schema.sql" || die "pg_dump schema falhou: $(cat /tmp/pg_dump_schema.err)"
fi

# Lista de tabelas
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -Atc \
  "SELECT schemaname||'.'||tablename FROM pg_tables WHERE schemaname IN ('public','auth','storage') ORDER BY 1;" \
  > "$OUT/tables.txt" 2>/dev/null || true

log "2/5 — dump de DADOS (somente VPS, fora do git)"
if docker exec "$DB_CONTAINER" pg_dump -U postgres -Fc --no-owner postgres \
  > "$OUT/data.dump" 2>/tmp/pg_dump_data.err; then
  log "data.dump ok ($(wc -c < "$OUT/data.dump") bytes) — NÃO enviar ao GitHub"
else
  echo "AVISO: data.dump falhou: $(cat /tmp/pg_dump_data.err)" >&2
fi

log "3/5 — infra (nginx, compose, sem .env)"
if [[ -d "$COMPOSE_DIR" ]]; then
  cp -a "$COMPOSE_DIR/docker-compose.yml" "$OUT/infra/" 2>/dev/null || true
  cp -a "$COMPOSE_DIR/docker-compose.nginx.yml" "$OUT/infra/" 2>/dev/null || true
  cp -a "$COMPOSE_DIR"/nginx*.conf "$OUT/infra/" 2>/dev/null || true
  # Nunca copia .env
fi
if [[ -d "$WEB" ]]; then
  find "$WEB" -maxdepth 2 -type f \( -name 'index.html' -o -name '*.conf' -o -name 'manifest.json' \) \
    -exec cp -a {} "$OUT/www-meta/" \; 2>/dev/null || true
  ls -la "$WEB/assets" 2>/dev/null | head -50 > "$OUT/www-meta/assets-listing.txt" || true
fi

log "4/5 — espelho frontend público ($PUBLIC_URL)"
MIRROR_DIR="$OUT/frontend-mirror"
mkdir -p "$MIRROR_DIR"
if command -v node >/dev/null 2>&1 && [[ -f "$REPO/scripts/mirror-arbishield-app.mjs" ]]; then
  (
    cd "$REPO"
    ARBISHIELD_REMOTE_ORIGIN="$PUBLIC_URL" node scripts/mirror-arbishield-app.mjs || true
    if [[ -d "$REPO/arbishield-local" ]]; then
      rsync -a --delete "$REPO/arbishield-local/" "$MIRROR_DIR/" || \
        cp -a "$REPO/arbishield-local/." "$MIRROR_DIR/"
    fi
  )
else
  # Fallback mínimo: index + CSS/JS principais
  curl -fsSL "$PUBLIC_URL/" -o "$MIRROR_DIR/index.html" || true
  mkdir -p "$MIRROR_DIR/assets"
  MAIN_JS="$(grep -oE '/assets/main-[A-Za-z0-9_-]+\.js' "$MIRROR_DIR/index.html" | head -1 || true)"
  MAIN_CSS="$(grep -oE '/assets/main-[A-Za-z0-9_-]+\.css' "$MIRROR_DIR/index.html" | head -1 || true)"
  [[ -n "$MAIN_JS" ]] && curl -fsSL "$PUBLIC_URL$MAIN_JS" -o "$MIRROR_DIR${MAIN_JS}" || true
  [[ -n "$MAIN_CSS" ]] && curl -fsSL "$PUBLIC_URL$MAIN_CSS" -o "$MIRROR_DIR${MAIN_CSS}" || true
fi

log "5/5 — manifesto"
cat > "$OUT/MANIFEST.txt" <<EOF
ArbiShield backup $STAMP
public_url=$PUBLIC_URL
db_container=$DB_CONTAINER
schema=$OUT/schema.sql
data=$OUT/data.dump  (LOCAL ONLY — not for GitHub)
frontend=$MIRROR_DIR
EOF

# Copia schema (+ mirror) para o repo se existir checkout
if [[ -d "$REPO/backup" ]]; then
  mkdir -p "$REPO/backup/schema" "$REPO/backup/frontend-mirror"
  cp -f "$OUT/schema.sql" "$REPO/backup/schema/schema-$STAMP.sql"
  cp -f "$OUT/tables.txt" "$REPO/backup/schema/tables-$STAMP.txt" 2>/dev/null || true
  ln -sfn "schema-$STAMP.sql" "$REPO/backup/schema/schema-latest.sql"
  if [[ -d "$MIRROR_DIR" ]] && [[ "$(ls -A "$MIRROR_DIR" 2>/dev/null | head -1)" ]]; then
    rsync -a --delete --exclude '.git' "$MIRROR_DIR/" "$REPO/backup/frontend-mirror/" 2>/dev/null || \
      cp -a "$MIRROR_DIR/." "$REPO/backup/frontend-mirror/"
  fi
  log "artefatos seguros copiados para $REPO/backup/"
  echo "Para publicar no GitHub (na pasta do repo):"
  echo "  cd $REPO && git checkout cursor/arbishield-v2-backup-723d"
  echo "  git add backup/schema backup/frontend-mirror backup/README.md"
  echo "  git commit -m \"backup: schema + frontend mirror $STAMP\""
  echo "  git push"
fi

echo
echo "OK — backup em $OUT"
echo "  Schema (GitHub-safe): $OUT/schema.sql"
echo "  Dados (SÓ VPS):       $OUT/data.dump"
echo "  Frontend mirror:      $MIRROR_DIR"
echo
echo "NÃO faça commit de data.dump nem de .env"
