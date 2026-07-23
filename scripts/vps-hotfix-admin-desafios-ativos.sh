#!/usr/bin/env bash
# Admin Desafios: abre em Ativos; finalizados só em Todos.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-admin-desafios-ativos.sh")
set -euo pipefail

REF="37fd7da4cd9625a7ec1f782111e95da90d59cf1d"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT" "$SHIM_DIR"

dl() {
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$RAW/$1?v=$BUST" -o "$2"
}

log "1/2 UI — lista compacta (só o jogo) + Ativos + Encerrado"
dl "deploy/vps-supabase/static/v2/admin-desafios.html" "$WEB/admin-desafios.html"
chmod 0644 "$WEB/admin-desafios.html"
cp -f "$WEB/admin-desafios.html" "$WEB_ROOT/admin-desafios.html" 2>/dev/null || true

grep -q 'isDesafioActiveOpen' "$WEB/admin-desafios.html" || die "admin-desafios sem filtro Ativos limpo"
grep -q 'desafioBadge' "$WEB/admin-desafios.html" || die "admin-desafios sem badge Encerrado"
grep -q 'data-toggle-desafio' "$WEB/admin-desafios.html" || die "admin-desafios sem accordion do jogo"
grep -q 'card-body' "$WEB/admin-desafios.html" || die "admin-desafios sem corpo expansível"
grep -q '__desafioFilter = "active"' "$WEB/admin-desafios.html" || die "admin-desafios não abre em Ativos"
grep -q 'Finalizados ficam em Todos' "$WEB/admin-desafios.html" || die "admin-desafios sem regra finalizados só em Todos"
grep -q 'class="tab is-on" data-f="active"' "$WEB/admin-desafios.html" \
  || die "aba Ativos não está selecionada por defeito"

log "2/2 Shim — settle desativa desafio quando todas as etapas encerram"
dl "scripts/arbishield-serverfn-shim.mjs" "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
for u in arbishield-serverfn-shim.service; do
  if systemctl cat "$u" >/dev/null 2>&1; then
    exec="$(systemctl show -p ExecStart --value "$u" 2>/dev/null | head -1 || true)"
    if [[ "$exec" =~ (/[^[:space:]]+arbishield-serverfn-shim\.mjs) ]]; then
      cp -f "$SHIM_DIR/arbishield-serverfn-shim.mjs" "${BASH_REMATCH[1]}"
      echo "  wrote ${BASH_REMATCH[1]}"
    fi
  fi
done
grep -q 'desafioDeactivated' "$SHIM_DIR/arbishield-serverfn-shim.mjs" \
  || die "shim sem desativação pós-settle"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

log "OK — hard refresh em /admin-desafios.html"
log "Após Bateu (última etapa): badge Encerrado e some de Ativos."

