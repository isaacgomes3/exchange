#!/usr/bin/env bash
# FIX DEPÓSITO AGORA — cria bucket via Docker (sem .env) + UI + shim
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/804dbe96e02ae36f2a1291e1c5db6c38b467c84b/scripts/vps-fix-deposito-agora.sh")
#   # ou após push:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-deposito-comprovante-723d/scripts/vps-fix-deposito-agora.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/fix-deposito-comprovante-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
COMPOSE_DIR="${SUPABASE_COMPOSE_DIR:-/opt/arbishield/deploy/vps-supabase}"

log() { echo "==> $*"; }
warn() { echo "AVISO: $*" >&2; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
need systemctl
mkdir -p "$WEB" "$SHIM_DIR" "$SCRIPTS_DIR"

SQL_TMP="$(mktemp)"
trap 'rm -f "$SQL_TMP"' EXIT

log "1/4 — SQL: criar buckets deposit-proofs + bet-proofs (Docker, sem .env)"
curl -fsSL "$RAW/supabase/migrations/20260721_deposit_proofs_storage.sql" -o "$SQL_TMP"
[[ -s "$SQL_TMP" ]] || die "não baixou migration SQL"
# fallback mínimo se migration falhar no download parcial
if ! grep -q 'deposit-proofs' "$SQL_TMP"; then
  cat >"$SQL_TMP" <<'SQL'
insert into storage.buckets (id, name, public, file_size_limit)
values ('deposit-proofs','deposit-proofs', false, 10485760),
       ('bet-proofs','bet-proofs', false, 10485760)
on conflict (id) do nothing;
SQL
fi

applied=0
if command -v docker >/dev/null 2>&1; then
  # nomes comuns
  for c in $(docker ps --format '{{.Names}}' 2>/dev/null | grep -Ei 'db|postgres|supabase' || true); do
    log "SQL via docker exec $c"
    if docker exec -i "$c" psql -U postgres -d postgres < "$SQL_TMP" 2>/tmp/dep-sql.err; then
      applied=1
      echo "  ok $c"
      break
    else
      warn "falhou $c: $(head -c 120 /tmp/dep-sql.err 2>/dev/null || true)"
    fi
  done
  if [[ "$applied" -eq 0 && -d "$COMPOSE_DIR" ]]; then
    if (cd "$COMPOSE_DIR" && docker compose ps --status running 2>/dev/null | grep -qE '\bdb\b'); then
      log "SQL via docker compose -f $COMPOSE_DIR db"
      if (cd "$COMPOSE_DIR" && docker compose exec -T db psql -U postgres -d postgres < "$SQL_TMP"); then
        applied=1
        echo "  ok compose db"
      fi
    fi
  fi
fi
[[ "$applied" -eq 1 ]] || warn "SQL não aplicado automaticamente — rode: docker ps  e depois docker exec -i <db> psql -U postgres -d postgres < migration"

log "2/4 — UI (comprovante + ADM Confirmar e Creditar)"
for f in v2-deposit.js admin-manual-deposits.html v2-shell.js; do
  curl -fsSL "$RAW/deploy/vps-supabase/static/v2/$f" -o "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
  # cache bust copy with query not needed for static files
  echo "  ok $f ($(wc -c < "$WEB/$f") bytes)"
done
grep -q 'deposit-proofs' "$WEB/v2-deposit.js" || die "v2-deposit.js sem deposit-proofs"
grep -q 'uploadProofViaServer\|a8c4e21f' "$WEB/v2-deposit.js" || die "v2-deposit.js SEM fallback servidor — baixou arquivo antigo?"
grep -q 'Confirmar e Creditar' "$WEB/admin-manual-deposits.html" || die "admin ainda antigo"

log "3/4 — shim :3101"
curl -fsSL "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
cp -f "$SHIM_DIR/arbishield-serverfn-shim.mjs" "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" 2>/dev/null || true
grep -q 'ensureStorageBuckets\|uploadDepositProof\|DEPOSIT_APPROVE' "$SHIM_DIR/arbishield-serverfn-shim.mjs" || \
  die "shim sem handlers de depósito"

# path real do systemd
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
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || warn "não reiniciou shim"
sleep 2
curl -sS "http://127.0.0.1:3101/health" 2>/dev/null | head -c 300 || true
echo

log "4/4 — sanity Storage via Kong :8000 (se existir service role no unit)"
# tenta extrair SERVICE_ROLE do EnvironmentFile do unit
SK=""
for ef in $(systemctl cat arbishield-serverfn-shim.service 2>/dev/null | sed -n 's/^EnvironmentFile=-*//p'); do
  [[ -f "$ef" ]] || continue
  # shellcheck disable=SC1090
  set -a; source "$ef" 2>/dev/null || true; set +a
done
SK="${ARBISHIELD_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}}"
if [[ -n "$SK" ]]; then
  got="$(curl -sS "http://127.0.0.1:8000/storage/v1/bucket/deposit-proofs" \
    -H "apikey: $SK" -H "Authorization: Bearer $SK" || true)"
  echo "  $got" | head -c 200; echo
  if echo "$got" | grep -q deposit-proofs; then
    echo "  bucket deposit-proofs OK"
  else
    # cria via API também
    curl -sS -X POST "http://127.0.0.1:8000/storage/v1/bucket" \
      -H "apikey: $SK" -H "Authorization: Bearer $SK" -H "Content-Type: application/json" \
      -d '{"id":"deposit-proofs","name":"deposit-proofs","public":false,"file_size_limit":10485760}' | head -c 200
    echo
  fi
else
  warn "SERVICE_ROLE não lido do unit — confie no SQL Docker + upload via shim"
fi

# nginx body size best-effort
for c in /etc/nginx/sites-enabled/arbishield.app /etc/nginx/conf.d/arbishield.app.conf /etc/nginx/sites-available/arbishield.app; do
  if [[ -f "$c" ]] && ! grep -q 'client_max_body_size' "$c"; then
    sed -i '0,/server {/s//server {\n    client_max_body_size 15m;/' "$c" || true
    nginx -t >/dev/null 2>&1 && systemctl reload nginx 2>/dev/null || true
    echo "  nginx body size patched in $c"
    break
  fi
done

echo
echo "=========================================="
echo " OK — rode estes checks:"
echo "  grep -c uploadProofViaServer $WEB/v2-deposit.js   # deve ser >= 1"
echo "  grep -c 'Confirmar e Creditar' $WEB/admin-manual-deposits.html"
echo " Depois no navegador: Ctrl+Shift+R (hard refresh)"
echo "  https://arbishield.app/  → Depósito → enviar comprovante"
echo "  https://arbishield.app/admin-manual-deposits.html"
echo "=========================================="
