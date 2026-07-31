#!/usr/bin/env bash
# ADM jogos: Editar (horário/liquidez) + Cancelar (soft-delete → Excluídos)
#
# Na VPS (root):
#   curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/admin-jogos-cancelar-editar-723d/scripts/vps-hotfix-admin-jogos-editar-cancelar.sh" -o /tmp/hotfix-jogos-edit.sh
#   bash /tmp/hotfix-jogos-edit.sh
set -euo pipefail
BRANCH="${ARBISHIELD_BRANCH:-cursor/admin-jogos-cancelar-editar-723d}"
REF="${ARBISHIELD_REF:-$BRANCH}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
mkdir -p "$WEB"

echo "==> UI admin-jogos.html (ref=$REF)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/admin-jogos.html" -o "$WEB/admin-jogos.html"
chmod 0644 "$WEB/admin-jogos.html"
cp -f "$WEB/admin-jogos.html" "$WEB_ROOT/admin-jogos.html" 2>/dev/null || true
for alt in "$WEB_ROOT/v2/admin-jogos.html" /var/www/html/v2/admin-jogos.html; do
  [[ "$alt" == "$WEB/admin-jogos.html" ]] && continue
  dir="$(dirname "$alt")"
  [[ -d "$dir" ]] || continue
  cp -f "$WEB/admin-jogos.html" "$alt" 2>/dev/null || true
done
bytes="$(wc -c < "$WEB/admin-jogos.html" | tr -d ' ')"
echo "  bytes=$bytes"
grep -q 'editMatchModal' "$WEB/admin-jogos.html" || { echo "ERRO: sem editMatchModal"; exit 1; }
grep -q 'cancelMatchModal' "$WEB/admin-jogos.html" || { echo "ERRO: sem cancelMatchModal"; exit 1; }
grep -q 'openEditMatchModal' "$WEB/admin-jogos.html" || { echo "ERRO: sem openEditMatchModal"; exit 1; }
grep -q 'confirmCancelMatch' "$WEB/admin-jogos.html" || { echo "ERRO: sem confirmCancelMatch"; exit 1; }
grep -q 'data-edit=' "$WEB/admin-jogos.html" || { echo "ERRO: sem botão Editar"; exit 1; }
grep -q 'data-cancel=' "$WEB/admin-jogos.html" || { echo "ERRO: sem botão Cancelar"; exit 1; }
echo "  ok Editar + Cancelar"

echo "OK — Ctrl+Shift+R em https://arbishield.app/admin-jogos.html"
echo "1) Agendados → Editar (horário / liquidez / publicar)"
echo "2) Agendados → Cancelar (vai para Excluídos; bloqueia se houver proteção aberta)"
