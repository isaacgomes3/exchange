#!/usr/bin/env bash
# Diagnóstico: qual lógica de proteção está ATIVA na VPS (:3098 / :3101)
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/diagnostico-logica-protecao-47c1/scripts/vps-diagnostico-logica-protecao.sh")
#
# Opcional — olhar proteções recentes no banco:
#   CHECK_DB=1 bash <(curl -fsSL "...")
set -euo pipefail

ENV_FILE="${ENV_FILE:-/opt/arbishield/deploy/vps-supabase/.env}"
CHECK_DB="${CHECK_DB:-0}"
PRELIVE_CANDIDATES=(
  /opt/arbishield/scripts/arbishield-prelive-events.mjs
  /opt/arbishield/arbishield-prelive-events.mjs
  /opt/arbishield/scripts/arbishield-prelive.mjs
)
SHIM_CANDIDATES=(
  /opt/arbishield/arbishield-serverfn-shim.mjs
  /opt/arbishield/scripts/arbishield-serverfn-shim.mjs
)
CONTRACT_CANDIDATES=(
  /opt/arbishield/scripts/lib/protection-flow-contract.mjs
  /opt/arbishield/lib/protection-flow-contract.mjs
)

log() { echo "==> $*"; }
ok() { echo "  OK  $*"; }
warn() { echo "  !!  $*"; }
bad() { echo "  XX  $*"; }
info() { echo "   - $*"; }

find_first() {
  local f
  for f in "$@"; do
    [[ -f "$f" ]] && { echo "$f"; return 0; }
  done
  return 1
}

# Lê KEY=VALUE sem source (mesmo problema do .env com "Organization")
load_env_keys() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  eval "$(
    python3 - "$f" <<'PY'
import shlex, sys
path = sys.argv[1]
want = {
  "ARBISHIELD_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY",
  "ARBISHIELD_SUPABASE_URL", "SUPABASE_URL", "API_EXTERNAL_URL",
}
out = {}
with open(path, "r", encoding="utf-8", errors="ignore") as fh:
  for raw in fh:
    line = raw.strip()
    if not line or line.startswith("#") or "=" not in line:
      continue
    k, _, v = line.partition("=")
    k = k.strip()
    if k.startswith("export "):
      k = k[7:].strip()
    if k not in want:
      continue
    v = v.strip()
    if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
      v = v[1:-1]
    out[k] = v
for k, v in out.items():
  print(f"export {k}={shlex.quote(v)}")
PY
  )"
}

