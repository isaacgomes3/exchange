#!/usr/bin/env bash
# Hotfix: Admin Jogos — Alterar horário (como no site antigo)
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/admin-editar-horario-jogo-723d/scripts/vps-hotfix-admin-editar-horario.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/admin-editar-horario-jogo-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB"

log "UI Admin Jogos (Alterar horário)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/admin-jogos.html" -o "$WEB/admin-jogos.html"
chmod 0644 "$WEB/admin-jogos.html"
cp -f "$WEB/admin-jogos.html" "$WEB_ROOT/admin-jogos.html" 2>/dev/null || true

grep -q 'Alterar horário' "$WEB/admin-jogos.html" || die "HTML sem botão Alterar horário"
grep -q 'openScheduleModal\|confirmSchedule' "$WEB/admin-jogos.html" || die "HTML sem funções de horário"
grep -q 'scheduleModal' "$WEB/admin-jogos.html" || die "HTML sem modal de horário"

echo
echo "OK — Alterar horário no Admin Jogos"
echo "  https://arbishield.app/admin-jogos.html  (Ctrl+F5)"
echo "  Aba Encerrar / Eventos ArbiShield → Alterar horário"
