#!/usr/bin/env bash
# Limpa TODOS os desafios (rascunhos, ativos, pendentes) na VPS.
# - Entradas pending → devolve valor à carteira Desafio
# - Soft-delete em todos (deleted_at)
#
# Na VPS (root) — use o SHA para evitar cache do raw.githubusercontent:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/6fdb049eb7647cfd9bada17fa87d5ec1282adfaf/scripts/vps-wipe-desafios.sh")
# ou:
#   ENV_FILE=/opt/arbishield/deploy/vps-supabase/.env bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-visual-disponivel-6aef/scripts/vps-wipe-desafios.sh?v=4")
set -euo pipefail

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }

echo "==> wipe-desafios v4"

has_service_role() {
  local f="$1"
  [[ -f "$f" ]] || return 1
  # Aceita export, espaços e CRLF
  grep -qE '(^|[[:space:]])(export[[:space:]]+)?(ARBISHIELD_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY)=' "$f" 2>/dev/null
}

load_env_file() {
  local f="$1"
  [[ -f "$f" ]] || return 1
  # Parse seguro via python (evita source com CRLF / valores especiais)
  eval "$(
    python3 - "$f" <<'PY'
import re, shlex, sys
path = sys.argv[1]
keys = {
  "ARBISHIELD_SERVICE_ROLE_KEY",
  "SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ARBISHIELD_SUPABASE_URL",
  "API_EXTERNAL_URL",
  "SUPABASE_PUBLIC_URL",
  "ANON_KEY",
  "SUPABASE_ANON_KEY",
}
text = open(path, "rb").read().decode("utf-8", "replace").replace("\r\n", "\n").replace("\r", "\n")
out = []
for raw in text.splitlines():
    line = raw.strip()
    if not line or line.startswith("#"):
        continue
    if line.startswith("export "):
        line = line[7:].strip()
    if "=" not in line:
        continue
    k, v = line.split("=", 1)
    k = k.strip()
    if k not in keys:
        continue
    v = v.strip()
    if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
        v = v[1:-1]
    out.append(f"export {k}={shlex.quote(v)}")
print("\n".join(out))
PY
  )"
  return 0
}

CANDIDATES=(
  "${ENV_FILE:-}"
  /opt/arbishield/deploy/vps-supabase/.env
  /opt/arbishield/.env
  /opt/arbishield/arbishield.env
  /opt/arbishield/.arbishield-odds-sync.env
  /var/www/arbishield/.env
  /etc/arbishield.env
  /root/arbishield/.env
  /root/deploy/vps-supabase/.env
)

if command -v systemctl >/dev/null 2>&1; then
  for svc in arbishield-serverfn-shim arbishield-prelive-events arbishield-desafio-suggestions; do
    while IFS= read -r line; do
      f="$(echo "$line" | awk '{print $1}' | tr -d '\t')"
      [[ -n "$f" && -f "$f" ]] && CANDIDATES+=("$f")
    done < <(systemctl show -p EnvironmentFiles --value "${svc}.service" 2>/dev/null || true)
  done
fi

# Busca ampla só se o .env conhecido não existir (evita travar em discos grandes)
KNOWN=/opt/arbishield/deploy/vps-supabase/.env
if [[ ! -f "$KNOWN" ]] && [[ ! -f "${ENV_FILE:-}" ]]; then
  while IFS= read -r f; do
    [[ -n "$f" ]] && CANDIDATES+=("$f")
  done < <(
    timeout 8 grep -rlE 'SERVICE_ROLE_KEY=' /opt/arbishield /var/www/arbishield 2>/dev/null | head -20 || true
  )
fi

FOUND=""
for f in "${CANDIDATES[@]}"; do
  [[ -n "$f" && -f "$f" ]] || continue
  if has_service_role "$f"; then
    FOUND="$f"
    break
  fi
done

if [[ -n "$FOUND" ]]; then
  log "Carregando env: $FOUND"
  load_env_file "$FOUND"
else
  log "Nenhum .env com SERVICE_ROLE — tentando processo shim/prelive…"
fi

if [[ -z "${SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-${ARBISHIELD_SERVICE_ROLE_KEY:-}}}" ]]; then
  for pat in arbishield-serverfn-shim arbishield-prelive-events; do
    PID="$(pgrep -f "$pat" | head -1 || true)"
    [[ -n "${PID:-}" && -r "/proc/$PID/environ" ]] || continue
    EVAL_LINE="$(
      tr '\0' '\n' < "/proc/$PID/environ" \
        | grep -E '^(ARBISHIELD_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY|ARBISHIELD_SUPABASE_URL|API_EXTERNAL_URL|SUPABASE_PUBLIC_URL)=' \
        || true
    )"
    if [[ -n "$EVAL_LINE" ]]; then
      log "Usando env do PID $PID ($pat)"
      while IFS= read -r line; do
        export "$line"
      done <<<"$EVAL_LINE"
      break
    fi
  done
fi

SUPABASE_URL="${ARBISHIELD_SUPABASE_URL:-${API_EXTERNAL_URL:-${SUPABASE_PUBLIC_URL:-http://127.0.0.1:8000}}}"
SERVICE_KEY="${ARBISHIELD_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}}"

if [[ -z "$SERVICE_KEY" ]]; then
  echo "Candidatos testados:" >&2
  for f in "${CANDIDATES[@]}"; do
    [[ -n "$f" ]] || continue
    if [[ -f "$f" ]]; then
      echo "  [existe] $f" >&2
    else
      echo "  [ausente] $f" >&2
    fi
  done
  die "SERVICE_ROLE_KEY não carregou (wipe v4). Confira /opt/arbishield/deploy/vps-supabase/.env"
fi

log "Supabase: $SUPABASE_URL"
HDR=(-H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" -H "Content-Type: application/json" -H "Prefer: return=representation")

log "Listando desafios (deleted_at nulo)…"
ROWS="$(curl -fsS "${HDR[@]}" \
  "$SUPABASE_URL/rest/v1/desafios?select=id,title,status,is_active&deleted_at=is.null&limit=1000")" \
  || die "Falha ao listar desafios (URL/chave?)"
COUNT="$(python3 -c 'import json,sys; print(len(json.load(sys.stdin)))' <<<"$ROWS")"
log "Encontrados: $COUNT"

if [[ "$COUNT" -eq 0 ]]; then
  log "Nada a limpar — lista já vazia."
  exit 0
fi

python3 - "$SUPABASE_URL" "$SERVICE_KEY" "$ROWS" <<'PY'
import json, sys, urllib.request, urllib.error

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
                {"desafio_balance_cents": bal + amount, "updated_at": now},
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

print(f"\nOK — excluídos: {deleted} · reembolsos: {refunded_users} ({refunded_cents} cents)")
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
log "Pronto (wipe v4). Ctrl+F5 no admin."
