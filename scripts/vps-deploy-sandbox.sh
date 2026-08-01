#!/usr/bin/env bash
# Publica UI no sandbox: https://arbishield.app/sandbox/
# Não mexe nas páginas de produção (raiz /).
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/ambiente-teste-3cf9}"
REF="${ARBISHIELD_REF:-main}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB="${ARBISHIELD_SANDBOX_WEB:-/var/www/arbishield/sandbox}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
need python3
mkdir -p "$WEB" "$WEB/brand"

# Trava: nunca publicar sandbox na raiz da produção
if [[ "$WEB" == "/var/www/arbishield/v2" || "$WEB" == "/var/www/arbishield" ]]; then
  die "path sandbox inválido: $WEB"
fi

log "Sandbox ref=$REF → $WEB"

for f in v2.css v2.js v2-shell.js v2-pages.js v2-deposit.js v2-financeiro.js v2-provedor.js v2-afiliados.js market-catalog.js finance-admins.js; do
  if curl -fsSL --retry 3 "$RAW/deploy/vps-supabase/static/v2/$f" -o "$WEB/$f" 2>/dev/null; then
    echo "  ok $f"
  else
    echo "  skip $f"
  fi
done

for f in logo.png logo@2x.png favicon-192.png icon-64.png; do
  curl -fsSL --retry 2 "$RAW/deploy/vps-supabase/static/v2/brand/$f" -o "$WEB/brand/$f" 2>/dev/null && echo "  ok brand/$f" || true
done

while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  curl -fsSL --retry 3 "$RAW/deploy/vps-supabase/static/v2/$f" -o "$WEB/$f" 2>/dev/null && echo "  ok $f" || echo "  skip $f"
done <<'EOF'
index.html
auth.html
admin.html
admin-jogos.html
admin-desafios.html
admin-users.html
admin-transactions.html
admin-saques.html
admin-treasury.html
admin-contestations.html
admin-manual-deposits.html
admin-refunds.html
admin-partners.html
admin-affiliates.html
admin-settings.html
app.html
app-proteger.html
app-protecoes.html
app-desafio.html
app-carteira.html
EOF

log "Reescrever links / → /sandbox/ nos HTML (assets do sandbox)"
python3 - "$WEB" <<'PY'
import pathlib, re, sys
root = pathlib.Path(sys.argv[1])
# Não prefixar APIs / auth backend / assets globais / urls absolutas
skip = re.compile(
    r'^(?:sandbox/|api/|auth/|rest/|storage/|functions/|graphql/|realtime/|_serverFn/|assets/|https?:|//)'
)
attr = re.compile(r'''((?:href|src)\s*=\s*["'])/(?!/)([^"']*)(["'])''')

def repl(m):
    prefix, path, suf = m.group(1), m.group(2), m.group(3)
    if skip.match(path):
        return m.group(0)
    return f"{prefix}/sandbox/{path}{suf}"

for html in root.glob("*.html"):
    text = html.read_text(encoding="utf-8", errors="replace")
    new = attr.sub(repl, text)
    # marca ambiente
    if "arbishield-sandbox-banner" not in new:
        banner = '''<div id="arbishield-sandbox-banner" style="position:sticky;top:0;z-index:99999;background:#7c2d12;color:#ffedd5;text-align:center;padding:8px 12px;font:700 12px/1.4 sans-serif">SANDBOX — https://arbishield.app/sandbox/ · produção continua em /</div>\n'''
        if "<body" in new:
            new = re.sub(r"(<body[^>]*>)", r"\1\n" + banner, new, count=1, flags=re.I)
        else:
            new = banner + new
    html.write_text(new, encoding="utf-8")
    print("  rewrite", html.name)
PY

# Garante detecção /sandbox/ no v2.js
if [[ -f "$WEB/v2.js" ]] && ! grep -q '/sandbox/' "$WEB/v2.js"; then
  # patch leve: se pathname começa com /sandbox
  python3 - "$WEB/v2.js" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
t = p.read_text(encoding="utf-8")
old = """function isTesteEnv() {
    var loc = global.location || {};
    var h = String(loc.hostname || "").toLowerCase();
    var p = String(loc.port || "");
    if (p === "8090" || p === "8091") return true;
    if (h === "teste.arbishield.app" || h.indexOf("teste.") === 0) return true;
    return false;
  }"""
new = """function isTesteEnv() {
    var loc = global.location || {};
    var h = String(loc.hostname || "").toLowerCase();
    var p = String(loc.port || "");
    var path = String(loc.pathname || "");
    if (path.indexOf("/sandbox/") === 0) return true;
    if (p === "8090" || p === "8091") return true;
    if (h === "teste.arbishield.app" || h.indexOf("teste.") === 0) return true;
    return false;
  }"""
if old in t:
    p.write_text(t.replace(old, new, 1), encoding="utf-8")
    print("  patched isTesteEnv")
elif "sandbox/" not in t:
    # fallback append
    p.write_text(t + "\n/* sandbox path */\n", encoding="utf-8")
PY
fi

cat > "$WEB/SANDBOX_BUILD.json" <<EOF
{
  "env": "sandbox",
  "ref": "$REF",
  "url": "https://arbishield.app/sandbox/admin-jogos.html",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
chmod -R a+rX "$WEB"

echo
echo "OK — sandbox atualizado"
echo "  https://arbishield.app/sandbox/admin-jogos.html  (Ctrl+F5)"
echo "  Produção (/) NÃO foi alterada"
