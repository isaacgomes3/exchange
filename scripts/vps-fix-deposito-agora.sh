#!/usr/bin/env bash
# FIX DEPÓSITO AGORA — bucket + RLS admin UPDATE + UI + shim (rejeitar/aprovar)
#
# Na VPS (root):
#   curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-deposito-comprovante-723d/scripts/vps-fix-deposito-agora.sh?v=4" -o /tmp/fix-dep.sh
#   bash /tmp/fix-dep.sh
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/fix-deposito-comprovante-723d}"
REF="${ARBISHIELD_REF:-$BRANCH}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
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
SQL_TMP2="$(mktemp)"
trap 'rm -f "$SQL_TMP" "$SQL_TMP2"' EXIT

apply_sql() {
  local file="$1"
  local label="$2"
  local applied=0
  [[ -s "$file" ]] || { warn "$label: arquivo vazio"; return 1; }
  if command -v docker >/dev/null 2>&1; then
    for c in $(docker ps --format '{{.Names}}' 2>/dev/null | grep -Ei 'db|postgres|supabase' || true); do
      log "SQL ($label) via docker exec $c"
      if docker exec -i "$c" psql -U postgres -d postgres < "$file" 2>/tmp/dep-sql.err; then
        applied=1
        echo "  ok $c"
        break
      else
        warn "falhou $c: $(head -c 160 /tmp/dep-sql.err 2>/dev/null || true)"
      fi
    done
    if [[ "$applied" -eq 0 && -d "$COMPOSE_DIR" ]]; then
      if (cd "$COMPOSE_DIR" && docker compose ps --status running 2>/dev/null | grep -qE '\bdb\b'); then
        log "SQL ($label) via docker compose db"
        if (cd "$COMPOSE_DIR" && docker compose exec -T db psql -U postgres -d postgres < "$file"); then
          applied=1
          echo "  ok compose db"
        fi
      fi
    fi
  fi
  [[ "$applied" -eq 1 ]] || warn "SQL ($label) não aplicado — docker ps e: docker exec -i <db> psql -U postgres -d postgres < arquivo"
  return 0
}

log "1/5 — SQL: buckets deposit-proofs + bet-proofs (Docker, sem .env)"
curl -fsSL "$RAW/supabase/migrations/20260721_deposit_proofs_storage.sql" -o "$SQL_TMP"
[[ -s "$SQL_TMP" ]] || die "não baixou migration SQL storage"
if ! grep -q 'deposit-proofs' "$SQL_TMP"; then
  cat >"$SQL_TMP" <<'SQL'
insert into storage.buckets (id, name, public, file_size_limit)
values ('deposit-proofs','deposit-proofs', false, 10485760),
       ('bet-proofs','bet-proofs', false, 10485760)
on conflict (id) do nothing;
SQL
fi
apply_sql "$SQL_TMP" "storage"

log "1b/5 — SQL: RLS admin UPDATE em manual_deposits (rejeitar/aprovar)"
curl -fsSL "$RAW/supabase/migrations/20260721_manual_deposits_admin_update.sql" -o "$SQL_TMP2" || true
if [[ ! -s "$SQL_TMP2" ]] || ! grep -q 'Admins can update all deposits' "$SQL_TMP2"; then
  cat >"$SQL_TMP2" <<'SQL'
drop policy if exists "Admins can update all deposits" on public.manual_deposits;
create policy "Admins can update all deposits"
  on public.manual_deposits for update to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_super_admin is true)
    or exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role in ('admin','master_admin'))
  )
  with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_super_admin is true)
    or exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role in ('admin','master_admin'))
  );
SQL
fi
apply_sql "$SQL_TMP2" "admin-rls"

log "2/5 — UI (comprovante + ADM Confirmar e Creditar / Rejeitar)"
for f in v2-deposit.js admin-manual-deposits.html v2-shell.js; do
  curl -fsSL "$RAW/deploy/vps-supabase/static/v2/$f" -o "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
  echo "  ok $f ($(wc -c < "$WEB/$f") bytes)"
