#!/usr/bin/env bash
# Produção v11: fee_upfront + Reembolso Elegível + envio/aprovação de comprovante.
#
# Na VPS (root):
#   curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-reembolso-lucas-perdeu-723d/scripts/vps-hotfix-fee-upfront-v11.sh?$(date +%s)" -o /tmp/hf-v11.sh
#   bash /tmp/hf-v11.sh
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-reembolso-lucas-perdeu-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
WEB_ROOT="${ARBISHIELD_WEB_ROOT:-/var/www/arbishield}"
WEB="${ARBISHIELD_WEB:-$WEB_ROOT/v2}"
APP_DIR="${ARBISHIELD_APP_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS_DIR:-$APP_DIR/scripts}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }

need curl
need node
need python3
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
mkdir -p "$WEB" "$APP_DIR" "$SCRIPTS_DIR/lib" "$APP_DIR/lib"

download_repo_file() {
  local rel="$1" out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" \
    -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix-v11" \
    "$API/$rel?ref=${REF}&t=$(date +%s%N)" -o "$out" && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" \
    "$RAW/$rel?v=$BUST&t=$(date +%s%N)" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

install_repo_file() {
  local rel="$1" dest="$2" marker="$3"
  local tmp
  tmp="$(mktemp)"
  download_repo_file "$rel" "$tmp"
  grep -q "$marker" "$tmp" || die "$rel sem marker esperado: $marker"
  mkdir -p "$(dirname "$dest")"
  cp -f "$tmp" "$dest"
  chmod 0644 "$dest"
  rm -f "$tmp"
  log "  OK $dest"
}

log "1/6 contrato v11"
install_repo_file \
  "scripts/lib/protection-flow-contract.mjs" \
  "$SCRIPTS_DIR/lib/protection-flow-contract.mjs" \
  "protection-flow-contract-v11"
cp -f "$SCRIPTS_DIR/lib/protection-flow-contract.mjs" "$APP_DIR/lib/protection-flow-contract.mjs"
mkdir -p "$APP_DIR/scripts/lib"
cp -f "$SCRIPTS_DIR/lib/protection-flow-contract.mjs" "$APP_DIR/scripts/lib/protection-flow-contract.mjs"

log "2/6 worker prelive v11"
install_repo_file \
  "scripts/arbishield-prelive-events.mjs" \
  "$SCRIPTS_DIR/arbishield-prelive-events.mjs" \
  "fee_upfront_v1"
cp -f "$SCRIPTS_DIR/arbishield-prelive-events.mjs" "$APP_DIR/arbishield-prelive-events.mjs" 2>/dev/null || true

log "3/6 shim com refund-proof"
install_repo_file \
  "scripts/arbishield-serverfn-shim.mjs" \
  "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" \
  "refund-proof/approve"
cp -f "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" "$APP_DIR/arbishield-serverfn-shim.mjs"

log "4/6 páginas v2"
declare -a WEB_FILES=(
  "app-proteger.html:fee_upfront_v1"
  "app-protecoes.html:Reembolso Elegível"
  "app-comprovantes.html:refund-proof/submit"
  "v2-shell.js:app-comprovantes.html"
  "admin-jogos.html:fee_upfront v11"
  "admin-refunds.html:admin-refunds.js"
  "admin-refunds.js:refund-proof/approve"
)
for spec in "${WEB_FILES[@]}"; do
  file="${spec%%:*}"
  marker="${spec#*:}"
  install_repo_file "deploy/vps-supabase/static/v2/$file" "$WEB/$file" "$marker"
  cp -f "$WEB/$file" "$WEB_ROOT/$file" 2>/dev/null || true
done

log "5/6 nginx — permitir API e rota amigável"
changed=0
declare -a NGINX_CANDIDATES=(
  "/etc/nginx/sites-available/arbishield.app"
  "/etc/nginx/sites-enabled/arbishield.app"
  "/etc/nginx/conf.d/arbishield.app.conf"
  "/etc/nginx/sites-available/teste.arbishield.app"
  "/etc/nginx/sites-enabled/teste.arbishield.app"
  "/etc/nginx/conf.d/teste.arbishield.app.conf"
)
for conf in "${NGINX_CANDIDATES[@]}"; do
  [[ -f "$conf" ]] || continue
  result="$(python3 - "$conf" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
before = text

if "refund-proof/submit" not in text:
    lines = text.splitlines(keepends=True)
    for idx, line in enumerate(lines):
        if "location ~ ^/api/arbishield/(" in line and "contestations" in line and ")$" in line:
            lines[idx] = line.replace(")$", "|refund-proof/submit|refund-proof/approve)$", 1)
            break
    text = "".join(lines)

route = "    location = /app/comprovantes { return 302 /app-comprovantes.html; }\n"
if "location = /app/comprovantes" not in text:
    anchor = "    location = /app/protecoes { return 302 /app-protecoes.html; }\n"
    if anchor in text:
        text = text.replace(anchor, anchor + route, 1)

if text != before:
    path.write_text(text, encoding="utf-8")
    print("changed")
else:
    print("unchanged")
PY
)"
  if [[ "$result" == "changed" ]]; then
    log "  atualizado $conf"
    changed=1
  fi
done

if [[ "$changed" -eq 1 ]] && command -v nginx >/dev/null 2>&1; then
  nginx -t || die "nginx -t falhou; revise as alterações antes de recarregar"
  systemctl reload nginx 2>/dev/null || nginx -s reload
else
  cat <<'EOF'
  Se o nginx ativo não estava nos caminhos conhecidos, adicione ANTES de location ^~ /app/:
    location = /app/comprovantes { return 302 /app-comprovantes.html; }
  E inclua no allowlist do shim:
    refund-proof/submit|refund-proof/approve
  Ambos devem usar o mesmo proxy_pass do arbishield-serverfn-shim (:3101 prod / :3201 teste).
EOF
fi

log "6/6 reiniciar e verificar serviços"
restarted=0
for unit in \
  arbishield-prelive-events.service \
  arbishield-prelive.service \
  arbishield-serverfn-shim.service \
  arbishield-shim.service
do
  if systemctl cat "$unit" >/dev/null 2>&1; then
    systemctl restart "$unit"
    log "  restarted $unit"
    restarted=1
  fi
done
[[ "$restarted" -eq 1 ]] || echo "AVISO: nenhum unit conhecido foi encontrado; reinicie prelive e serverfn-shim manualmente." >&2

node --check "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
grep -q "refund-proof/submit" "$WEB/app-comprovantes.html"
grep -q "refund-proof/approve" "$WEB/admin-refunds.js"

echo
echo "Hotfix fee_upfront v11 + comprovantes aplicado."
echo "  1) Abra /app/comprovantes (Ctrl+Shift+R)."
echo "  2) Envie um print em uma proteção Reembolso Elegível."
echo "  3) Em /admin/refunds, aprove e confirme o crédito no Saldo Reembolso."
echo "  4) Health do shim: curl -fsS http://127.0.0.1:3101/health"
