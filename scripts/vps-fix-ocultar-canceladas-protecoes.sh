#!/usr/bin/env bash
# Minhas Proteções: canceladas NÃO aparecem na lista.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/protecao-fee-upfront-3cf9/scripts/vps-fix-ocultar-canceladas-protecoes.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/protecao-fee-upfront-3cf9}"
# Pin no commit para evitar cache de branch
SHA="${ARBISHIELD_SHA:-28ff8e81bb87d775ec5d7cd41a51b9451033bbf7}"
RAW_SHA="https://raw.githubusercontent.com/isaacgomes3/exchange/${SHA}"
RAW_REF="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
TS="$(date +%s)"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
need python3

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

download_html() {
  local url="$1"
  log "Baixar: $url"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$url" -o "$TMP"; then
    if grep -q 'isVisibleProtection' "$TMP" 2>/dev/null; then
      echo "  OK com isVisibleProtection ($(wc -c < "$TMP") bytes)"
      return 0
    fi
    echo "  AVISO: baixou sem isVisibleProtection ($(wc -c < "$TMP") bytes)"
    head -c 180 "$TMP" | tr '\n' ' '; echo
  else
    echo "  AVISO: curl falhou"
  fi
  return 1
}

if ! download_html "$RAW_SHA/deploy/vps-supabase/static/v2/app-protecoes.html"; then
  if ! download_html "$RAW_REF/deploy/vps-supabase/static/v2/app-protecoes.html"; then
    log "Usando HTML local da VPS como base (patch cirúrgico)"
    BASE=""
    for c in \
      /var/www/arbishield/v2/app-protecoes.html \
      /var/www/arbishield/app-protecoes.html \
      /var/www/arbishield/sandbox/app-protecoes.html
    do
      [[ -f "$c" ]] && BASE="$c" && break
    done
    [[ -n "$BASE" ]] || die "nenhum app-protecoes.html local para patch"
    cp -f "$BASE" "$TMP"
  fi
fi

log "Garantir filtro isVisibleProtection + override DOM"
python3 - "$TMP" "$TS" <<'PY'
from pathlib import Path
import re, sys

path = Path(sys.argv[1])
ts = sys.argv[2]
t = path.read_text(encoding="utf-8", errors="replace")

FILTER_FN = r'''
      function isVisibleProtection(row) {
        var st = String((row && row.status) || "")
          .toLowerCase()
          .trim();
        if (!st) return true;
        if (st.indexOf("cancel") >= 0) return false;
        if (st === "void" || st === "refunded" || st === "estornada") return false;
        return true;
      }
'''

# Injeta/substitui isVisibleProtection
if "function isVisibleProtection" in t:
    t = re.sub(
        r"function isVisibleProtection\s*\(\s*row\s*\)\s*\{[\s\S]*?\n\s*\}",
        FILTER_FN.strip(),
        t,
        count=1,
    )
else:
    # inserir antes de async function load(
    if "async function load(" in t:
        t = t.replace("async function load(", FILTER_FN + "\n      async function load(", 1)
    else:
        raise SystemExit("não achei async function load(")

# Garante .filter(isVisibleProtection) na montagem da lista
if ".filter(isVisibleProtection)" not in t:
    # após concat LAY/BACK, antes do sort
    t2, n = re.subn(
        r"(\.concat\(\s*\(back\.data[\s\S]*?\}\)\s*\))\s*\.sort\(",
        r"\1\n          .filter(isVisibleProtection)\n          .sort(",
        t,
        count=1,
    )
    if n:
        t = t2
    else:
        # fallback: items = [...].sort → items = [...].filter(...).sort
        t2, n = re.subn(
            r"(items\s*=\s*\[[\s\S]*?\])\s*\.sort\(",
            r"\1.filter(isVisibleProtection).sort(",
            t,
            count=1,
        )
        if not n:
            # último recurso: depois de montar items, filtrar
            t = t.replace(
                "renderList();",
                "items = (items || []).filter(isVisibleProtection);\n        renderList();",
                1,
            )
        else:
            t = t2

