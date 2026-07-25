#!/usr/bin/env bash
# Hotfix: Bateu ArbiShield → credita stake + dedução no Saldo Dedução
# (usável nas operações e sacável). Cliente não precisa solicitar reembolso.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-proteger-js-e85c/scripts/vps-hotfix-arbishield-stake-mais-deducao.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-proteger-js-e85c}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield}"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
COMPOSE_DIR="${ARBISHIELD_COMPOSE:-/opt/arbishield/deploy/vps-supabase}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }

echo "==> vps-hotfix-arbishield-stake-mais-deducao.sh ($(date -Is))"

# 1) Coluna deduction_balance_cents
log "1) ALTER profiles.deduction_balance_cents"
if [[ -f "$COMPOSE_DIR/docker-compose.yml" ]] || [[ -f "$COMPOSE_DIR/compose.yml" ]]; then
  cd "$COMPOSE_DIR"
  SQL="ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deduction_balance_cents bigint NOT NULL DEFAULT 0;"
  if command -v docker >/dev/null 2>&1; then
    DB_CTR="$(docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1 || true)"
    if [[ -n "$DB_CTR" ]]; then
      docker exec -i "$DB_CTR" psql -U postgres -d postgres -c "$SQL" \
        || docker exec -i "$DB_CTR" psql -U supabase_admin -d postgres -c "$SQL" \
        || true
    fi
  fi
fi
# Fallback via PostgREST não cria coluna — tenta psql local
if command -v psql >/dev/null 2>&1 && [[ -n "${DATABASE_URL:-}" ]]; then
  psql "$DATABASE_URL" -c "ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deduction_balance_cents bigint NOT NULL DEFAULT 0;" || true
fi
# Via supabase db container common paths
for ctr in supabase-db db postgres; do
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$ctr"; then
    docker exec -i "$ctr" psql -U postgres -d postgres -c \
      "ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deduction_balance_cents bigint NOT NULL DEFAULT 0;" \
      && break || true
  fi
done

# 2) Backend
log "2) prelive + shim"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/arbishield-prelive-events.mjs" -o "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
chmod 0755 "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
cp -f "$SCRIPTS_DIR/arbishield-prelive-events.mjs" /opt/arbishield/scripts/arbishield-prelive-events.mjs 2>/dev/null || true
grep -q 'settle-arbishield-stake-mais-deducao-v1' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" \
  || die "prelive sem marker stake-mais-deducao"
grep -q 'settlementCreditParts' "$SCRIPTS_DIR/arbishield-prelive-events.mjs" \
  || die "prelive sem settlementCreditParts"

curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
grep -q 'settle-arbishield-stake-mais-deducao-v1' "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  || die "shim sem marker"
grep -q 'deduction-withdraw' "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  || die "shim sem deduction-withdraw"

systemctl restart arbishield-prelive-events.service 2>/dev/null || true
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
systemctl restart arbishield-prelive-events-teste.service 2>/dev/null || true
systemctl restart arbishield-serverfn-shim-teste.service 2>/dev/null || true

# 3) UI
log "3) UI admin + carteira + shell + proteger"
publish() {
  local rel="$1"
  local name
  name="$(basename "$rel")"
  local tmp
  tmp="$(mktemp)"
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$RAW/$rel" -o "$tmp"
  local n=0
  while IFS= read -r -d '' f; do
    cp -a "$f" "${f}.bak-deducao-$(date +%s)" 2>/dev/null || true
    cp -f "$tmp" "$f"
    chmod 0644 "$f"
    echo "  OK $f"
    n=$((n + 1))
  done < <(find /var/www -type f -name "$name" -print0 2>/dev/null)
  # caminhos canônicos
  mkdir -p "$WEB_ROOT/v2"
  cp -f "$tmp" "$WEB_ROOT/v2/$name" 2>/dev/null || true
  rm -f "$tmp"
  echo "  → $name ($n cópias)"
}

publish "deploy/vps-supabase/static/v2/admin-jogos.html"
publish "deploy/vps-supabase/static/v2/app-carteira.html"
publish "deploy/vps-supabase/static/v2/v2-financeiro.js"
publish "deploy/vps-supabase/static/v2/v2-shell.js"
publish "deploy/vps-supabase/static/v2/app.html"
publish "deploy/vps-supabase/static/v2/app-proteger.html"

# 4) Backfill: proteções ArbiShield fee_upfront que só receberam o stake
log "4) backfill fee faltante (stake já creditado)"
export SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:54321}"
# tenta carregar service key dos envs da VPS
if [[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  for f in \
    /opt/arbishield/deploy/vps-supabase/.env \
    /opt/arbishield/.env \
    /opt/arbishield/.arbishield-odds-sync.env
  do
    if [[ -f "$f" ]]; then
      # shellcheck disable=SC1090
      set -a; source "$f" 2>/dev/null || true; set +a
    fi
  done
fi
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY:-}}"
if [[ -z "$SERVICE_KEY" ]]; then
  echo "AVISO: sem SERVICE_ROLE_KEY — pulando backfill"
