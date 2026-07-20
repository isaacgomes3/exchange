#!/usr/bin/env bash
# Hotfix cirúrgico: Lançar Desafio (SPA) + Próximos jogos (BetBra).
# NÃO altera nginx, CSR boot nem estabilização global.
#
# Uso na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/admin-ops-fix-723d/scripts/vps-hotfix-admin-ops.sh?v=6")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/admin-ops-fix-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
SCRIPTS_DIR="${SCRIPTS_DIR:-/opt/arbishield/scripts}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }

for cmd in curl systemctl python3; do
  command -v "$cmd" >/dev/null 2>&1 || die "comando '$cmd' não encontrado"
done

mkdir -p "$SCRIPTS_DIR" "$WEB/assets"

download() { curl -fsSL "$RAW/$1" -o "$2"; }

log "1/5 — guard Jogos (inline head + script) + anti-freeze modais"
download "deploy/vps-supabase/static/admin-jogos-guard.js" "$WEB/assets/admin-jogos-guard.js"
download "deploy/vps-supabase/static/app-stability.js" "$WEB/assets/app-stability.js"
download "deploy/vps-supabase/static/admin-modal-fix.js" "$WEB/assets/admin-modal-fix.js"
download "deploy/vps-supabase/static/desafio-sugestoes-inject.js" "$WEB/assets/desafio-sugestoes-inject.js"
chmod 0644 \
  "$WEB/assets/admin-jogos-guard.js" \
  "$WEB/assets/app-stability.js" \
  "$WEB/assets/admin-modal-fix.js" \
  "$WEB/assets/desafio-sugestoes-inject.js"

INDEX="$WEB/index.html"
GUARD_FILE="$WEB/assets/.admin-jogos-guard-inline.html"
download "deploy/vps-supabase/static/admin-jogos-guard-inline.html" "$GUARD_FILE"

if [[ -f "$INDEX" ]]; then
  python3 <<'PY'
import re
from pathlib import Path

web = Path("/var/www/arbishield")
index = web / "index.html"
guard_file = web / "assets/.admin-jogos-guard-inline.html"
guard = guard_file.read_text(encoding="utf-8", errors="replace").strip()
html = index.read_text(encoding="utf-8", errors="replace")

html = re.sub(
    r'<script[^>]*data-arbishield="jogos-guard"[^>]*>[\s\S]*?</script>\s*',
    "",
    html,
    flags=re.I,
)
html = re.sub(
    r'<style[^>]*data-arbishield="jogos-guard"[^>]*>[\s\S]*?</style>\s*',
    "",
    html,
    flags=re.I,
)

script_tag = '<script src="/assets/admin-jogos-guard.js"></script>'
html = html.replace(script_tag, "")

insert = "    " + guard + "\n    " + script_tag + "\n"
if "</head>" in html:
    html = html.replace("</head>", insert + "  </head>", 1)
else:
    html = insert + html

index.write_text(html, encoding="utf-8")
print("index.html: guard jogos (inline + script) injetado no <head>")
PY
fi

log "2/5 — página Gestão de Jogos (BetBra → mercados → lançar)"
download "deploy/vps-supabase/static/admin-jogos-vps.html" "$WEB/admin-jogos-vps.html"
chmod 0644 "$WEB/admin-jogos-vps.html"

log "3/5 — shim serverFn (salvar desafio no SPA)"
download "scripts/arbishield-serverfn-shim.mjs" "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
chmod 755 "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"

log "4/5 — worker pré-live :3098 (lista jogos + POST matches)"
download "scripts/arbishield-prelive-events.mjs" "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
chmod 755 "$SCRIPTS_DIR/arbishield-prelive-events.mjs"

log "5/5 — serviços"
if systemctl is-active --quiet arbishield-serverfn-shim.service 2>/dev/null; then
  systemctl restart arbishield-serverfn-shim.service
  log "shim :3101 reiniciado"
else
  echo "AVISO: arbishield-serverfn-shim inativo — suba com vps-stabilize-arbishield.sh" >&2
fi

if systemctl is-active --quiet arbishield-prelive-events.service 2>/dev/null; then
  systemctl restart arbishield-prelive-events.service
  log "prelive :3098 reiniciado"
else
  echo "AVISO: arbishield-prelive-events inativo — suba com vps-stabilize-arbishield.sh" >&2
fi

echo
echo "OK — hotfix admin aplicado (site principal intacto)"
echo "  Desafios SPA:  https://arbishield.app/admin/desafios  → Lançar Desafio"
echo "  Jogos BetBra:  https://arbishield.app/admin/matches   → Próximos jogos (sempre VPS, nunca SPA manual)"
echo
echo "Verifique:"
echo "  grep -o 'jogos-guard\\|admin-jogos-guard' $INDEX"
echo "  curl -sS -o /dev/null -w '%{http_code}\\n' http://127.0.0.1:3098/api/arbishield/prelive-events"
