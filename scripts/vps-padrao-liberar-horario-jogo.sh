#!/usr/bin/env bash
# Default do lançamento manual: "60 minutos antes" (NÃO no horário do jogo).
# bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/protecao-fee-upfront-3cf9/scripts/vps-padrao-liberar-horario-jogo.sh?$(date +%s)")
set -euo pipefail
REF="${ARBISHIELD_REF:-cursor/protecao-fee-upfront-3cf9}"
SHA=$(curl -fsS "https://api.github.com/repos/isaacgomes3/exchange/commits/${REF}" | python3 -c "import sys,json; print(json.load(sys.stdin)['sha'])")
WEB="${ARBISHIELD_WEB:-/var/www/arbishield/v2}"
mkdir -p "$WEB"
curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/${SHA}/deploy/vps-supabase/static/v2/admin-jogos.html" -o "$WEB/admin-jogos.html"
cp -f "$WEB/admin-jogos.html" /var/www/arbishield/admin-jogos.html 2>/dev/null || true
grep -q 'value="60" selected' "$WEB/admin-jogos.html"
for PRE in /opt/arbishield/scripts/arbishield-prelive-events.mjs /opt/arbishield/arbishield-prelive-events.mjs; do
  [[ -f "$PRE" ]] || continue
  curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/${SHA}/scripts/arbishield-prelive-events.mjs" -o "$PRE"
  chmod 0755 "$PRE"
done
systemctl restart arbishield-prelive-events.service 2>/dev/null || systemctl restart arbishield-prelive.service 2>/dev/null || true
echo "OK — padrão liberar: 60 minutos antes"
