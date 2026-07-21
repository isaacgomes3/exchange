#!/usr/bin/env bash
# Hotfix v3: Falha Crítica de Integridade ao ativar proteção
#
# Causa raiz: trigger Postgres exige débito + proteção na MESMA transação.
# REST separado (wallet depois/antes) continua falhando.
#
# Este script:
#   1) aplica RPC SQL arbishield_create_protection no Postgres (Docker)
#   2) atualiza o prelive :3098 para chamar a RPC
#
# Na VPS (obrigatório):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-protecao-integridade-debito-723d/scripts/vps-hotfix-protecao-integridade-debito.sh?v=3")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/fix-protecao-integridade-debito-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/arbishield/deploy/vps-supabase}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
need docker
mkdir -p "$SCRIPTS_DIR"

log "1/4 — baixar SQL + prelive"
curl -fsSL "$RAW/supabase/migrations/20260721_arbishield_create_protection_rpc.sql" \
  -o /tmp/arbishield_create_protection_rpc.sql
grep -q 'arbishield_create_protection' /tmp/arbishield_create_protection_rpc.sql \
  || die "SQL sem arbishield_create_protection"

curl -fsSL "$RAW/scripts/arbishield-prelive-events.mjs" \
  -o "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
chmod 0755 "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
grep -q 'integridade-debito-v3' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" \
  || die "prelive sem marcador integridade-debito-v3"
grep -q 'arbishield_create_protection' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" \
  || die "prelive sem chamada RPC"

log "2/4 — aplicar SQL no Postgres"
DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1 || true)"
[[ -n "$DB_CONTAINER" ]] || die "container Postgres não encontrado (docker ps)"

# Diagnóstico do trigger (não bloqueia)
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=0 <<'SQL' || true
\echo === triggers on protections ===
SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
 WHERE tgrelid = 'public.protections'::regclass AND NOT tgisinternal;
\echo === functions mentioning débito/integridade ===
SELECT n.nspname||'.'||p.proname
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE p.prosrc ILIKE '%registro de débito%'
    OR p.prosrc ILIKE '%Falha Crítica de Integridade%';
SQL

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < /tmp/arbishield_create_protection_rpc.sql \
  || docker exec -i "$DB_CONTAINER" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 \
       < /tmp/arbishield_create_protection_rpc.sql \
  || die "falha ao aplicar SQL da RPC"

# Reload PostgREST schema cache se possível
docker ps --format '{{.Names}}' | grep -E 'rest|postgrest' | while read -r c; do
  docker kill -s SIGUSR1 "$c" 2>/dev/null || docker restart "$c" 2>/dev/null || true
done

log "3/4 — reiniciar prelive :3098"
systemctl restart arbishield-prelive-events.service 2>/dev/null || true
sleep 1

log "4/4 — smoke"
CODE=$(curl -sS -o /tmp/prelive-health.json -w "%{http_code}" \
  http://127.0.0.1:3098/health || echo 000)
BODY=$(cat /tmp/prelive-health.json 2>/dev/null || true)
echo "  health HTTP $CODE · $BODY"
[[ "$CODE" == "200" ]] || die "prelive health falhou"
echo "$BODY" | grep -q 'integridade-debito-v3' \
  || die "Serviço ainda sem v3 — restart falhou"

# Confirma RPC existe
RPC_OK=$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -Atc \
  "SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='arbishield_create_protection';" \
  || echo 0)
[[ "$RPC_OK" == "1" ]] || die "RPC arbishield_create_protection não encontrada no banco"
echo "  RPC arbishield_create_protection: ok"

echo
echo "OK — Integridade v3 (RPC mesma transação)"
echo "  Teste: https://arbishield.app/app-proteger.html → Ativar proteção"
echo "  Se ainda falhar, cole a saída dos triggers do passo 2/4"
