#!/usr/bin/env bash
# Hotfix v4: buckets + upload via shim + ADM aprovar depósitos
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-deposito-comprovante-723d/scripts/vps-hotfix-deposit-proofs.sh?v=4")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/fix-deposito-comprovante-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/arbishield/deploy/vps-supabase}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
need systemctl

mkdir -p "$WEB" "$SHIM_DIR" /opt/arbishield/scripts

# --- descobrir SERVICE_ROLE sem depender de um único path ---
load_env_file() {
  local f="$1"
  [[ -f "$f" ]] || return 1
  set -a
  # shellcheck disable=SC1090
  source "$f" 2>/dev/null || true
  set +a
  echo "  env: $f"
  return 0
}

discover_env() {
  local candidates=(
    "${ENV_FILE:-}"
    "$COMPOSE_DIR/.env"
    /opt/arbishield/deploy/vps-supabase/.env
    /opt/arbishield/.env
    /opt/arbishield/scripts/.env
    /opt/arbishield/.arbishield-odds-sync.env
    /root/arbishield/.env
    /root/supabase/.env
    /opt/supabase/docker/.env
    /var/www/arbishield/.env
  )
  # EnvironmentFile= do systemd (shim / prelive)
  local unit ef
  for unit in arbishield-serverfn-shim.service arbishield-prelive-events.service arbishield-prelive.service; do
    if systemctl cat "$unit" >/dev/null 2>&1; then
      while IFS= read -r ef; do
        ef="${ef#EnvironmentFile=}"
        ef="${ef#-}"
        [[ -n "$ef" ]] && candidates+=("$ef")
      done < <(systemctl show -p EnvironmentFiles --value "$unit" 2>/dev/null | tr ' ' '\n' | sed 's/ (.*)//' || true)
      # fallback: grep no unit
      while IFS= read -r ef; do
        ef="$(echo "$ef" | sed -E 's/.*EnvironmentFile=-?//')"
        [[ -n "$ef" ]] && candidates+=("$ef")
      done < <(systemctl cat "$unit" 2>/dev/null | grep -E '^EnvironmentFile=' || true)
    fi
  done
  # find raso
  while IFS= read -r f; do
    candidates+=("$f")
  done < <(find /opt/arbishield /opt/supabase /root -maxdepth 4 -type f \( -name '.env' -o -name '.env.production' -o -name '*odds-sync.env' \) 2>/dev/null | head -40 || true)

  local c
  for c in "${candidates[@]}"; do
    [[ -n "$c" && -f "$c" ]] || continue
    load_env_file "$c" || true
  done

  # Extrair SERVICE_ROLE do Environment= do processo (sem source)
  local envline
  envline="$(systemctl show -p Environment --value arbishield-serverfn-shim.service 2>/dev/null || true)"
  if [[ -n "$envline" ]]; then
    # shellcheck disable=SC2086
    eval "export $envline" 2>/dev/null || true
  fi
}

log "Localizar credenciais Supabase"
discover_env

SK="${ARBISHIELD_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}}"
SU="${ARBISHIELD_SUPABASE_URL:-${SUPABASE_URL:-http://127.0.0.1:8000}}"
# Kong local comum na VPS
if [[ -z "$SK" ]]; then
  echo "AVISO: SERVICE_ROLE_KEY não encontrado nos .env — seguirei com UI + shim (health cria buckets)" >&2
fi

create_bucket() {
  local name="$1"
  [[ -n "$SK" ]] || return 0
  local body
  body="$(curl -sS -X POST "$SU/storage/v1/bucket" \
    -H "apikey: $SK" \
    -H "Authorization: Bearer $SK" \
    -H "Content-Type: application/json" \
    -d "{\"id\":\"$name\",\"name\":\"$name\",\"public\":false,\"file_size_limit\":10485760,\"allowed_mime_types\":[\"image/jpeg\",\"image/png\",\"image/webp\",\"image/gif\",\"image/heic\",\"application/pdf\"]}" \
    || true)"
  if echo "$body" | grep -qiE 'already exists|duplicate|Conflict|"name":"'"$name"'|"id":"'"$name"'; then
    echo "  bucket $name ok"
  elif echo "$body" | grep -q "\"name\":\"$name\""; then
    echo "  bucket $name criado"
  else
    local got
    got="$(curl -sS "$SU/storage/v1/bucket/$name" -H "apikey: $SK" -H "Authorization: Bearer $SK" || true)"
    if echo "$got" | grep -q "\"id\":\"$name\""; then
      echo "  bucket $name ok"
    else
      echo "  AVISO bucket $name: ${body:0:120}" >&2
    fi
  fi
}

if [[ -n "$SK" ]]; then
  log "Criar buckets Storage (deposit-proofs + bet-proofs) via $SU"
  create_bucket "deposit-proofs"
  create_bucket "bet-proofs"
fi

