#!/usr/bin/env bash
# Atualiza UI v2 (layout Jogos em todas as abas) sem cutover completo.
#
# Uso (root na VPS):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/arbishield-v2-backup-723d/scripts/vps-deploy-v2-ui.sh?v=6")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/arbishield-v2-backup-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield}/v2"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$WEB/brand"

log "Sincronizar CSS/JS do template"
for f in v2.css v2.js v2-shell.js v2-pages.js; do
  curl -fsSL "$RAW/deploy/vps-supabase/static/v2/$f" -o "$WEB/$f"
  chmod 0644 "$WEB/$f"
  echo "  ok $f"
done

log "Sincronizar brand (landing + app)"
for f in logo.png logo@2x.png favicon-192.png icon-64.png dashboard-preview.jpg stadium-hero.jpg stadium-hero-sm.jpg desafio-banner.jpg desafio-banner.webp banner-provedor.jpg banner-afiliado.jpg; do
  curl -fsSL "$RAW/deploy/vps-supabase/static/v2/brand/$f" -o "$WEB/brand/$f"
  chmod 0644 "$WEB/brand/$f"
  echo "  ok brand/$f"
done

log "Sincronizar páginas admin + app"
mapfile -t FILES < <(curl -fsSL "$RAW/deploy/vps-supabase/static/v2/" 2>/dev/null | true)
# lista explícita (GitHub raw não lista dirs)
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  curl -fsSL "$RAW/deploy/vps-supabase/static/v2/$f" -o "$WEB/$f"
  chmod 0644 "$WEB/$f"
  echo "  ok $f"
done <<'EOF'
index.html
auth.html
admin.html
app.html
app-academia.html
admin-jogos.html
admin-desafios.html
admin-desafio-sugestoes.html
admin-monitoring-protections.html
admin-users.html
admin-academia.html
admin-affiliates.html
admin-approvals.html
admin-banners.html
admin-betting-houses.html
admin-blacklist.html
admin-communication-lab.html
admin-contestations.html
admin-expenses.html
admin-geo.html
admin-investigation.html
admin-logs.html
admin-manual-deposits.html
admin-marketing-team.html
admin-monitoring.html
admin-onboarding.html
admin-partners-distribution.html
admin-partners.html
admin-performance.html
admin-permissoes.html
admin-proofs.html
admin-refunds.html
admin-risk.html
admin-saques.html
admin-settings.html
admin-settlements-audit.html
admin-siem.html
admin-signup-attempts.html
admin-support-ai.html
admin-support.html
admin-technical-audit.html
admin-transactions.html
admin-treasury.html
admin-whatsapp.html
app-afiliados.html
app-baixar-app.html
app-carteira.html
app-config.html
app-desafio.html
app-partners.html
app-perfil.html
app-protecoes.html
app-proteger.html
app-suporte.html
EOF

echo
echo "OK — UI v2 atualizada (landing + dashboard + Terminal Proteger Aposta)"
echo "  Abra https://arbishield.app/app-proteger.html e faça hard refresh (Ctrl+Shift+R)"
echo "  Admin: https://arbishield.app/admin.html"