score_file() {
  local file="$1" label="$2"
  echo
  log "$label"
  if [[ ! -f "$file" ]]; then
    bad "arquivo nao encontrado"
    return 1
  fi
  info "arquivo: $file"
  info "mtime: $(stat -c '%y' "$file" 2>/dev/null || stat -f '%Sm' "$file" 2>/dev/null || echo '?')"
  info "size: $(wc -c < "$file") bytes"

  local has_lock=0 has_fee=0 has_saldo_real=0 has_legacy_settle=0 has_contract_import=0
  local has_reusable_arbi=0 has_load_active=0 has_prot_lock_v2=0

  grep -q 'lock_fee_after' "$file" && has_lock=1
  grep -q 'fee_upfront' "$file" && has_fee=1
  grep -q 'settle-arbishield-saldo-real-v1' "$file" && has_saldo_real=1
  grep -q 'creditWalletForSettlement' "$file" && has_legacy_settle=1
  grep -q 'protection-flow-contract' "$file" && has_contract_import=1
  grep -q 'wonArbi ? "reusable_balance_cents"' "$file" && has_reusable_arbi=1
  grep -q 'loadActive' "$file" && has_load_active=1
  grep -q 'protection-lock-v2' "$file" && has_prot_lock_v2=1

  echo "  --- marcadores ---"
  [[ $has_lock -eq 1 ]] && ok "lock_fee_after (modelo 3 — contrato v4)" || info "lock_fee_after: ausente"
  [[ $has_fee -eq 1 ]] && ok "fee_upfront (modelo 2)" || info "fee_upfront: ausente"
  [[ $has_contract_import -eq 1 ]] && ok "import protection-flow-contract" || info "protection-flow-contract: nao importado"
  [[ $has_saldo_real -eq 1 ]] && ok "settle-arbishield-saldo-real-v1 (credito no saldo real)" || info "saldo-real marker: ausente"
  [[ $has_legacy_settle -eq 1 ]] && ok "creditWalletForSettlement (settle legado/simples)" || info "creditWalletForSettlement: ausente"
  [[ $has_prot_lock_v2 -eq 1 ]] && ok "protection-lock-v2 (debito na criacao)" || info "protection-lock-v2: ausente"
  [[ $has_load_active -eq 1 ]] && ok "loadActive (reparo liquidacao travada)" || info "loadActive: ausente"
  [[ $has_reusable_arbi -eq 1 ]] && bad "ainda credita ArbiShield em reusable" || ok "nao roteia Arbi -> reusable"

  local verdict=""
  if [[ $has_lock -eq 1 && $has_contract_import -eq 1 ]]; then
    verdict="MODELO 3 — lock_fee_after_v1 (contrato v4)"
  elif [[ $has_fee -eq 1 && $has_lock -eq 0 ]]; then
    verdict="MODELO 2 — fee_upfront_v1"
  elif [[ $has_legacy_settle -eq 1 || $has_saldo_real -eq 1 ]]; then
    verdict="MODELO 1 — legado/simples (trava stake; Exchange = stake - margem)"
  else
    verdict="INDEFINIDO — arquivo sem marcadores conhecidos"
  fi
  echo "  >>> VEREDITO $label: $verdict"
  case "$label" in
    *3098*|*prelive*) VERDICT_PRELIVE="$verdict" ;;
    *3101*|*shim*) VERDICT_SHIM="$verdict" ;;
  esac
}

check_health() {
  echo
  log "Health das portas"
  if curl -fsS --max-time 3 http://127.0.0.1:3098/health >/dev/null 2>&1; then
    ok ":3098 prelive responde"
    curl -fsS --max-time 3 http://127.0.0.1:3098/health 2>/dev/null | head -c 200 || true
    echo
  else
    if curl -fsS --max-time 2 -o /dev/null -w "%{http_code}" http://127.0.0.1:3098/ >/dev/null 2>&1; then
      warn ":3098 escuta, sem /health"
    else
      bad ":3098 nao responde"
    fi
  fi
  if systemctl is-active --quiet arbishield-prelive-events.service 2>/dev/null || \
     systemctl is-active --quiet arbishield-prelive.service 2>/dev/null; then
    ok "systemd prelive: active"
  else
    warn "systemd prelive: nao active / nome diferente"
    systemctl list-units --type=service --all 2>/dev/null | grep -i prelive || true
  fi

  if curl -fsS --max-time 3 http://127.0.0.1:3101/health >/dev/null 2>&1; then
    ok ":3101 shim responde"
  else
    warn ":3101 sem /health (pode ser normal)"
  fi
  if systemctl is-active --quiet arbishield-serverfn-shim.service 2>/dev/null; then
    ok "systemd shim: active"
  else
    warn "systemd shim: nao active"
  fi
}

