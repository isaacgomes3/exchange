#!/usr/bin/env bash
# Lista clientes com saldo na carteira Desafio (profiles.desafio_balance_cents > 0).
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-visual-disponivel-6aef/scripts/vps-list-desafio-balances.sh?v=1")
#
# Ou com tip do branch:
#   ARBISHIELD_BRANCH=cursor/desafio-visual-disponivel-6aef bash <(curl -fsSL "…/vps-list-desafio-balances.sh?v=1")
set -euo pipefail

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need docker
need python3

DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1 || true)"
[[ -n "$DB_CONTAINER" ]] || die "container Postgres não encontrado (docker ps)"

psql_db() {
  if docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@" 2>/tmp/psql-desafio-bal.err; then
    return 0
  fi
  docker exec -i "$DB_CONTAINER" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"
}

log "clientes com desafio_balance_cents > 0"
echo

SQL="$(cat <<'SQL'
SELECT
  coalesce(u.email, '(sem email)') AS email,
  coalesce(nullif(trim(p.full_name), ''), '—') AS nome,
  p.desafio_balance_cents AS cents,
  round(p.desafio_balance_cents / 100.0, 2) AS reais,
  p.id::text AS user_id
FROM public.profiles p
LEFT JOIN auth.users u ON u.id = p.id
WHERE coalesce(p.desafio_balance_cents, 0) > 0
ORDER BY p.desafio_balance_cents DESC, u.email NULLS LAST;
SQL
)"

RAW="$(echo "$SQL" | psql_db -At -F $'\t' 2>/tmp/psql-desafio-bal.out)" || {
  cat /tmp/psql-desafio-bal.err /tmp/psql-desafio-bal.out 2>/dev/null || true
  die "falha no psql"
}

if [[ -z "${RAW//[$'\t\n\r ']/}" ]]; then
  echo "(nenhum cliente com saldo Desafio > 0)"
  echo
  log "total: 0"
  exit 0
fi

python3 - "$RAW" <<'PY'
import sys

raw = sys.argv[1]
rows = []
for line in raw.splitlines():
    line = line.strip("\n")
    if not line.strip():
        continue
    parts = line.split("\t")
    while len(parts) < 5:
        parts.append("")
    email, nome, cents, reais, uid = parts[:5]
    try:
        c = int(cents)
    except Exception:
        c = 0
    rows.append((email, nome, c, reais, uid))

total = sum(r[2] for r in rows)
print(f"{'Email':<42} {'Nome':<28} {'Saldo (R$)':>12}  user_id")
print("-" * 110)
for email, nome, cents, reais, uid in rows:
    nome_s = (nome or "—")[:28]
    try:
        reais_f = f"{float(reais):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    except Exception:
        reais_f = reais
    print(f"{email:<42} {nome_s:<28} {reais_f:>12}  {uid}")
print("-" * 110)
total_f = f"{total/100:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
print(f"{len(rows)} cliente(s)  |  total Desafio: R$ {total_f}")
PY

echo
log "ok"