OVERRIDE = f'''
<script id="arbishield-hide-cancelled-protections">
(function(){{
  function hide(){{
    try{{
      document.querySelectorAll(".prot-list .term-row, #list .term-row").forEach(function(row){{
        var badge = row.querySelector(".prot-badge, .term-col-status");
        var txt = ((badge && badge.textContent) || row.textContent || "").toLowerCase();
        if (txt.indexOf("cancelad") >= 0) {{
          row.style.display = "none";
          row.setAttribute("data-hidden-cancelled", "1");
        }}
      }});
    }}catch(e){{}}
  }}
  var obs = new MutationObserver(hide);
  function boot(){{
    var list = document.getElementById("list");
    if (list) obs.observe(list, {{ childList:true, subtree:true }});
    hide();
    setInterval(hide, 600);
  }}
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
}})();
</script>
'''

t = re.sub(
    r'<script id="arbishield-hide-cancelled-protections">[\s\S]*?</script>\s*',
    "",
    t,
)
if "</body>" in t:
    t = t.replace("</body>", OVERRIDE + "\n</body>", 1)
else:
    t += "\n" + OVERRIDE

t = re.sub(r"(\?v=)[^\"']+", rf"\1hide-cancel-{ts}", t, count=8)
path.write_text(t, encoding="utf-8")

out = path.read_text(encoding="utf-8")
assert "isVisibleProtection" in out, "falhou isVisibleProtection"
assert "arbishield-hide-cancelled-protections" in out, "falhou override"
assert ".filter(isVisibleProtection)" in out or "filter(isVisibleProtection)" in out, "falhou filter call"
print("  patch OK")
PY

mapfile -t DEST < <(find /var/www/arbishield /var/www/arbishield-teste \
  -type f -name 'app-protecoes.html' 2>/dev/null | sort -u)
if [[ ${#DEST[@]} -eq 0 ]]; then
  DEST=(/var/www/arbishield/v2/app-protecoes.html)
  mkdir -p /var/www/arbishield/v2
fi

for f in "${DEST[@]}"; do
  mkdir -p "$(dirname "$f")"
  cp -f "$TMP" "$f"
  if [[ "$f" == *"/sandbox/"* ]]; then
    python3 - "$f" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
t = p.read_text(encoding="utf-8", errors="replace")
t = t.replace('"/api/arbishield/', '"/__sandbox_api/arbishield/')
t = t.replace("'/api/arbishield/", "'/__sandbox_api/arbishield/")
p.write_text(t, encoding="utf-8")
PY
  fi
  grep -q 'isVisibleProtection' "$f" || die "$f sem isVisibleProtection"
  grep -q 'arbishield-hide-cancelled-protections' "$f" || die "$f sem override"
  echo "  OK $f ($(wc -c < "$f") bytes)"
done

command -v nginx >/dev/null && nginx -s reload 2>/dev/null || true
sleep 1

PUB=$(curl -fsS "https://127.0.0.1/app-protecoes.html?v=$TS" -k 2>/dev/null | grep -c 'isVisibleProtection' || true)
PUB2=$(curl -fsS "https://arbishield.app/app-protecoes.html?v=$TS" | grep -c 'isVisibleProtection' || true)
PUBO=$(curl -fsS "https://arbishield.app/app-protecoes.html?v=$TS" | grep -c 'arbishield-hide-cancelled-protections' || true)
echo "local-ish=$PUB  publico isVisibleProtection=$PUB2 override=$PUBO"

# Se o domínio ainda antigo, pelo menos o arquivo no disco está certo
for f in "${DEST[@]}"; do
  grep -q 'isVisibleProtection' "$f"
done

echo
echo "OK — canceladas ocultas (arquivo no disco validado)"
echo "  https://arbishield.app/app-protecoes.html?v=$TS"
echo "  Abra em JANELA ANÔNIMA (Ctrl+Shift+N)"
if [[ "${PUB2:-0}" -lt 1 ]]; then
  echo "AVISO: domínio ainda sem marker — limpe cache/CDN ou confira nginx root:"
  grep -R "root /var/www/arbishield" /etc/nginx 2>/dev/null | head -15 || true
  ls -la /var/www/arbishield/v2/app-protecoes.html /var/www/arbishield/app-protecoes.html 2>/dev/null || true
fi
