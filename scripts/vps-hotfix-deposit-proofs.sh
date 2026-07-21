#!/usr/bin/env bash
# Hotfix v2: buckets + upload via shim + ADM aprovar depósitos
#
# OBRIGATÓRIO na VPS (sem isso o site continua com "Bucket not found"):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-deposito-comprovante-723d/scripts/vps-hotfix-deposit-proofs.sh?v=2")
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
grep -q 'ensureStorageBuckets\|DEPOSIT_UPLOAD_PROOF\|uploadDepositProof' "$SHIM_DIR/arbishield-serverfn-shim.mjs" || die "shim sem upload/ensure buckets"
# também em scripts/
cp -f "$SHIM_DIR/arbishield-serverfn-shim.mjs" /opt/arbishield/scripts/arbishield-serverfn-shim.mjs 2>/dev/null || true
# descobrir ExecStart do shim
for u in arbishield-serverfn-shim.service; do
  if systemctl cat "$u" >/dev/null 2>&1; then
    exec="$(systemctl show -p ExecStart --value "$u" 2>/dev/null | head -1 || true)"
    if [[ "$exec" =~ (/[^[:space:]]+arbishield-serverfn-shim\.mjs) ]]; then
      cp -f "$SHIM_DIR/arbishield-serverfn-shim.mjs" "${BASH_REMATCH[1]}"
      echo "  wrote ${BASH_REMATCH[1]}"
    fi
  fi
done
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
sleep 2
# força ensure buckets via health
curl -sS "http://127.0.0.1:3101/health" | head -c 300; echo


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
grep -q 'uploadProofViaServer\|DEPOSIT_UPLOAD\|a8c4e21f' "$WEB/v2-deposit.js" || die "v2-deposit sem fallback servidor"
grep -q 'Confirmar e Creditar\|81753fec' "$WEB/admin-manual-deposits.html" || die "admin sem aprovar depósito"

# nginx: body size + deposit-proof → :3101
NGINX_CONF=""
for c in /etc/nginx/sites-enabled/arbishield.app \
         /etc/nginx/conf.d/arbishield.app.conf \
         /etc/nginx/sites-available/arbishield.app; do
  if [[ -f "$c" ]]; then NGINX_CONF="$c"; break; fi
done
if [[ -n "$NGINX_CONF" ]]; then
  log "nginx client_max_body_size + location deposit-proof"
  python3 - <<'PY' "$NGINX_CONF"
import sys
path = sys.argv[1]
text = open(path).read()
changed = False
if "client_max_body_size" not in text:
    text = text.replace("server {", "server {\n    client_max_body_size 15m;", 1)
    changed = True
block = """
    location ^~ /api/arbishield/deposit-proof {
        proxy_pass http://127.0.0.1:3101;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_pass_request_headers on;
        client_max_body_size 15m;
        proxy_read_timeout 120s;
    }
    location ^~ /api/arbishield/ensure-storage-buckets {
        proxy_pass http://127.0.0.1:3101;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_pass_request_headers on;
    }
"""
if "location ^~ /api/arbishield/deposit-proof" not in text:
    anchor = "location ^~ /_serverFn/"
    if anchor in text:
        text = text.replace(anchor, block + "\n    " + anchor, 1)
        changed = True
if changed:
    open(path, "w").write(text)
    print("nginx patched")
else:
    print("nginx already ok")
PY
  nginx -t >/dev/null 2>&1 && systemctl reload nginx 2>/dev/null || true
fi


# Sanity bucket
log "Sanity GET bucket deposit-proofs"
got="$(curl -sS "$SU/storage/v1/bucket/deposit-proofs" -H "apikey: $SK" -H "Authorization: Bearer $SK" || true)"
echo "  $got" | head -c 200; echo
echo "$got" | grep -q 'deposit-proofs' || die "bucket deposit-proofs ainda ausente"

echo
echo "OK — Depósito hotfix v2"
echo "  • bucket deposit-proofs criado"
echo "  • shim cria bucket ao subir + upload via /_serverFn"
echo "  • ADM Depósitos com Confirmar e Creditar"
echo "  1) Ctrl+F5 no app (cliente) → enviar comprovante"
echo "  2) Ctrl+F5 em /admin-manual-deposits.html → Confirmar e Creditar"
echo "  PIX continua estático (chave/QR)"
