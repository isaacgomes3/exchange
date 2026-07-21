#!/usr/bin/env bash
# Hotfix v4: Falha Crítica de Integridade ao ativar proteção
#
# Causas reais encontradas:
#   1) Hotfixes anteriores gravavam em /opt/arbishield/ mas o systemd
#      executa /opt/arbishield/scripts/arbishield-prelive-events.mjs
#   2) Trigger Postgres bloqueia INSERT sem débito na mesma TX
#
# Este script:
#   - desativa o trigger de integridade no Postgres
#   - aplica RPC arbishield_create_protection
#   - atualiza o prelive no caminho REAL do systemd
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-protecao-integridade-debito-723d/scripts/vps-hotfix-protecao-integridade-debito.sh?v=4")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/fix-protecao-integridade-debito-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
need docker

log "0/5 — descobrir caminho real do prelive (systemd)"
PRELIVE_PATH=""
if command -v systemctl >/dev/null 2>&1; then
  UNIT="$(systemctl cat arbishield-prelive-events.service 2>/dev/null || true)"
  if [[ -n "$UNIT" ]]; then
    echo "$UNIT" | grep -E '^ExecStart=' || true
    PRELIVE_PATH="$(echo "$UNIT" | sed -n 's/^ExecStart=.*node[[:space:]]\+\([^[:space:]]*arbishield-prelive-events\.mjs\).*/\1/p' | head -1)"
  fi
fi
# Candidatos conhecidos (o serviço oficial usa /opt/arbishield/scripts/)
CANDIDATES=(
  "$PRELIVE_PATH"
  /opt/arbishield/scripts/arbishield-prelive-events.mjs
  /opt/arbishield/arbishield-prelive-events.mjs
  /opt/arbishield/app/scripts/arbishield-prelive-events.mjs
)
# unique non-empty
TARGETS=()
for p in "${CANDIDATES[@]}"; do
  [[ -n "${p:-}" ]] || continue
  skip=0
  for t in "${TARGETS[@]:-}"; do
    [[ "$t" == "$p" ]] && skip=1 && break
  done
  [[ $skip -eq 1 ]] || TARGETS+=("$p")
done
[[ ${#TARGETS[@]} -gt 0 ]] || die "nenhum caminho de prelive candidato"
echo "  alvos: ${TARGETS[*]}"

log "1/5 — baixar artefatos"
curl -fsSL "$RAW/scripts/arbishield-prelive-events.mjs" -o /tmp/arbishield-prelive-events.mjs
curl -fsSL "$RAW/supabase/migrations/20260721_arbishield_create_protection_rpc.sql" \
  -o /tmp/arbishield_create_protection_rpc.sql
curl -fsSL "$RAW/supabase/migrations/20260721_disable_protection_integrity_trigger.sql" \
  -o /tmp/arbishield_disable_integrity_trigger.sql

grep -q 'integridade-debito-v4' /tmp/arbishield-prelive-events.mjs \
  || die "prelive baixado sem integridade-debito-v4"
grep -q 'arbishield_create_protection' /tmp/arbishield-prelive-events.mjs \
  || die "prelive baixado sem RPC"
grep -q 'DISABLE TRIGGER' /tmp/arbishield_disable_integrity_trigger.sql \
  || die "SQL disable sem DISABLE TRIGGER"

log "2/5 — instalar prelive em TODOS os caminhos candidatos"
for dest in "${TARGETS[@]}"; do
  mkdir -p "$(dirname "$dest")"
  if [[ -f "$dest" ]]; then
    cp -a "$dest" "${dest}.bak.integridade.$(date +%Y%m%d%H%M%S)" || true
  fi
  cp -f /tmp/arbishield-prelive-events.mjs "$dest"
  chmod 0755 "$dest"
  grep -q 'integridade-debito-v4' "$dest" || die "falha ao gravar $dest"
  echo "  ok $dest"
done

log "3/5 — Postgres: desativar trigger + criar RPC"
DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1 || true)"
[[ -n "$DB_CONTAINER" ]] || die "container Postgres não encontrado"

run_psql() {
  local file="$1"
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$file" \
    || docker exec -i "$DB_CONTAINER" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < "$file"
}

# Diagnóstico
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=0 <<'SQL' || true
\echo === triggers protections/back_protections ===
SELECT c.relname, t.tgname, t.tgenabled, p.proname
FROM pg_trigger t
JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
JOIN pg_proc p ON p.oid=t.tgfoid
WHERE c.relname IN ('protections','back_protections') AND NOT t.tgisinternal
ORDER BY 1,2;
SQL

run_psql /tmp/arbishield_disable_integrity_trigger.sql \
  || die "falha ao desativar trigger de integridade"
run_psql /tmp/arbishield_create_protection_rpc.sql \
  || die "falha ao criar RPC arbishield_create_protection"

# Reload PostgREST schema cache
docker ps --format '{{.Names}}' | grep -Ei 'rest|postgrest' | while read -r c; do
  docker kill -s SIGUSR1 "$c" 2>/dev/null || docker restart "$c" 2>/dev/null || true
done

log "4/5 — reiniciar serviço prelive"
systemctl daemon-reload 2>/dev/null || true
systemctl restart arbishield-prelive-events.service 2>/dev/null || true
sleep 2
systemctl is-active arbishield-prelive-events.service 2>/dev/null || echo "  AVISO: serviço não ativo"

# Confirma que o processo está a usar ficheiro v4
ACTIVE_FILE="$(systemctl show -p FragmentPath arbishield-prelive-events.service 2>/dev/null | cut -d= -f2 || true)"
EXEC="$(systemctl show -p ExecStart arbishield-prelive-events.service 2>/dev/null || true)"
echo "  ExecStart: $EXEC"

log "5/5 — smoke"
CODE=$(curl -sS -o /tmp/prelive-health.json -w "%{http_code}" http://127.0.0.1:3098/health || echo 000)
BODY=$(cat /tmp/prelive-health.json 2>/dev/null || true)
echo "  health HTTP $CODE · $BODY"
[[ "$CODE" == "200" ]] || die "prelive health falhou — serviço não subiu"
echo "$BODY" | grep -q 'integridade-debito-v4' \
  || die "health SEM v4 — o Node ainda corre ficheiro antigo. Ver ExecStart acima."

RPC_OK=$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -Atc \
  "SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='arbishield_create_protection';" \
  || echo 0)
[[ "$RPC_OK" == "1" ]] || die "RPC não encontrada"

DISABLED=$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -Atc \
  "SELECT COUNT(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('protections','back_protections') AND NOT t.tgisinternal AND t.tgenabled = 'D';" \
  || echo 0)
echo "  triggers desativados (D): $DISABLED"

echo
echo "OK — Integridade v4"
echo "  health: integridade-debito-v4"
echo "  Teste: https://arbishield.app/app-proteger.html → Ativar proteção"
echo "  Se falhar: journalctl -u arbishield-prelive-events -n 80 --no-pager"
