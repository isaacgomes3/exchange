#!/usr/bin/env bash
# BotShield UI + schema exchange_connections + shim (Conta BetBra).
#
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-botshield.sh?ref=cursor/botshield-painel-e85c&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/botshield-painel-e85c}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
WEB_ROOT="${BOTSHIELD_WEB:-/var/www/arbishield-botshield}"
SHIM_ROOT="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-$SHIM_ROOT/scripts}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl

fetch() {
  local path="$1" out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/${path}?ref=${REF}&t=$(date +%s%N)" -o "$out" \
    && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    "$RAW/${path}?t=$(date +%s%N)" -o "$out"
  [[ -s "$out" ]]
}

run_sql() {
  local sql="$1"
  if command -v docker >/dev/null 2>&1; then
    for ctr in supabase-db db postgres; do
      if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$ctr"; then
        docker exec -i "$ctr" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "$sql" && return 0
        docker exec -i "$ctr" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c "$sql" && return 0
      fi
    done
    local db_ctr
    db_ctr="$(docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1 || true)"
    if [[ -n "$db_ctr" ]]; then
      docker exec -i "$db_ctr" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "$sql" && return 0
    fi
  fi
  if command -v psql >/dev/null 2>&1 && [[ -n "${DATABASE_URL:-}" ]]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "$sql" && return 0
  fi
  return 1
}

echo "==> vps-hotfix-botshield.sh ($(date -Is)) ref=$REF"

log "1/5 schema exchange_connections (+ orders)"
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

GRANT ALL ON TABLE public.exchange_connections TO postgres, service_role, authenticated, anon;
GRANT ALL ON TABLE public.exchange_orders TO postgres, service_role, authenticated, anon;
NOTIFY pgrst, 'reload schema';
SQL
)"
if run_sql "$SQL"; then
  echo "  OK schema (+ reload PostgREST)"
else
  echo "  AVISO: CREATE TABLE falhou — 'not_found' continua até o schema existir"
fi

log "2/5 UI BotShield → $WEB_ROOT"
mkdir -p "$WEB_ROOT"
tmpd="$(mktemp -d)"
n=0
for f in \
  index.html auth.html bots.html criar.html modelos.html ordens.html integracoes.html \
  conta-betbra.html botshield.css botshield.js botshield-shell.js; do
  fetch "deploy/vps-supabase/static/botshield/$f" "$tmpd/$f" || die "falha $f"
  cp -f "$tmpd/$f" "$WEB_ROOT/$f"
  chmod 0644 "$WEB_ROOT/$f"
  echo "  OK $f"
  n=$((n + 1))
done
rm -rf "$tmpd"
grep -q 'conta-betbra' "$WEB_ROOT/botshield-shell.js" || die "nav sem Conta BetBra"

log "3/5 libs + shim"
mkdir -p "$SCRIPTS_DIR/lib" "$SHIM_ROOT/lib" "$SHIM_ROOT/scripts/lib"
for rel in \
  scripts/lib/exchange-orders-contract.mjs \
  scripts/lib/exchange-orders-adapter.mjs \
  scripts/lib/exchange-orders-service.mjs \
  scripts/lib/betbra-client-api.mjs; do
  tmp="$(mktemp)"
  fetch "$rel" "$tmp" || die "falha $rel"
  base="$(basename "$rel")"
  for dest in \
    "$SCRIPTS_DIR/lib/$base" \
    "$SHIM_ROOT/lib/$base" \
    "$SHIM_ROOT/scripts/lib/$base"; do
    mkdir -p "$(dirname "$dest")"
    cp -f "$tmp" "$dest"
    chmod 0644 "$dest"
  done
  rm -f "$tmp"
  echo "  OK $base"
done

tmp_shim="$(mktemp)"
fetch "scripts/arbishield-serverfn-shim.mjs" "$tmp_shim" || die "shim"
grep -q 'exchange-session/status' "$tmp_shim" || die "shim sem exchange-session/status"
grep -q 'exchange-session/connect' "$tmp_shim" || die "shim sem connect"
grep -q 'exchange-session/balance' "$tmp_shim" || die "shim sem exchange-session/balance"
for dest in \
  "$SHIM_ROOT/arbishield-serverfn-shim.mjs" \
  "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"; do
  mkdir -p "$(dirname "$dest")"
  cp -f "$tmp_shim" "$dest"
  chmod 0644 "$dest"
  echo "  OK $dest"
done
rm -f "$tmp_shim"

log "4/5 nginx botshield"
tmpc="$(mktemp)"
if [[ -f /etc/letsencrypt/live/botshield.arbishield.app/fullchain.pem ]] \
  && fetch "deploy/vps-supabase/nginx-botshield.arbishield.app.conf" "$tmpc"; then
  if [[ -d /etc/nginx/sites-available ]]; then
    cp -f "$tmpc" /etc/nginx/sites-available/botshield.arbishield.app
    ln -sfn /etc/nginx/sites-available/botshield.arbishield.app \
      /etc/nginx/sites-enabled/botshield.arbishield.app 2>/dev/null || true
  else
    cp -f "$tmpc" /etc/nginx/conf.d/botshield.arbishield.app.conf
  fi
  nginx -t && (systemctl reload nginx || true)
  echo "  OK nginx"
else
  echo "  AVISO: nginx SSL conf não republicada"
fi
rm -f "$tmpc"

log "5/5 restart shim"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
systemctl restart arbishield-serverfn-shim-teste.service 2>/dev/null || true

echo ""
echo "OK ($n UI). Conta BetBra: https://botshield.arbishield.app/conta-betbra.html"
echo "Se ainda der not_found: confira o log do schema (passo 1/5) e reinicie o PostgREST/Kong."
echo "Hard refresh (Ctrl+Shift+R)."
