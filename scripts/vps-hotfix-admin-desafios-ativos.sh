#!/usr/bin/env bash
# Admin Desafios: abre em Ativos; finalizados só em Todos.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-admin-desafios-ativos.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-8be895b}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT"

dl() {
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$RAW/$1?v=$BUST" -o "$2"
}

log "1/1 UI — admin-desafios abre em Ativos (sem finalizados)"
dl "deploy/vps-supabase/static/v2/admin-desafios.html" "$WEB/admin-desafios.html"
chmod 0644 "$WEB/admin-desafios.html"
cp -f "$WEB/admin-desafios.html" "$WEB_ROOT/admin-desafios.html" 2>/dev/null || true

grep -q 'isDesafioActiveOpen' "$WEB/admin-desafios.html" || die "admin-desafios sem filtro Ativos limpo"
grep -q '__desafioFilter = "active"' "$WEB/admin-desafios.html" || die "admin-desafios não abre em Ativos"
grep -q 'Finalizados ficam em Todos' "$WEB/admin-desafios.html" || die "admin-desafios sem regra finalizados só em Todos"
# Aba Ativos deve ser a marcada por defeito
grep -q 'class="tab is-on" data-f="active"' "$WEB/admin-desafios.html" \
  || die "aba Ativos não está selecionada por defeito"

log "OK — hard refresh em /admin-desafios.html"
log "Abre em Ativos; jogos encerrados só aparecem em Todos."
