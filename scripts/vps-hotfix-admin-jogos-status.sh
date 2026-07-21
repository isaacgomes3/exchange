#!/usr/bin/env bash
# Hotfix: Admin Jogos — status Agendados / Ao vivo / Pendente (legado)
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/admin-jogos-status-agendados-723d/scripts/vps-hotfix-admin-jogos-status.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/admin-jogos-status-agendados-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB"

log "UI Admin Jogos (status Agendados / Ao vivo / Pendente)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/admin-jogos.html" -o "$WEB/admin-jogos.html"
chmod 0644 "$WEB/admin-jogos.html"
cp -f "$WEB/admin-jogos.html" "$WEB_ROOT/admin-jogos.html" 2>/dev/null || true

grep -q 'data-pf="upcoming"' "$WEB/admin-jogos.html" || die "HTML sem aba Agendados"
grep -q 'data-pf="live"' "$WEB/admin-jogos.html" || die "HTML sem aba Ao vivo"
grep -q 'data-pf="pending"' "$WEB/admin-jogos.html" || die "HTML sem aba Pendente"
grep -q 'LIVE_WINDOW_MS = 9000' "$WEB/admin-jogos.html" || die "HTML sem janela live do legado"
grep -q 'function matchBucket' "$WEB/admin-jogos.html" || die "HTML sem matchBucket"
# Garante que a lógica antiga (fila/settle) não sobrescreveu
! grep -q 'platformFilter === "fila"' "$WEB/admin-jogos.html" || die "HTML ainda tem filtro fila legado"
! grep -q 'return "settle"' "$WEB/admin-jogos.html" || die "HTML ainda retorna bucket settle"

echo
echo "OK — Status Agendados / Ao vivo / Pendente no Admin Jogos"
echo "  https://arbishield.app/admin-jogos.html  (Ctrl+F5)"
echo "  KPIs + abas: Agendados (não começou) · Ao vivo · Pendente (+2h30)"
