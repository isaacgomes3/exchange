#!/usr/bin/env bash
# Hotfix v5: permission denied session_replication_role + path do prelive
#
# O v4 chegou a chamar a RPC, mas ela usava set_config('session_replication_role')
# que exige superuser. Esta versão recria a RPC SEM isso e reaplica o disable
# do trigger + prelive no path correto do systemd.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-protecao-integridade-debito-723d/scripts/vps-hotfix-protecao-integridade-debito.sh?v=5")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/fix-protecao-integridade-debito-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
need docker

log "0/5 — caminho real do prelive (systemd)"
PRELIVE_PATH=""
if command -v systemctl >/dev/null 2>&1; then
  UNIT="$(systemctl cat arbishield-prelive-events.service 2>/dev/null || true)"
  if [[ -n "$UNIT" ]]; then
    echo "$UNIT" | grep -E '^ExecStart=' || true
    PRELIVE_PATH="$(echo "$UNIT" | sed -n 's/^ExecStart=.*node[[:space:]]\+\([^[:space:]]*arbishield-prelive-events\.mjs\).*/\1/p' | head -1)"
  fi
fi
CANDIDATES=(
  "$PRELIVE_PATH"
  /opt/arbishield/scripts/arbishield-prelive-events.mjs
  /opt/arbishield/arbishield-prelive-events.mjs
  /opt/arbishield/app/scripts/arbishield-prelive-events.mjs
)
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

grep -q 'integridade-debito-v5' /tmp/arbishield-prelive-events.mjs \
  || die "prelive baixado sem integridade-debito-v5"
grep -q 'arbishield_create_protection' /tmp/arbishield-prelive-events.mjs \
  || die "prelive baixado sem RPC"
grep -q 'DISABLE TRIGGER' /tmp/arbishield_disable_integrity_trigger.sql \
  || die "SQL disable sem DISABLE TRIGGER"
grep -q 'integridade-debito-v5' /tmp/arbishield_create_protection_rpc.sql \
  || die "SQL RPC sem marcador v5"
# Bloqueia se ainda houver set_config de replication role (comentários ok)
if grep -E "set_config\s*\(\s*'session_replication_role'" /tmp/arbishield_create_protection_rpc.sql >/dev/null; then
  die "SQL RPC ainda chama set_config session_replication_role"
fi

log "2/5 — instalar prelive"
for dest in "${TARGETS[@]}"; do
  mkdir -p "$(dirname "$dest")"
  if [[ -f "$dest" ]]; then
    cp -a "$dest" "${dest}.bak.integridade.$(date +%Y%m%d%H%M%S)" || true
  fi
  cp -f /tmp/arbishield-prelive-events.mjs "$dest"
  chmod 0755 "$dest"
  grep -q 'integridade-debito-v5' "$dest" || die "falha ao gravar $dest"
  echo "  ok $dest"
done

log "3/5 — Postgres: disable trigger + RPC v5"
DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1 || true)"
[[ -n "$DB_CONTAINER" ]] || die "container Postgres não encontrado"

run_psql() {
  local file="$1"
  docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$file" \
    || docker exec -i "$DB_CONTAINER" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 < "$file"
}

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
  || die "falha ao recriar RPC (v5)"

# Confirma que a função no banco NÃO tem set_config replication
SRC=$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -Atc \
  "SELECT prosrc FROM pg_proc WHERE proname='arbishield_create_protection' LIMIT 1;" || true)
echo "$SRC" | grep -E "set_config\s*\(\s*'session_replication_role'" >/dev/null \
  && die "RPC no banco AINDA tem session_replication_role — SQL não aplicou"
echo "$SRC" | grep -q 'integridade-debito-v5' \
  || die "RPC no banco sem marcador v5"

docker ps --format '{{.Names}}' | grep -Ei 'rest|postgrest' | while read -r c; do
  docker kill -s SIGUSR1 "$c" 2>/dev/null || docker restart "$c" 2>/dev/null || true
done

log "4/5 — reiniciar prelive"
systemctl daemon-reload 2>/dev/null || true
systemctl restart arbishield-prelive-events.service 2>/dev/null || true
sleep 2
systemctl is-active arbishield-prelive-events.service 2>/dev/null || echo "  AVISO: serviço não ativo"
echo "  ExecStart: $(systemctl show -p ExecStart arbishield-prelive-events.service 2>/dev/null || true)"

log "5/5 — smoke"
CODE=$(curl -sS -o /tmp/prelive-health.json -w "%{http_code}" http://127.0.0.1:3098/health || echo 000)
BODY=$(cat /tmp/prelive-health.json 2>/dev/null || true)
echo "  health HTTP $CODE · $BODY"
[[ "$CODE" == "200" ]] || die "prelive health falhou"
echo "$BODY" | grep -q 'integridade-debito-v5' \
  || die "health SEM v5 — Node ainda no ficheiro antigo"

echo
echo "OK — Integridade v5 (RPC sem replication role)"
echo "  Teste: https://arbishield.app/app-proteger.html → Ativar proteção"
echo "  Se falhar: journalctl -u arbishield-prelive-events -n 80 --no-pager"
