#!/usr/bin/env bash
# Hotfix: cria buckets deposit-proofs + bet-proofs e ativa aprovação ADM de depósitos
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-deposito-comprovante-723d/scripts/vps-hotfix-deposit-proofs.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/fix-deposito-comprovante-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl

ENV_FILE=""
for e in /opt/arbishield/.env /opt/arbishield/scripts/.env /root/arbishield/.env /opt/supabase/docker/.env; do
  [[ -f "$e" ]] && ENV_FILE="$e" && break
done
[[ -n "$ENV_FILE" ]] || die "arquivo .env não encontrado"
# shellcheck disable=SC1090
set -a; source "$ENV_FILE" 2>/dev/null || true; set +a

SK="${ARBISHIELD_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}}"
SU="${ARBISHIELD_SUPABASE_URL:-${SUPABASE_URL:-http://127.0.0.1:8000}}"
[[ -n "$SK" ]] || die "SERVICE_ROLE_KEY ausente no .env"

create_bucket() {
  local name="$1"
  local body
  body="$(curl -sS -X POST "$SU/storage/v1/bucket" \
    -H "apikey: $SK" \
    -H "Authorization: Bearer $SK" \
    -H "Content-Type: application/json" \
    -d "{\"id\":\"$name\",\"name\":\"$name\",\"public\":false,\"file_size_limit\":10485760,\"allowed_mime_types\":[\"image/jpeg\",\"image/png\",\"image/webp\",\"image/gif\",\"image/heic\",\"application/pdf\"]}" \
    || true)"
  if echo "$body" | grep -qiE 'already exists|duplicate|Conflict|"name":"'"$name"'|"id":"'"$name"'; then
    echo "  bucket $name ok (já existia ou criado)"
  elif echo "$body" | grep -q "\"name\":\"$name\""; then
    echo "  bucket $name criado"
  else
    # tenta GET
    local got
    got="$(curl -sS "$SU/storage/v1/bucket/$name" -H "apikey: $SK" -H "Authorization: Bearer $SK" || true)"
    if echo "$got" | grep -q "\"id\":\"$name\""; then
      echo "  bucket $name ok"
    else
      echo "  AVISO bucket $name: $body / $got" >&2
    fi
  fi
}

log "Criar buckets Storage (deposit-proofs + bet-proofs)"
create_bucket "deposit-proofs"
create_bucket "bet-proofs"

# Políticas via SQL se psql/docker disponível
SQL_FILE="$(mktemp)"
curl -fsSL "$RAW/supabase/migrations/20260721_deposit_proofs_storage.sql" -o "$SQL_FILE"
if command -v docker >/dev/null 2>&1; then
  for c in supabase-db db postgres; do
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$c"; then
      log "Aplicar policies via docker exec $c"
      docker exec -i "$c" psql -U postgres -d postgres < "$SQL_FILE" && break || true
    fi
  done
fi
# Kong/postgrest às vezes expõe rpc — fallback: psql local
if command -v psql >/dev/null 2>&1 && [[ -n "${POSTGRES_PASSWORD:-}" ]]; then
  PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U postgres -d postgres -f "$SQL_FILE" 2>/dev/null || true
fi
rm -f "$SQL_FILE"

log "Shim :3101 (aprovar/rejeitar depósitos)"
mkdir -p "$SHIM_DIR" /opt/arbishield/scripts
curl -fsSL "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
cp -f "$SHIM_DIR/arbishield-serverfn-shim.mjs" /opt/arbishield/scripts/arbishield-serverfn-shim.mjs 2>/dev/null || true
grep -q 'DEPOSIT_APPROVE\|approveManualDeposit' "$SHIM_DIR/arbishield-serverfn-shim.mjs" || die "shim sem aprovação de depósito"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

log "UI depósito + ADM"
mkdir -p "$WEB"
for f in v2-deposit.js admin-manual-deposits.html v2-shell.js; do
  curl -fsSL "$RAW/deploy/vps-supabase/static/v2/$f" -o "$WEB/$f" 2>/dev/null || true
  [[ -f "$WEB/$f" ]] || continue
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
  echo "  ok $f"
done
grep -q 'deposit-proofs' "$WEB/v2-deposit.js" || die "v2-deposit sem deposit-proofs"
grep -q 'Confirmar e Creditar\|DEPOSIT_APPROVE\|81753fec' "$WEB/admin-manual-deposits.html" || die "admin sem aprovar depósito"

# Sanity bucket
log "Sanity GET bucket deposit-proofs"
got="$(curl -sS "$SU/storage/v1/bucket/deposit-proofs" -H "apikey: $SK" -H "Authorization: Bearer $SK" || true)"
echo "  $got" | head -c 200; echo
echo "$got" | grep -q 'deposit-proofs' || die "bucket deposit-proofs ainda ausente"

echo
echo "OK — Depósito comprovante + aprovação ADM"
echo "  1) Ctrl+F5 no app → Depósito → enviar comprovante"
echo "  2) ADM → Depósitos manuais → Confirmar e Creditar"
echo "  PIX continua estático (chave/QR de platform_settings ou fallback Inter)"
