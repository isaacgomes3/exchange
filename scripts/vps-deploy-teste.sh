#!/usr/bin/env bash
# Publica UI + workers NO AMBIENTE DE TESTE apenas.
# Nunca escreve em /var/www/arbishield nem reinicia :3098/:3101.
#
# Uso (root na VPS):
#   ARBISHIELD_REF=<sha-ou-branch> bash /opt/arbishield-teste/scripts/vps-deploy-teste.sh
#
# Ou direto do GitHub:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/BRANCH/scripts/vps-deploy-teste.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/ambiente-teste-3cf9}"
REF="${ARBISHIELD_REF:-$BRANCH}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_TESTE_WEB:-/var/www/arbishield-teste}"
WEB="$WEB_ROOT/v2"
CODE_DIR="${ARBISHIELD_TESTE_DIR:-/opt/arbishield-teste}"
SCRIPTS_DIR="$CODE_DIR/scripts"
PORT="${ARBISHIELD_TESTE_PORT:-8090}"
DOMAIN="${ARBISHIELD_TESTE_DOMAIN:-127.0.0.1:${PORT}}"

# Trava de segurança: nunca permitir apontar para produção
if [[ "$WEB_ROOT" == "/var/www/arbishield" || "$WEB" == "/var/www/arbishield/v2" ]]; then
  echo "ERRO: recusado publicar teste em path de produção ($WEB_ROOT)" >&2
  exit 1
fi
if [[ "$CODE_DIR" == "/opt/arbishield" ]]; then
  echo "ERRO: recusado publicar teste em /opt/arbishield (produção)" >&2
  exit 1
fi

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$WEB/brand" "$SCRIPTS_DIR"

download() {
  local rel="$1" dest="$2"
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$RAW/$rel" -o "$dest"
  chmod 0644 "$dest" 2>/dev/null || true
}

log "Deploy TESTE ref=$REF → $WEB_ROOT (produção intacta)"

log "Workers teste"
download "scripts/arbishield-prelive-events.mjs" "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
download "scripts/arbishield-serverfn-shim.mjs" "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
chmod 0755 "$SCRIPTS_DIR/arbishield-prelive-events.mjs" "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
# Cópia do próprio deploy script (auto-update)
download "scripts/vps-deploy-teste.sh" "$SCRIPTS_DIR/vps-deploy-teste.sh" || true
chmod 0755 "$SCRIPTS_DIR/vps-deploy-teste.sh" 2>/dev/null || true

# Marker de ambiente nos scripts (só no disco do teste)
if ! grep -q "ARBISHIELD_ENV=teste\|ambiente-teste" "$SCRIPTS_DIR/arbishield-prelive-events.mjs" 2>/dev/null; then
  :
fi
printf '%s\n' "teste" > "$CODE_DIR/ENV_NAME"
cat > "$CODE_DIR/.env" <<EOF
# Gerado por vps-deploy-teste.sh — não usar em produção
ARBISHIELD_ENV=teste
ARBISHIELD_SITE=teste
PRELIVE_LISTEN=127.0.0.1:3198
SERVERFN_LISTEN=127.0.0.1:3201
EOF

log "UI v2 (CSS/JS)"
for f in v2.css v2.js v2-shell.js v2-pages.js v2-deposit.js v2-financeiro.js v2-provedor.js v2-afiliados.js market-catalog.js; do
  if curl -fsSL --retry 3 "$RAW/deploy/vps-supabase/static/v2/$f" -o "$WEB/$f" 2>/dev/null; then
    chmod 0644 "$WEB/$f"
    echo "  ok $f"
  else
    echo "  skip $f"
  fi
done

log "Brand"
for f in logo.png logo@2x.png favicon-192.png icon-64.png dashboard-preview.jpg stadium-hero.jpg stadium-hero-sm.jpg desafio-banner.jpg desafio-banner.webp banner-provedor.jpg banner-afiliado.jpg pix-qr-inter.png; do
  curl -fsSL --retry 2 "$RAW/deploy/vps-supabase/static/v2/brand/$f" -o "$WEB/brand/$f" 2>/dev/null \
    && chmod 0644 "$WEB/brand/$f" \
    && echo "  ok brand/$f" \
    || true
