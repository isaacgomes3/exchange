#!/usr/bin/env bash
# Hotfix: admin Depósitos Desafio (Financeiro)
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-visual-disponivel-6aef/scripts/vps-hotfix-depositos-desafio.sh?v=3")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/desafio-visual-disponivel-6aef}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$SCRIPTS_DIR"

log "resolvendo tip de $BRANCH"
SHA="$(
  curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/commits/${BRANCH}" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["sha"])'
)"
log "tip=$SHA"
RAW_JS="https://cdn.jsdelivr.net/gh/isaacgomes3/exchange@${SHA}"
RAW_GH="https://raw.githubusercontent.com/isaacgomes3/exchange/${SHA}"

fetch() {
  local rel="$1" dest="$2"
  if curl -fsSL "${RAW_JS}/${rel}" -o "$dest"; then return 0; fi
  curl -fsSL "${RAW_GH}/${rel}?t=$(date +%s)" -o "$dest"
}

log "admin-depositos-desafio.html"
fetch "deploy/vps-supabase/static/v2/admin-depositos-desafio.html" "$WEB/admin-depositos-desafio.html"
chmod 0644 "$WEB/admin-depositos-desafio.html"
grep -q 'desafio-deposits' "$WEB/admin-depositos-desafio.html" || die "HTML sem API desafio-deposits"
grep -q 'Pendentes de ativação' "$WEB/admin-depositos-desafio.html" || die "HTML sem KPI pendentes"

log "v2-shell.js (menu Financeiro + acordeão com CSS injetado)"
fetch "deploy/vps-supabase/static/v2/v2-shell.js" "$WEB/v2-shell.js"
chmod 0644 "$WEB/v2-shell.js"
grep -q 'depositos-desafio' "$WEB/v2-shell.js" || die "shell sem Depósitos Desafio"
grep -q 'v2-nav-group' "$WEB/v2-shell.js" || die "shell sem seções recolhíveis"
grep -q 'ensureNavAccordionCss\|data-v2-nav-acc' "$WEB/v2-shell.js" || die "shell sem CSS crítico do acordeão"
cp -f "$WEB/v2-shell.js" "$WEB_ROOT/v2-shell.js" 2>/dev/null || true

log "v2.css (acordeão do menu)"
fetch "deploy/vps-supabase/static/v2/v2.css" "$WEB/v2.css"
chmod 0644 "$WEB/v2.css"
grep -q 'v2-nav-group.is-open' "$WEB/v2.css" || die "CSS sem acordeão do menu"
grep -q 'appearance: none' "$WEB/v2.css" || die "CSS sem reset de botão do menu"
cp -f "$WEB/v2.css" "$WEB_ROOT/v2.css" 2>/dev/null || true

log "em-breve.html"
fetch "deploy/vps-supabase/static/v2/em-breve.html" "$WEB/em-breve.html" || true
chmod 0644 "$WEB/em-breve.html" 2>/dev/null || true

# Reaplica cache-bust após todos os HTML
log "cache-bust final v2-shell.js / v2.css"
find "$WEB" -maxdepth 1 -name '*.html' -type f -print0 \
  | xargs -0 sed -i -E 's|/v2-shell\.js(\?[^"]*)?|/v2-shell.js?v=nav-acc-2|g' || true
find "$WEB" -maxdepth 1 -name 'admin*.html' -type f -print0 \
  | xargs -0 sed -i -E 's|/v2\.css(\?[^"]*)?|/v2.css?v=nav-acc-2|g' || true
find "$WEB_ROOT" -maxdepth 1 -name '*.html' -type f -print0 2>/dev/null \
  | xargs -0 -r sed -i -E 's|/v2-shell\.js(\?[^"]*)?|/v2-shell.js?v=nav-acc-2|g' || true

# Shim
EXEC_LINE="$(systemctl show -p ExecStart --value arbishield-serverfn-shim.service 2>/dev/null || true)"
SHIM_PATH=""
if [[ "$EXEC_LINE" == *arbishield-serverfn-shim.mjs* ]]; then
  SHIM_PATH="$(echo "$EXEC_LINE" | grep -oE '/[^ ]+arbishield-serverfn-shim\.mjs' | head -1 || true)"
fi
if [[ -z "${SHIM_PATH:-}" ]]; then
  for c in "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" /opt/arbishield/arbishield-serverfn-shim.mjs /opt/arbishield/scripts/arbishield-serverfn-shim.mjs; do
    [[ -f "$c" ]] && SHIM_PATH="$c" && break
  done
fi
[[ -n "${SHIM_PATH:-}" ]] || SHIM_PATH="$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
mkdir -p "$(dirname "$SHIM_PATH")"
log "Atualizando shim em $SHIM_PATH"
fetch "scripts/arbishield-serverfn-shim.mjs" "$SHIM_PATH"
chmod 0644 "$SHIM_PATH"
grep -q 'listDesafioDeposits' "$SHIM_PATH" || die "shim sem listDesafioDeposits"
grep -q 'desafio-deposit-approve' "$SHIM_PATH" || die "shim sem desafio-deposit-approve"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

# Nginx snippet (best-effort)
NGX="${ARBISHIELD_NGINX:-/etc/nginx/sites-enabled/arbishield.app.conf}"
if [[ -f "$NGX" ]] && ! grep -q 'desafio-deposits' "$NGX"; then
  log "Inserindo rotas nginx desafio-deposits (se possível)"
  # tenta ampliar o regex existente
  if grep -q 'desafio-pending-counts' "$NGX"; then
    sed -i 's/desafio-pending-counts|/desafio-pending-counts|desafio-deposits|desafio-deposit-approve|desafio-deposit-reject|/' "$NGX" || true
  fi
  if ! grep -q 'depositos-desafio' "$NGX"; then
    sed -i 's|location = /admin/manual-deposits { return 302 /admin-manual-deposits.html; }|location = /admin/manual-deposits { return 302 /admin-manual-deposits.html; }\n    location = /admin/depositos-desafio { return 302 /admin-depositos-desafio.html; }|' "$NGX" || true
  fi
  nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || log "aviso: reload nginx manual pode ser necessário"
fi

log "Smoke :3101 desafio-deposits"
SMOKE="$(curl -sS http://127.0.0.1:3101/api/arbishield/desafio-deposits || true)"
echo "$SMOKE" | grep -q 'not_found' && die "shim ainda responde not_found"
echo "$SMOKE" | grep -Eqi 'Acesso negado|negado|items|Unauthorized|token' || log "resposta smoke: $SMOKE"

log "OK — abra /admin-depositos-desafio.html (Ctrl+F5)"