# Políticas via SQL
SQL_FILE="$(mktemp)"
curl -fsSL "$RAW/supabase/migrations/20260721_deposit_proofs_storage.sql" -o "$SQL_FILE" || true
if [[ -s "$SQL_FILE" ]]; then
  if [[ -d "$COMPOSE_DIR" ]] && command -v docker >/dev/null 2>&1; then
    if (cd "$COMPOSE_DIR" && docker compose ps --status running 2>/dev/null | grep -qE '\bdb\b'); then
      log "Aplicar policies via docker compose db"
      (cd "$COMPOSE_DIR" && docker compose exec -T db psql -U postgres -d postgres < "$SQL_FILE") || true
    fi
  fi
  if command -v docker >/dev/null 2>&1; then
    for c in $(docker ps --format '{{.Names}}' 2>/dev/null | grep -E 'db|postgres|supabase' || true); do
      log "Tentando SQL em container $c"
      docker exec -i "$c" psql -U postgres -d postgres < "$SQL_FILE" 2>/dev/null && break || true
    done
  fi
fi
rm -f "$SQL_FILE"

log "Shim :3101 (upload + aprovar depósitos + ensure buckets)"
curl -fsSL "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
cp -f "$SHIM_DIR/arbishield-serverfn-shim.mjs" /opt/arbishield/scripts/arbishield-serverfn-shim.mjs 2>/dev/null || true
grep -q 'DEPOSIT_APPROVE\|approveManualDeposit' "$SHIM_DIR/arbishield-serverfn-shim.mjs" || die "shim sem aprovação de depósito"
grep -q 'ensureStorageBuckets\|DEPOSIT_UPLOAD_PROOF\|uploadDepositProof' "$SHIM_DIR/arbishield-serverfn-shim.mjs" || die "shim sem upload/ensure buckets"

# Escrever no path real do systemd
for u in arbishield-serverfn-shim.service; do
  if systemctl cat "$u" >/dev/null 2>&1; then
    exec="$(systemctl show -p ExecStart --value "$u" 2>/dev/null | head -1 || true)"
    echo "  ExecStart=$exec"
    if [[ "$exec" =~ (/[^[:space:]]+arbishield-serverfn-shim\.mjs) ]]; then
      cp -f "$SHIM_DIR/arbishield-serverfn-shim.mjs" "${BASH_REMATCH[1]}"
      echo "  wrote ${BASH_REMATCH[1]}"
    fi
  fi
done
systemctl daemon-reload 2>/dev/null || true
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
sleep 2

log "Health shim (cria buckets se SERVICE_ROLE estiver no unit)"
health="$(curl -sS "http://127.0.0.1:3101/health" || true)"
echo "  $health" | head -c 400; echo

log "UI depósito + ADM"
for f in v2-deposit.js admin-manual-deposits.html v2-shell.js; do
  curl -fsSL "$RAW/deploy/vps-supabase/static/v2/$f" -o "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
  echo "  ok $f"
done
grep -q 'deposit-proofs' "$WEB/v2-deposit.js" || die "v2-deposit sem deposit-proofs"
grep -q 'uploadProofViaServer\|a8c4e21f' "$WEB/v2-deposit.js" || die "v2-deposit sem fallback servidor"
grep -q 'Confirmar e Creditar\|81753fec' "$WEB/admin-manual-deposits.html" || die "admin sem aprovar depósito"

# nginx
NGINX_CONF=""
for c in /etc/nginx/sites-enabled/arbishield.app \
         /etc/nginx/conf.d/arbishield.app.conf \
         /etc/nginx/sites-available/arbishield.app; do
  if [[ -f "$c" ]]; then NGINX_CONF="$c"; break; fi
done
if [[ -n "$NGINX_CONF" ]]; then
  log "nginx client_max_body_size + location deposit-proof ($NGINX_CONF)"
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
log "Sanity bucket deposit-proofs"
ok_bucket=0
if [[ -n "$SK" ]]; then
  got="$(curl -sS "$SU/storage/v1/bucket/deposit-proofs" -H "apikey: $SK" -H "Authorization: Bearer $SK" || true)"
  echo "  $got" | head -c 200; echo
  echo "$got" | grep -q 'deposit-proofs' && ok_bucket=1
fi
if echo "$health" | grep -q 'deposit-proofs'; then
  ok_bucket=1
fi
if [[ "$ok_bucket" -ne 1 ]]; then
  echo "AVISO: não confirmei o bucket via API." >&2
  echo "  Ache o .env e rode de novo, ou exporte a chave:" >&2
  echo "  find /opt /root -name '.env' 2>/dev/null | head" >&2
  echo "  ENV_FILE=/caminho/.env bash <(curl -fsSL \"$RAW/scripts/vps-hotfix-deposit-proofs.sh?v=4\")" >&2
  echo "  UI e shim já foram atualizados — o upload via /_serverFn pode criar o bucket no 1º envio." >&2
else
  echo "  bucket deposit-proofs OK"
fi

echo
echo "OK — Depósito hotfix v3"
echo "  1) Ctrl+F5 no app → enviar comprovante"
echo "  2) Ctrl+F5 em /admin-manual-deposits.html → Confirmar e Creditar"