done

log "Páginas HTML"
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  if curl -fsSL --retry 3 "$RAW/deploy/vps-supabase/static/v2/$f" -o "$WEB/$f" 2>/dev/null; then
    chmod 0644 "$WEB/$f"
    echo "  ok $f"
  else
    echo "  skip $f"
  fi
done <<'EOF'
index.html
auth.html
admin.html
app.html
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
admin-monitoring-desafios.html
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
app-academia.html
app-academia-video.html
app-baixar-app.html
app-carteira.html
app-config.html
app-desafio.html
app-desafio-jornada.html
app-partners.html
app-perfil.html
app-protecoes.html
app-proteger.html
app-suporte.html
EOF

# Garante banner de teste mesmo se o REF antigo não tiver o helper em v2.js
if [[ -f "$WEB/v2.js" ]] && ! grep -q 'arbishield-teste-banner' "$WEB/v2.js"; then
  log "Injetar banner de ambiente em v2.js"
  cat >> "$WEB/v2.js" <<'EOF'

/* --- ambiente teste (injetado por vps-deploy-teste.sh) --- */
(function (global) {
  function isTesteHost() {
    var loc = global.location || {};
    var h = String(loc.hostname || "").toLowerCase();
    var p = String(loc.port || "");
    return p === "8090" || p === "8091" || h === "teste.arbishield.app" || h.indexOf("teste.") === 0;
  }
  function paintBanner() {
    if (!isTesteHost() || document.getElementById("arbishield-teste-banner")) return;
    var b = document.createElement("div");
    b.id = "arbishield-teste-banner";
    b.setAttribute("role", "status");
    b.style.cssText =
      "position:sticky;top:0;z-index:99999;background:#7c2d12;color:#ffedd5;" +
      "text-align:center;padding:8px 12px;font:700 12px/1.4 ui-sans-serif,system-ui,sans-serif";
    b.textContent =
      "AMBIENTE DE TESTE — código isolado de produção. Banco pode ser o mesmo: cuidado com settle/pagamentos.";
    (document.body || document.documentElement).prepend(b);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", paintBanner);
  } else {
    paintBanner();
  }
})(window);
EOF
fi

# Marker de deploy
cat > "$WEB/TESTE_BUILD.json" <<EOF
{
  "env": "teste",
  "ref": "$REF",
  "branch": "$BRANCH",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "webRoot": "$WEB_ROOT"
}
EOF

if systemctl list-unit-files 2>/dev/null | grep -q 'arbishield-prelive-events-teste'; then
  log "Reiniciar workers TESTE (:3198 / :3201)"
  systemctl restart arbishield-prelive-events-teste.service || true
  systemctl restart arbishield-serverfn-shim-teste.service || true
  sleep 1
  curl -fsS --max-time 5 "http://127.0.0.1:3198/health" >/dev/null \
    && log "health :3198 OK" \
    || echo "AVISO: health :3198 falhou" >&2
  curl -fsS --max-time 5 "http://127.0.0.1:3201/health" >/dev/null \
    && log "health :3201 OK" \
    || echo "AVISO: health :3201 falhou" >&2
else
  log "Units teste ainda não instalados — rode vps-enable-teste.sh"
fi

PUB_IP="$(curl -4 -fsS --max-time 3 ifconfig.me 2>/dev/null || true)"
echo
echo "OK — TESTE atualizado (produção NÃO foi alterada)"
echo "  http://127.0.0.1:${PORT}/admin-jogos.html  (Ctrl+F5)"
if [[ -n "$PUB_IP" ]]; then
  echo "  http://${PUB_IP}:${PORT}/admin-jogos.html"
fi
echo "  build: $WEB/TESTE_BUILD.json"
