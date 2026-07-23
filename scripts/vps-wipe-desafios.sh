#!/usr/bin/env bash
# Limpa TODOS os desafios (rascunhos, ativos, pendentes) na VPS.
# - Entradas pending → devolve valor à carteira Desafio
# - Soft-delete em todos (deleted_at)
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-visual-disponivel-6aef/scripts/vps-wipe-desafios.sh?v=1")
set -euo pipefail

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }

ENV_FILE=""
for f in \
  /opt/arbishield/.env \
  /opt/arbishield/arbishield.env \
  /var/www/arbishield/.env \
  /etc/arbishield.env
do
  [[ -f "$f" ]] && ENV_FILE="$f" && break
done

# Também tenta EnvironmentFile do systemd do shim
if [[ -z "$ENV_FILE" ]] && command -v systemctl >/dev/null; then
  EF="$(systemctl show -p EnvironmentFiles --value arbishield-serverfn-shim.service 2>/dev/null | awk '{print $1}' | tr -d '\t' || true)"
  [[ -f "${EF:-}" ]] && ENV_FILE="$EF"
fi

[[ -n "$ENV_FILE" ]] || die "Não achei .env com SERVICE_ROLE_KEY (ex.: /opt/arbishield/.env)"

log "Carregando env: $ENV_FILE"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

SUPABASE_URL="${ARBISHIELD_SUPABASE_URL:-${API_EXTERNAL_URL:-${SUPABASE_PUBLIC_URL:-http://127.0.0.1:8000}}}"
SERVICE_KEY="${ARBISHIELD_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}}"
[[ -n "$SERVICE_KEY" ]] || die "SERVICE_ROLE_KEY ausente no env"

HDR=(-H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" -H "Content-Type: application/json" -H "Prefer: return=representation")

log "Listando desafios ativos (deleted_at nulo)…"
ROWS="$(curl -fsS "${HDR[@]}" \
  "$SUPABASE_URL/rest/v1/desafios?select=id,title,status,is_active&deleted_at=is.null&limit=1000")"
COUNT="$(python3 -c 'import json,sys; print(len(json.load(sys.stdin)))' <<<"$ROWS")"
log "Encontrados: $COUNT"

if [[ "$COUNT" -eq 0 ]]; then
  log "Nada a limpar — lista já vazia."
  exit 0
fi

python3 - "$SUPABASE_URL" "$SERVICE_KEY" "$ROWS" <<'PY'
import json, os, sys, urllib.request, urllib.error

base = sys.argv[1].rstrip("/")
key = sys.argv[2]
desafios = json.loads(sys.argv[3])

def req(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    r = urllib.request.Request(
        base + path,
        data=data,
        method=method,
        headers={
            "apikey": key,
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
    )
    try:
        with urllib.request.urlopen(r, timeout=60) as res:
            raw = res.read().decode() or "null"
            return json.loads(raw) if raw != "null" else None
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        raise SystemExit(f"HTTP {e.code} {path}: {err}") from e

now = __import__("datetime").datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.%fZ")
refunded_users = 0
refunded_cents = 0
deleted = 0

for d in desafios:
    did = d["id"]
    title = d.get("title") or did
    print(f"→ {title} ({did})")

    pending = req(
        "GET",
        f"/rest/v1/desafio_participations?select=id,user_id,step_id,amount_cents,result&desafio_id=eq.{did}&or=(result.eq.pending,result.is.null)&limit=2000",
    ) or []
    pending = [
        p
        for p in pending
        if str(p.get("result") or "pending").lower() in ("pending", "", "null")
    ]

    for p in pending:
        amount = int(p.get("amount_cents") or 0)
        uid = p.get("user_id")
        if uid and amount > 0:
            prof = req(
                "GET",
                f"/rest/v1/profiles?select=desafio_balance_cents&id=eq.{uid}&limit=1",
            ) or []
            bal = int((prof[0] if prof else {}).get("desafio_balance_cents") or 0)
            req(
                "PATCH",
                f"/rest/v1/profiles?id=eq.{uid}",
                {
                    "desafio_balance_cents": bal + amount,
                    "updated_at": now,
                },
            )
            try:
                req(
                    "POST",
                    "/rest/v1/wallet_transactions",
                    {
                        "user_id": uid,
                        "type": "desafio_cancel_refund",
                        "amount_cents": amount,
                        "meta": {"desafio_id": did, "wipe": True, "participation_id": p.get("id")},
                    },
                )
            except SystemExit:
                pass
            refunded_users += 1
            refunded_cents += amount
            print(f"   reembolso {amount}c → user {uid}")

        req(
            "PATCH",
            f"/rest/v1/desafio_participations?id=eq.{p['id']}",
            {"result": "cancelled", "profit_cents": 0, "updated_at": now},
        )

    req(
        "PATCH",
        f"/rest/v1/desafios?id=eq.{did}",
        {
            "deleted_at": now,
            "is_active": False,
            "status": "deleted",
            "updated_at": now,
        },
    )
    deleted += 1
    print("   excluído")

print(
    f"\nOK — excluídos: {deleted} · reembolsos: {refunded_users} ({refunded_cents} cents)"
)
PY

log "Conferido via API pública…"
LEFT="$(curl -fsS -H 'accept: application/json' https://arbishield.app/api/arbishield/desafios || echo '[]')"
LEFT_N="$(python3 -c 'import json,sys
try:
  d=json.load(sys.stdin)
  print(len([x for x in d if not x.get("deleted_at")]))
except Exception:
  print("?")
' <<<"$LEFT")"
echo "  desafios visíveis agora: $LEFT_N"
log "Pronto. Ctrl+F5 no admin de Desafios."