done
grep -q 'deposit-proofs' "$WEB/v2-deposit.js" || die "v2-deposit.js sem deposit-proofs"
grep -q 'uploadProofViaServer\|a8c4e21f' "$WEB/v2-deposit.js" || die "v2-deposit.js SEM fallback servidor — baixou arquivo antigo?"
grep -q 'Comprovante enviado' "$WEB/v2-deposit.js" || die "v2-deposit sem texto Comprovante enviado"
grep -q 'Confirmar e Creditar' "$WEB/admin-manual-deposits.html" || die "admin ainda antigo"
grep -q 'rejectViaSupabase' "$WEB/admin-manual-deposits.html" || die "admin SEM rejeitar (arquivo antigo?)"
grep -q '97fbb202' "$WEB/admin-manual-deposits.html" || die "admin SEM hash reject"
grep -q 'toPublicProofUrl' "$WEB/admin-manual-deposits.html" || die "admin SEM rewrite URL pública (comprovante quebrado)"
grep -q 'proofUrl' "$WEB/admin-manual-deposits.html" || echo "  AVISO: admin sem proofUrl"
grep -q 'c1d2e3f4' "$WEB/admin-manual-deposits.html" || echo "  AVISO: admin sem hash proofUrl"

log "3/5 — shim :3101"
curl -fsSL "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
cp -f "$SHIM_DIR/arbishield-serverfn-shim.mjs" "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" 2>/dev/null || true
grep -q 'ensureStorageBuckets' "$SHIM_DIR/arbishield-serverfn-shim.mjs" || die "shim sem ensureStorageBuckets"
grep -q 'uploadDepositProof' "$SHIM_DIR/arbishield-serverfn-shim.mjs" || die "shim sem uploadDepositProof"
grep -q 'toPublicStorageUrl' "$SHIM_DIR/arbishield-serverfn-shim.mjs" || die "shim SEM toPublicStorageUrl (URL 127.0.0.1)"
grep -q 'patchManualDepositSafe' "$SHIM_DIR/arbishield-serverfn-shim.mjs" || die "shim SEM patchManualDepositSafe"
grep -q 'DEPOSIT_REJECT' "$SHIM_DIR/arbishield-serverfn-shim.mjs" || die "shim SEM DEPOSIT_REJECT"

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
# sanity: reject handler presente (sem JWT = Acesso negado, não 404)
rej="$(curl -sS -o /tmp/dep-rej.txt -w '%{http_code}' -X POST "http://127.0.0.1:3101/_serverFn/97fbb202a39627b7eeade54ac383dd1197c5a76c5f392f3046ee5875fef4da50" \
  -H 'Content-Type: application/json' -H 'x-arbishield-plain: 1' \
  -d '{"data":{"id":"00000000-0000-0000-0000-000000000000","reason":"test"}}' 2>/dev/null || echo 000)"
echo "  reject probe HTTP $rej body=$(head -c 120 /tmp/dep-rej.txt 2>/dev/null || true)"
if echo "$(cat /tmp/dep-rej.txt 2>/dev/null || true)" | grep -qiE 'matchId|not found|Cannot POST|404'; then
  warn "reject handler parece ausente no shim em execução"
fi

log "4/5 — sanity Storage via Kong :8000 (se existir service role no unit)"
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
echo " OK — checks:"
echo "  grep -c uploadProofViaServer $WEB/v2-deposit.js"
echo "  grep -c rejectViaSupabase $WEB/admin-manual-deposits.html"
echo "  grep -c patchManualDepositSafe $SHIM_DIR/arbishield-serverfn-shim.mjs"
echo " Depois: Ctrl+Shift+R em"
echo "  https://arbishield.app/admin-manual-deposits.html"
echo "  → Ver comprovante deve abrir a imagem (não 127.0.0.1)"
echo "  → Rejeitar deve pedir motivo e mudar status"
echo "=========================================="