else
  python3 - <<'PY' || echo "AVISO: backfill parcial/falhou"
import json, os, urllib.request

url = os.environ.get("SUPABASE_URL", "http://127.0.0.1:54321").rstrip("/")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SERVICE_ROLE_KEY") or ""
H = {
    "apikey": key,
    "Authorization": f"Bearer {key}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

def get(path):
    req = urllib.request.Request(url + path, headers=H)
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.loads(r.read().decode())

def patch(path, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(url + path, data=data, headers=H, method="PATCH")
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.loads(r.read().decode() or "[]")

def post(path, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(url + path, data=data, headers=H, method="POST")
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.loads(r.read().decode() or "[]")

# Garante coluna via REST? não — assume ALTER acima. Se select falhar, aborta.
try:
    get("/rest/v1/profiles?select=id,deduction_balance_cents&limit=1")
except Exception as e:
    print("coluna deduction_balance_cents indisponível:", e)
    raise SystemExit(0)

for table in ("protections", "back_protections"):
    rows = get(
        f"/rest/v1/{table}?status=in.(lost_exchange,won_platform)"
        "&select=id,user_id,amount_cents,responsibility_cents,platform_deduction_cents,"
        "locked_deduction_cents,platform_profit_cents,metadata,settled_outcome,status"
        "&limit=500"
    )
    if not isinstance(rows, list):
        continue
    for row in rows:
        meta = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
        fee_upfront = (
            meta.get("billing_model") == "fee_upfront_v1"
            or meta.get("fee_upfront") is True
            or "fee_upfront" in str(meta.get("source") or "")
        )
        outcome = str(row.get("settled_outcome") or meta.get("settled_outcome") or "").lower()
        st = str(row.get("status") or "").lower()
        won_arbi = outcome == "arbishield" or st in ("lost_exchange", "won_platform")
        if not (fee_upfront and won_arbi):
            continue
        fee = int(
            row.get("platform_deduction_cents")
            or meta.get("fee_charged_cents")
            or row.get("platform_profit_cents")
            or row.get("locked_deduction_cents")
            or 0
        )
        if fee <= 0:
            continue
        # Já devolveu fee?
        txs = get(
            f"/rest/v1/wallet_transactions?ref=eq.{row['id']}"
            "&type=in.(protection_settlement,protection_fee_return,deduction_credit)"
            "&select=id,amount_cents,metadata&limit=20"
        )
        already_fee = False
        for t in txs or []:
            tm = t.get("metadata") if isinstance(t.get("metadata"), dict) else {}
            if int(tm.get("fee_returned_cents") or 0) >= fee:
                already_fee = True
            if tm.get("fix") == "settle-arbishield-stake-mais-deducao-v1" and int(
                tm.get("fee_cents") or 0
            ) >= fee:
                already_fee = True
            if tm.get("kind") == "fee_topup_arbishield":
                already_fee = True
        if already_fee:
            continue
        bal_type = str(
            meta.get("balance_type")
            or meta.get("balance_type_requested")
            or meta.get("balanceType")
            or "REAL"
        ).upper()
        prof = get(
            f"/rest/v1/profiles?id=eq.{row['user_id']}"
            "&select=id,demo_balance_cents,deduction_balance_cents,balance_cents&limit=1"
        )
        p = (prof or [None])[0]
        if not p:
            continue
        body = {"updated_at": __import__("datetime").datetime.utcnow().isoformat() + "Z"}
        bucket = "deduction_balance_cents"
        if bal_type == "DEMO":
            body["demo_balance_cents"] = int(p.get("demo_balance_cents") or 0) + fee
            bucket = "demo_balance_cents"
        else:
            body["deduction_balance_cents"] = int(p.get("deduction_balance_cents") or 0) + fee
        try:
            patch(f"/rest/v1/profiles?id=eq.{row['user_id']}", body)
            post("/rest/v1/wallet_transactions", {
                "user_id": row["user_id"],
                "type": "protection_settlement",
                "amount_cents": fee,
                "ref": row["id"],
                "metadata": {
                    "protection_id": row["id"],
                    "kind": "fee_topup_arbishield",
                    "fee_returned_cents": fee,
                    "bucket": bucket,
                    "fix": "settle-arbishield-stake-mais-deducao-v1",
                    "note": "backfill: dedução devolvida (stake já tinha sido creditado)",
                },
            })
            print(f"  OK {table} {row['id'][:8]}… +{fee}¢ → {bucket}")
        except Exception as e:
            print(f"  FAIL {row['id'][:8]}… {e}")
print("backfill done")
PY
fi

sleep 1
H="$(curl -fsS --max-time 5 http://127.0.0.1:3098/health 2>/dev/null || true)"
echo "health: $H"
echo
echo "OK — Bateu ArbiShield → stake + dedução no Saldo Dedução"
echo "  Ctrl+Shift+R em https://arbishield.app/app-carteira.html"
echo "  Novos encerres já creditam stake+dedução automaticamente"
