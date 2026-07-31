#!/usr/bin/env bash
# Auditoria de acessos/privilégios suspeitos + nginx delete/cancel.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/investigar-adm-jawadog-3e4b/scripts/vps-auditoria-acessos-maliciosos.sh")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/investigar-adm-jawadog-3e4b}"
SHA="$(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/commits/${BRANCH}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["sha"])')"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${SHA}/scripts"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
mkdir -p "$SCRIPTS_DIR"

echo "════════════════════════════════════════════════════════════════════════"
echo "AUDITORIA MALICIOSOS · sha=${SHA:0:12}"
echo "════════════════════════════════════════════════════════════════════════"

curl -fsSL "$RAW/vps-auditoria-acessos-maliciosos.mjs" \
  -o "$SCRIPTS_DIR/vps-auditoria-acessos-maliciosos.mjs"
chmod 0644 "$SCRIPTS_DIR/vps-auditoria-acessos-maliciosos.mjs"

echo
echo "######## A) Banco / Auth / privilégios ########"
node "$SCRIPTS_DIR/vps-auditoria-acessos-maliciosos.mjs"

echo
echo "######## B) Hardening aplicado? (policies/grants) ########"
DB="$(docker ps --format '{{.Names}}' | grep -E 'db|postgres' | head -1 || true)"
if [[ -n "$DB" ]]; then
  docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=0 <<'SQL' || \
  docker exec -i "$DB" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=0 <<'SQL'
SELECT 'user_roles policies' AS what, policyname, cmd
FROM pg_policies WHERE tablename='user_roles' ORDER BY 2;

SELECT 'is_super_admin grants' AS what, grantee, privilege_type
FROM information_schema.role_column_grants
WHERE table_schema='public' AND table_name='profiles'
  AND column_name='is_super_admin'
  AND grantee IN ('anon','authenticated')
ORDER BY 2,3;

SELECT 'shim allowlist file' AS what, 'check node marker below' AS detail;
SQL
else
  echo "(sem container postgres)"
fi

if grep -q 'admin-email-allowlist-v1' /opt/arbishield/scripts/arbishield-serverfn-shim.mjs 2>/dev/null \
  || grep -q 'admin-email-allowlist-v1' /var/www/arbishield/v2/v2.js 2>/dev/null; then
  echo "  allowlist no código: SIM"
else
  echo "  allowlist no código: NÃO — rode vps-hotfix-admin-hardening.sh"
fi

echo
echo "######## C) nginx · POST desafio-delete/cancel (30–31/07) IPs ########"
shopt -s nullglob
{
  for f in /var/log/nginx/*access* /var/log/nginx/access.log*; do
    [[ -e "$f" ]] || continue
    if [[ "$f" == *.gz ]]; then
      zgrep -E 'POST /api/arbishield/desafio-(delete|cancel)' "$f" 2>/dev/null \
        | grep -E '30/Jul/2026|31/Jul/2026' || true
    else
      grep -E 'POST /api/arbishield/desafio-(delete|cancel)' "$f" 2>/dev/null \
        | grep -E '30/Jul/2026|31/Jul/2026' || true
    fi
  done
} | awk '{print $1}' | sort | uniq -c | sort -rn | head -40 || echo "(sem hits)"

echo
echo "######## D) nginx · POST delete/cancel com status 200 (sucesso) ########"
{
  for f in /var/log/nginx/*access* /var/log/nginx/access.log*; do
    [[ -e "$f" ]] || continue
    if [[ "$f" == *.gz ]]; then
      zgrep -E 'POST /api/arbishield/desafio-(delete|cancel)' "$f" 2>/dev/null \
        | grep -E '30/Jul/2026|31/Jul/2026' | grep ' 200 ' || true
    else
      grep -E 'POST /api/arbishield/desafio-(delete|cancel)' "$f" 2>/dev/null \
        | grep -E '30/Jul/2026|31/Jul/2026' | grep ' 200 ' || true
    fi
  done
} | awk '{print $1}' | sort | uniq -c | sort -rn | head -20 || echo "(sem 200)"

echo
echo "OK — cole a saída completa (A–D)."
