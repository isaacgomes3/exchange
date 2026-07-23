#!/usr/bin/env bash
# Hotfix: ACL da área Financeiro (só isaac + financeiro@)
#
# icaro@arbishield.com e carlos@arbishield.com (e demais admins) NÃO veem
# o menu Financeiro nem acessam as APIs financeiras.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/desafio-visual-disponivel-6aef/scripts/vps-hotfix-finance-acl.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/desafio-visual-disponivel-6aef}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
CACHE_V="fin-acl-1"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
need python3
mkdir -p "$WEB" "$SCRIPTS_DIR" "$WEB_ROOT"

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

log "finance-admins.js (allowlist)"
fetch "deploy/vps-supabase/static/finance-admins.js" "$WEB_ROOT/finance-admins.js"
chmod 0644 "$WEB_ROOT/finance-admins.js"
grep -q 'financeiro@arbishield.com' "$WEB_ROOT/finance-admins.js" || die "finance-admins sem allowlist"
cp -f "$WEB_ROOT/finance-admins.js" "$WEB/finance-admins.js" 2>/dev/null || true

log "v2.js (canAccessFinance / requireFinanceAdmin)"
fetch "deploy/vps-supabase/static/v2/v2.js" "$WEB/v2.js"
chmod 0644 "$WEB/v2.js"
grep -q 'canAccessFinance' "$WEB/v2.js" || die "v2.js sem canAccessFinance"
grep -q 'requireFinanceAdmin' "$WEB/v2.js" || die "v2.js sem requireFinanceAdmin"
cp -f "$WEB/v2.js" "$WEB_ROOT/v2.js" 2>/dev/null || true

log "v2-shell.js (esconde menu Financeiro)"
fetch "deploy/vps-supabase/static/v2/v2-shell.js" "$WEB/v2-shell.js"
chmod 0644 "$WEB/v2-shell.js"
grep -q 'canAccessFinance' "$WEB/v2-shell.js" || die "shell sem ACL Financeiro"
cp -f "$WEB/v2-shell.js" "$WEB_ROOT/v2-shell.js" 2>/dev/null || true

log "v2-pages.js (gate mountAdmin Financeiro)"
fetch "deploy/vps-supabase/static/v2/v2-pages.js" "$WEB/v2-pages.js"
chmod 0644 "$WEB/v2-pages.js"
grep -q 'requireFinanceAdmin' "$WEB/v2-pages.js" || die "v2-pages sem requireFinanceAdmin"
cp -f "$WEB/v2-pages.js" "$WEB_ROOT/v2-pages.js" 2>/dev/null || true

log "páginas admin Financeiro"
for page in \
  admin-transactions.html \
  admin-saques.html \
  admin-manual-deposits.html \
  admin-depositos-desafio.html \
  admin-refunds.html \
  admin-treasury.html \
  admin-partners-distribution.html \
  admin-expenses.html
do
  fetch "deploy/vps-supabase/static/v2/${page}" "$WEB/${page}"
  chmod 0644 "$WEB/${page}"
  cp -f "$WEB/${page}" "$WEB_ROOT/${page}" 2>/dev/null || true
done
grep -q 'requireFinanceAdmin' "$WEB/admin-depositos-desafio.html" || die "depositos-desafio sem gate"
grep -q 'requireFinanceAdmin' "$WEB/admin-partners-distribution.html" || die "partners-distribution sem gate"

log "cache-bust ${CACHE_V}"
find "$WEB" -maxdepth 1 -name '*.html' -type f -print0 \
  | xargs -0 sed -i -E \
    -e "s|/finance-admins\\.js(\\?[^\"]*)?|/finance-admins.js?v=${CACHE_V}|g" \
    -e "s|/v2\\.js(\\?[^\"]*)?|/v2.js?v=${CACHE_V}|g" \
    -e "s|/v2-pages\\.js(\\?[^\"]*)?|/v2-pages.js?v=${CACHE_V}|g" \
    -e "s|/v2-shell\\.js(\\?[^\"]*)?|/v2-shell.js?v=${CACHE_V}|g" || true
find "$WEB_ROOT" -maxdepth 1 -name 'admin*.html' -type f -print0 2>/dev/null \
  | xargs -0 -r sed -i -E \
    -e "s|/finance-admins\\.js(\\?[^\"]*)?|/finance-admins.js?v=${CACHE_V}|g" \
    -e "s|/v2\\.js(\\?[^\"]*)?|/v2.js?v=${CACHE_V}|g" \
    -e "s|/v2-pages\\.js(\\?[^\"]*)?|/v2-pages.js?v=${CACHE_V}|g" \
    -e "s|/v2-shell\\.js(\\?[^\"]*)?|/v2-shell.js?v=${CACHE_V}|g" || true

# Garante script finance-admins antes de v2.js nas páginas admin
python3 - "$WEB" "$WEB_ROOT" "$CACHE_V" <<'PY'
import sys
from pathlib import Path
cache = sys.argv[3]
needle = f'<script src="/finance-admins.js?v={cache}"></script>'
for root in sys.argv[1:3]:
    base = Path(root)
    if not base.is_dir():
        continue
    for p in list(base.glob("admin*.html")) + list(base.glob("admin.html")):
        t = p.read_text(encoding="utf-8", errors="replace")
        if "finance-admins.js" in t:
            continue
        if 'src="/v2.js' not in t and "src='/v2.js" not in t:
            continue
        t2 = t.replace(
            f'<script src="/v2.js?v={cache}"></script>',
            needle + "\n  " + f'<script src="/v2.js?v={cache}"></script>',
            1,
        )
        if t2 == t:
            t2 = t.replace(
                '<script src="/v2.js"></script>',
                needle + '\n  <script src="/v2.js?v=' + cache + '"></script>',
                1,
            )
        if t2 != t:
            p.write_text(t2, encoding="utf-8")
            print("injected", p)
PY

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
grep -q 'currentUserCanFinance\|requireFinanceAdmin' "$SHIM_PATH" || die "shim sem ACL Financeiro"
grep -q 'FINANCE_ADMIN_EMAILS' "$SHIM_PATH" || die "shim sem FINANCE_ADMIN_EMAILS"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

log "Smoke :3101 desafio-deposits (sem token → negado/unauthorized)"
SMOKE="$(curl -sS http://127.0.0.1:3101/api/arbishield/desafio-deposits || true)"
echo "$SMOKE" | grep -q 'not_found' && die "shim ainda responde not_found"
echo "$SMOKE" | grep -Eqi 'Acesso negado|Financeiro|Unauthorized|token|negado' \
  || log "resposta smoke: $SMOKE"

log "OK — ACL Financeiro ativo"
log "  liberados: isaacgomes3@gmail.com, financeiro@arbishield.com"
log "  bloqueados no menu/API: icaro@ / carlos@ e demais admins"
log "  Ctrl+F5 em /admin.html"
