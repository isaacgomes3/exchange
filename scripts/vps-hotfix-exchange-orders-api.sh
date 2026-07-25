#!/usr/bin/env bash
# Hotfix: API ArbiShield de ordens (connect sessão + place/cancel/status).
# Adapter da casa fica stub até EXCHANGE_ORDERS_LIVE=1 + doc da BetBra/Fulltbet.
#
# Na VPS:
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-exchange-orders-api.sh?ref=cursor/exchange-orders-api-e85c&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/exchange-orders-api-e85c}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_DIR/scripts}"
COMPOSE_DIR="${ARBISHIELD_COMPOSE:-/opt/arbishield/deploy/vps-supabase}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
mkdir -p "$SCRIPTS_DIR/lib" "$SHIM_DIR/lib" "$SHIM_DIR/scripts/lib"

download_repo_file() {
  local rel="$1"
  local out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/$rel?ref=${REF}&t=$(date +%s%N)" -o "$out" \
    && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "$RAW/$rel?v=$BUST&t=$(date +%s%N)" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

run_sql() {
  local sql="$1"
  if command -v docker >/dev/null 2>&1; then
    for ctr in supabase-db db postgres; do
      if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$ctr"; then
        docker exec -i "$ctr" psql -U postgres -d postgres -c "$sql" && return 0
        docker exec -i "$ctr" psql -U supabase_admin -d postgres -c "$sql" && return 0
      fi
    done
    local db_ctr
    db_ctr="$(docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1 || true)"
    if [[ -n "$db_ctr" ]]; then
      docker exec -i "$db_ctr" psql -U postgres -d postgres -c "$sql" && return 0
    fi
  fi
  if command -v psql >/dev/null 2>&1 && [[ -n "${DATABASE_URL:-}" ]]; then
    psql "$DATABASE_URL" -c "$sql" && return 0
  fi
  return 1
}

echo "==> vps-hotfix-exchange-orders-api.sh ($(date -Is)) ref=$REF"

log "1/4 schema exchange_connections + exchange_orders"
SQL="$(cat <<'SQL'
CREATE TABLE IF NOT EXISTS public.exchange_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'betbra',
  status text NOT NULL DEFAULT 'active',
  session_enc text,
  account_label text,
  metadata jsonb DEFAULT '{}'::jsonb,
  connected_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS exchange_connections_user_idx
  ON public.exchange_connections (user_id, status);

CREATE TABLE IF NOT EXISTS public.exchange_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  connection_id uuid,
  external_order_id text,
  side text,
  odd numeric,
  stake_cents bigint,
  event_id text,
  market_id text,
  selection_id text,
  status text,
  client_order_id text,
  provider text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS exchange_orders_user_idx
  ON public.exchange_orders (user_id, created_at DESC);
SQL
)"
if run_sql "$SQL"; then
  echo "  OK schema"
else
  echo "  AVISO: não foi possível CREATE TABLE (verifique docker/psql)"
fi

log "2/4 libs"
for rel in \
  scripts/lib/exchange-orders-contract.mjs \
  scripts/lib/exchange-orders-adapter.mjs \
  scripts/lib/exchange-orders-service.mjs; do
  tmp="$(mktemp)"
  download_repo_file "$rel" "$tmp"
  base="$(basename "$rel")"
  for dest in \
    "$SCRIPTS_DIR/lib/$base" \
    "$SHIM_DIR/lib/$base" \
    "$SHIM_DIR/scripts/lib/$base"; do
    mkdir -p "$(dirname "$dest")"
    cp -f "$tmp" "$dest"
    chmod 0644 "$dest"
    echo "  OK $dest"
  done
  rm -f "$tmp"
done
grep -q 'DO_NOT_PLACE_WITHOUT_CLIENT_SESSION' \
  "$SCRIPTS_DIR/lib/exchange-orders-contract.mjs" || die "contrato sem lock"

log "3/4 shim"
tmp_shim="$(mktemp)"
download_repo_file "scripts/arbishield-serverfn-shim.mjs" "$tmp_shim"
grep -q 'exchange-orders/place' "$tmp_shim" || die "shim sem place"
grep -q 'exchange-session/connect' "$tmp_shim" || die "shim sem connect"
cp -f "$tmp_shim" "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
echo "  OK $SHIM_DIR/arbishield-serverfn-shim.mjs"
rm -f "$tmp_shim"

log "4/4 restart"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
systemctl restart arbishield-serverfn-shim-teste.service 2>/dev/null || true

echo ""
echo "OK. Endpoints:"
echo "  POST /api/arbishield/exchange-session/connect"
echo "  POST /api/arbishield/exchange-session/disconnect"
echo "  POST /api/arbishield/exchange-orders/place"
echo "  POST /api/arbishield/exchange-orders/cancel"
echo "  GET  /api/arbishield/exchange-orders/status?orderId="
echo "  GET  /api/arbishield/exchange-orders"
echo ""
echo "Place real só com EXCHANGE_ORDERS_LIVE=1 + EXCHANGE_ORDERS_PROVIDER=betbra"
echo "e paths da API da casa confirmados no adapter."
