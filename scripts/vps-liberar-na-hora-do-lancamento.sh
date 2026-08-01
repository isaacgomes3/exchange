#!/usr/bin/env bash
# Padrão do lançamento: liberar entrada NA HORA QUE O ADMIN PUBLICAR (não no horário do jogo).
set -euo pipefail
REF="${ARBISHIELD_REF:-main}"
SHA=$(curl -fsS "https://api.github.com/repos/isaacgomes3/exchange/commits/${REF}" | python3 -c "import sys,json; print(json.load(sys.stdin)['sha'])")
WEB="${ARBISHIELD_WEB:-/var/www/arbishield/v2}"
mkdir -p "$WEB"
curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/${SHA}/deploy/vps-supabase/static/v2/admin-jogos.html" -o "$WEB/admin-jogos.html"
cp -f "$WEB/admin-jogos.html" /var/www/arbishield/admin-jogos.html 2>/dev/null || true
grep -q 'Na hora do lançamento' "$WEB/admin-jogos.html"
grep -q 'value="0" selected' "$WEB/admin-jogos.html"
for PRE in /opt/arbishield/scripts/arbishield-prelive-events.mjs /opt/arbishield/arbishield-prelive-events.mjs; do
  [[ -f "$PRE" ]] || continue
  curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/${SHA}/scripts/arbishield-prelive-events.mjs" -o "$PRE"
  chmod 0755 "$PRE"
done
systemctl restart arbishield-prelive-events.service 2>/dev/null || systemctl restart arbishield-prelive.service 2>/dev/null || true
echo "OK — padrão: liberar na hora que o admin lançar o evento"
