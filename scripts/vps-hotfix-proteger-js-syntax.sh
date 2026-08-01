#!/usr/bin/env bash
# Hotfix: app-proteger.html quebrado — "Unexpected token 'function'"
# Sintoma: grade presa em "Sem partidas disponíveis / Carregando…"
# Causa: patch antigo deixou lixo "; }" entre filtered() e updatePreview()
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-proteger-js-e85c/scripts/vps-hotfix-proteger-js-syntax.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"

echo "==> vps-hotfix-proteger-js-syntax.sh ($(date -Is))"

TMP="$(mktemp)"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/static/v2/app-proteger.html" -o "$TMP"

python3 - "$TMP" <<'PY'
import re, sys
from pathlib import Path
tmp = Path(sys.argv[1])
text = tmp.read_text(encoding="utf-8", errors="replace")
if "function updatePreview" not in text or "function filtered" not in text:
    raise SystemExit("ERRO: HTML baixado incompleto")
if re.search(r"\}\s*;\s*\}\s*function updatePreview", text):
    raise SystemExit("ERRO: raw do GitHub ainda corrompido")
print("  raw OK", tmp.stat().st_size, "bytes")
PY

patched=0
while IFS= read -r -d '' f; do
  cp -a "$f" "${f}.bak-js-syntax-$(date +%s)" 2>/dev/null || true
  cp -f "$TMP" "$f"
  chmod 0644 "$f"
  echo "  OK $f"
  patched=$((patched + 1))
done < <(find /var/www -type f -name 'app-proteger.html' -print0 2>/dev/null)

for f in \
  "$WEB_ROOT/app-proteger.html" \
  "$WEB_ROOT/v2/app-proteger.html" \
  "$WEB_ROOT/sandbox/app-proteger.html"
do
  mkdir -p "$(dirname "$f")" 2>/dev/null || true
  if [[ -d "$(dirname "$f")" ]]; then
    cp -f "$TMP" "$f"
    chmod 0644 "$f"
    echo "  OK $f"
    patched=$((patched + 1))
  fi
done

# Cinto de segurança: se algum arquivo ainda tiver o lixo, remove in-place
python3 - <<'PY'
from pathlib import Path
import re
pat = re.compile(r"\}\s*;\s*\}\s*function updatePreview")
n = 0
for p in Path("/var/www").rglob("app-proteger.html"):
    t = p.read_text(encoding="utf-8", errors="replace")
    if not pat.search(t):
        continue
    p.write_text(pat.sub("}\n\n      function updatePreview", t, count=1), encoding="utf-8")
    print("  patched-orphan", p)
    n += 1
print("  orphan-fixes", n)
PY

rm -f "$TMP"

python3 - <<'PY'
from pathlib import Path
import re, subprocess, tempfile, sys
cands = list(Path("/var/www").rglob("app-proteger.html"))
if not cands:
    raise SystemExit("ERRO: nenhum app-proteger.html em /var/www")
html = Path("/var/www/arbishield/app-proteger.html")
if not html.exists():
    html = cands[0]
text = html.read_text(encoding="utf-8", errors="replace")
if re.search(r"\}\s*;\s*\}\s*function updatePreview", text):
    raise SystemExit(f"ERRO: ainda corrompido: {html}")
scripts = re.findall(r"<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)</script>", text)
main = max(scripts, key=len)
with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
    f.write(main)
    path = f.name
r = subprocess.run(["node", "--check", path], capture_output=True, text=True)
Path(path).unlink(missing_ok=True)
if r.returncode != 0:
    print(r.stderr[:500])
    raise SystemExit("ERRO sintaxe JS")
print("OK sintaxe", html)
print("arquivos:", len(cands))
PY

echo
echo "Pronto. Abra https://arbishield.app/app-proteger.html → Ctrl+Shift+R"
echo "Deve listar ArbiShield Teste A vs B."