check_db() {
  echo
  log "Protecoes recentes no banco (metadata.billing_model)"
  load_env_keys "$ENV_FILE"
  [[ -f /opt/arbishield/.env ]] && load_env_keys /opt/arbishield/.env
  local key="${ARBISHIELD_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}}"
  local url="${ARBISHIELD_SUPABASE_URL:-${SUPABASE_URL:-${API_EXTERNAL_URL:-http://127.0.0.1:8000}}}"
  url="${url%/}"
  if [[ -z "$key" ]]; then
    bad "SERVICE_ROLE_KEY ausente — pulei CHECK_DB"
    return 0
  fi
  local rows
  rows=$(curl -fsSL \
    -H "apikey: $key" \
    -H "Authorization: Bearer $key" \
    "$url/rest/v1/protections?select=id,status,amount_cents,created_at,metadata&order=created_at.desc&limit=15" 2>/dev/null || echo "[]")
  echo "$rows" | python3 -c '
import json,sys
raw=sys.stdin.read()
try:
  rows=json.loads(raw)
except Exception:
  print("  (falha ao ler JSON)", raw[:120])
  raise SystemExit(0)
if not rows:
  print("  (nenhuma protecao)")
  raise SystemExit(0)
counts={}
for r in rows:
  meta=r.get("metadata") or {}
  if not isinstance(meta, dict):
    meta={}
  model=meta.get("billing_model") or (
    "lock_fee_after_v1" if meta.get("lock_fee_after") else
    "fee_upfront_v1" if meta.get("fee_upfront") else
    meta.get("source") or "(sem billing_model — legado/simples)"
  )
  counts[model]=counts.get(model,0)+1
  print("  - %s  %s  R$%.2f  -> %s" % (
    str(r.get("created_at") or "")[:19],
    r.get("status"),
    (r.get("amount_cents") or 0)/100.0,
    model,
  ))
print("  --- totais (15 mais recentes) ---")
for k,v in sorted(counts.items(), key=lambda x:-x[1]):
  print("  %dx  %s" % (v, k))
'
}

VERDICT_PRELIVE="(nao analisado)"
VERDICT_SHIM="(nao analisado)"

echo
echo "=============================================================="
echo "  Diagnostico — logica de protecao ativa na VPS"
echo "=============================================================="
echo
echo "Modelos possiveis:"
echo "  1) legado/simples     — trava stake; Exchange = stake - margem"
echo "  2) fee_upfront_v1     — cobra taxa na criacao"
echo "  3) lock_fee_after_v1  — trava stake; cobra taxa so no Exchange (contrato v4)"
echo

PRELIVE=$(find_first "${PRELIVE_CANDIDATES[@]}" || true)
SHIM=$(find_first "${SHIM_CANDIDATES[@]}" || true)
CONTRACT=$(find_first "${CONTRACT_CANDIDATES[@]}" || true)

if [[ -n "${PRELIVE:-}" ]]; then
  score_file "$PRELIVE" "prelive :3098"
else
  bad "prelive nao encontrado"
fi

if [[ -n "${SHIM:-}" ]]; then
  score_file "$SHIM" "shim :3101"
else
  bad "shim nao encontrado"
fi

echo
log "Contrato protection-flow-contract.mjs"
if [[ -n "${CONTRACT:-}" ]]; then
  ok "presente: $CONTRACT"
  grep -E 'PROTECTION_FLOW_CONTRACT_VERSION|PROTECTION_BILLING_MODEL_DEFAULT' "$CONTRACT" | head -5 | sed 's/^/  /'
else
  warn "AUSENTE — VPS sem contrato v4 (lock_fee_after completo improvavel)"
fi

check_health

if [[ "$CHECK_DB" == "1" ]]; then
  check_db
else
  echo
  info "Para ver billing_model nas protecoes recentes:"
  info "  CHECK_DB=1 bash <(curl -fsSL \"https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/diagnostico-logica-protecao-47c1/scripts/vps-diagnostico-logica-protecao.sh\")"
fi

echo
echo "=============================================================="
echo "  RESUMO"
echo "=============================================================="
echo "  :3098 prelive -> $VERDICT_PRELIVE"
echo "  :3101 shim    -> $VERDICT_SHIM"
echo
if [[ "$VERDICT_PRELIVE" != "$VERDICT_SHIM" && "$VERDICT_PRELIVE" != "(nao analisado)" && "$VERDICT_SHIM" != "(nao analisado)" ]]; then
  bad "DIVERGENCIA: prelive e shim com logicas diferentes"
  echo "  Cliente cria em :3098; alguns settles passam por :3101."
else
  ok "prelive e shim alinhados (ou um ausente)"
fi
echo
echo "  Fluxo do cliente V2 (app-proteger.html):"
echo "    POST /api/arbishield/protections -> nginx -> :3098  (criacao)"
echo "  Fluxo Admin Encerrar:"
echo "    match-settle / matches?mode=settle -> :3101 ou :3098"
echo
