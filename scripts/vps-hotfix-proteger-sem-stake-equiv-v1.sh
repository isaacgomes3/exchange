#!/usr/bin/env bash
# Hotfix VPS AGRESSIVO: remove "Stake equivalente (casa)" e "Odd LAY → back equiv."
# de TODAS as cópias de app-proteger.html (+ override JS).
# Marker: proteger-sem-stake-equiv-v1
#
# Na VPS (root):
#   curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-reembolso-lucas-perdeu-723d/scripts/vps-hotfix-proteger-sem-stake-equiv-v1.sh?$(date +%s)" -o /tmp/hf-sem-stake.sh
#   bash /tmp/hf-sem-stake.sh
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/fix-reembolso-lucas-perdeu-723d}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
MARKER="proteger-sem-stake-equiv-v1"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 nao encontrado"; }
need curl
need python3
need find
[[ "$(id -u)" -eq 0 ]] || die "rode como root"

download_repo_file() {
  local rel="$1" out="$2"
  if curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" \
    -H "User-Agent: arbishield-hotfix" \
    "$API/$rel?ref=${REF}&t=$(date +%s%N)" -o "$out" && [[ -s "$out" ]]; then
    return 0
  fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    -H "Cache-Control: no-cache" "$RAW/$rel?v=$BUST&t=$(date +%s%N)" -o "$out"
  [[ -s "$out" ]] || die "download vazio: $rel"
}

log "0) baixar fontes canônicas do GitHub"
TMP_HTML="$(mktemp)"
TMP_JS="$(mktemp)"
download_repo_file "deploy/vps-supabase/static/v2/app-proteger.html" "$TMP_HTML"
download_repo_file "deploy/vps-supabase/static/v2/proteger-preview-fix.js" "$TMP_JS"
grep -q "$MARKER" "$TMP_HTML" || die "HTML sem marker $MARKER"
grep -q "$MARKER" "$TMP_JS" || die "JS sem marker $MARKER"
grep -q "Stake equivalente (casa)" "$TMP_HTML" && die "HTML canônico ainda tem Stake equivalente"
grep -q "Odd LAY → back equiv." "$TMP_HTML" && die "HTML canônico ainda tem Odd LAY"
grep -q "Stake equivalente (casa)" "$TMP_JS" && die "JS canônico ainda tem Stake equivalente"

log "1) localizar TODAS as cópias app-proteger.html"
mapfile -t FILES < <(find /var/www/arbishield /var/www/arbishield-teste /opt/arbishield /opt/arbishield-teste \
  /opt/arbishield/deploy/vps-supabase/static \
  -type f \( -name 'app-proteger.html' -o -name 'proteger-preview-fix.js' \) 2>/dev/null | sort -u)
# fallback paths usados pelos hotfixes antigos
for extra in \
  /opt/arbishield/deploy/vps-supabase/static/v2/app-proteger.html \
  /opt/arbishield/deploy/vps-supabase/static/v2/proteger-preview-fix.js \
  /var/www/arbishield/v2/app-proteger.html \
  /var/www/arbishield/app-proteger.html \
  /var/www/arbishield/v2/proteger-preview-fix.js
do
  [[ -f "$extra" ]] && FILES+=("$extra")
done
# unique
mapfile -t FILES < <(printf '%s\n' "${FILES[@]}" | awk 'NF' | sort -u)
[[ ${#FILES[@]} -gt 0 ]] || die "nenhum app-proteger.html / preview-fix encontrado"

for f in "${FILES[@]}"; do
  echo "  · $f"
done

log "2) instalar canônico + strip de linhas banidas (python)"
python3 - "$TMP_HTML" "$TMP_JS" "$MARKER" "$BUST" "${FILES[@]}" <<'PY'
import re, sys
from pathlib import Path

src_html = Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace")
src_js = Path(sys.argv[2]).read_text(encoding="utf-8", errors="replace")
marker = sys.argv[3]
bust = sys.argv[4]
files = sys.argv[5:]

INLINE = f'''
<script id="arbishield-hide-stake-equiv" data-mark="{marker}">
(function(){{
  var RE=/stake\\s*equivalente|odd\\s*lay\\s*[→\\->]+\\s*back|back\\s*equiv/i;
  function strip(){{
    var p=document.getElementById("preview"); if(!p) return;
    Array.prototype.slice.call(p.children||[]).forEach(function(el){{
      var s=el.querySelector&&el.querySelector("span");
      var t=((s&&s.textContent)||el.textContent||"").trim();
      if(RE.test(t)&&el.parentNode) el.parentNode.removeChild(el);
    }});
  }}
  function sched(){{ setTimeout(strip,0); setTimeout(strip,50); setTimeout(strip,150); setTimeout(strip,400); }}
  var obs=new MutationObserver(sched);
  function boot(){{
    var p=document.getElementById("preview");
    if(p) obs.observe(p,{{childList:true,subtree:true,characterData:true}});
    sched();
  }}
  document.addEventListener("input",sched,true);
  document.addEventListener("change",sched,true);
  document.addEventListener("click",sched,true);
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot); else boot();
}})();
</script>
'''

SCRIPT_TAG = f'<script src="/proteger-preview-fix.js?v={marker}-{bust}"></script>'

def strip_banned_js_strings(t: str) -> str:
    # Remove blocos que montam as duas linhas no HTML gerado
    t = re.sub(
        r'\s*"<div><span>Stake equivalente \(casa\)</span><b>"\s*\+\s*[\s\S]*?</b></div>"\s*\+\s*',
        "\n",
        t,
        count=4,
    )
    t = re.sub(
        r'\s*"<div><span>Odd LAY → back equiv\.</span><b>"\s*\+\s*[\s\S]*?</b></div>"\s*;?',
        "\n",
        t,
        count=4,
    )
    t = re.sub(
        r'\s*"<div><span>Odd LAY → back equiv\.</span><b>"\s*\+\s*[\s\S]*?</b></div>"\s*\+\s*',
        "\n",
        t,
        count=4,
    )
    # oddLine = ... Odd LAY ...
    t = re.sub(
        r'var\s+oddLine\s*=\s*mt\s*===\s*"LAY"\s*\?[\s\S]*?:\s*""\s*;',
        'var oddLine = "";',
        t,
        count=4,
    )
    return t

def ensure_inline(t: str) -> str:
    t = re.sub(
        r'<script id="arbishield-hide-stake-equiv"[^>]*>[\s\S]*?</script>\s*',
        "",
        t,
        count=2,
    )
    t = re.sub(
        r'<script id="arbishield-preview-fix-inline">[\s\S]*?</script>\s*',
        "",
        t,
        count=2,
    )
    # remove script tags antigas do preview-fix e reinsere a nova
    t = re.sub(
        r'<script[^>]*proteger-preview-fix\.js[^>]*>\s*</script>\s*',
        "",
        t,
        count=4,
    )
    if "</body>" in t:
        t = t.replace("</body>", SCRIPT_TAG + "\n" + INLINE + "\n</body>", 1)
    else:
        t += "\n" + SCRIPT_TAG + "\n" + INLINE
    return t

for fp in files:
    path = Path(fp)
    name = path.name
    if name == "proteger-preview-fix.js":
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(src_js, encoding="utf-8")
        print(f"OK JS {fp}")
        continue

    # app-proteger.html: prefer canônico; se path diferente, ainda escreve canônico + strip
    t = src_html
    t = strip_banned_js_strings(t)
    t = ensure_inline(t)
    t = re.sub(
        r'(<meta name="arbishield-build" content=")[^"]+(")',
        rf'\1{marker}\2',
        t,
        count=1,
    )
    t = re.sub(r'(\?v=)[^"\']+', rf'\1{marker}-{bust}', t, count=12)
    if "Stake equivalente (casa)" in t:
        raise SystemExit(f"{fp}: ainda tem Stake equivalente após patch")
    if "Odd LAY → back equiv." in t and "HIDE_RE" not in t and "arbishield-hide-stake-equiv" not in t:
        # string só pode restar no stripper regex? nosso INLINE não inclui o label literal
        raise SystemExit(f"{fp}: ainda tem Odd LAY após patch")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(t, encoding="utf-8")
    print(f"OK HTML {fp}")
PY

# também copia para STATIC padrão do hotfix antigo
STATIC="${ARBISHIELD_STATIC:-/opt/arbishield/deploy/vps-supabase/static/v2}"
mkdir -p "$STATIC"
cp -f "$TMP_HTML" "$STATIC/app-proteger.html"
cp -f "$TMP_JS" "$STATIC/proteger-preview-fix.js"
# re-aplica ensure via python no STATIC (já feito se estava na lista; força)
python3 - "$TMP_HTML" "$TMP_JS" "$MARKER" "$BUST" \
  "$STATIC/app-proteger.html" "$STATIC/proteger-preview-fix.js" <<'PY'
import re, sys
from pathlib import Path
src_html = Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace")
src_js = Path(sys.argv[2]).read_text(encoding="utf-8", errors="replace")
marker = sys.argv[3]
bust = sys.argv[4]
Path(sys.argv[6]).write_text(src_js, encoding="utf-8")
INLINE = f'''
<script id="arbishield-hide-stake-equiv" data-mark="{marker}">
(function(){{
  var RE=/stake\\s*equivalente|odd\\s*lay\\s*[→\\->]+\\s*back|back\\s*equiv/i;
  function strip(){{
    var p=document.getElementById("preview"); if(!p) return;
    Array.prototype.slice.call(p.children||[]).forEach(function(el){{
      var s=el.querySelector&&el.querySelector("span");
      var t=((s&&s.textContent)||el.textContent||"").trim();
      if(RE.test(t)&&el.parentNode) el.parentNode.removeChild(el);
    }});
  }}
  function sched(){{ setTimeout(strip,0); setTimeout(strip,50); setTimeout(strip,150); setTimeout(strip,400); }}
  var obs=new MutationObserver(sched);
  function boot(){{
    var p=document.getElementById("preview");
    if(p) obs.observe(p,{{childList:true,subtree:true,characterData:true}});
    sched();
  }}
  document.addEventListener("input",sched,true);
  document.addEventListener("change",sched,true);
  document.addEventListener("click",sched,true);
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot); else boot();
}})();
</script>
'''
SCRIPT_TAG = f'<script src="/proteger-preview-fix.js?v={marker}-{bust}"></script>'
t = src_html
t = re.sub(r'<script id="arbishield-hide-stake-equiv"[^>]*>[\s\S]*?</script>\s*', '', t, count=2)
t = re.sub(r'<script[^>]*proteger-preview-fix\.js[^>]*>\s*</script>\s*', '', t, count=4)
if '</body>' in t:
    t = t.replace('</body>', SCRIPT_TAG + '\n' + INLINE + '\n</body>', 1)
t = re.sub(r'(<meta name="arbishield-build" content=")[^"]+(")', rf'\1{marker}\2', t, count=1)
Path(sys.argv[5]).write_text(t, encoding='utf-8')
print('OK FORCE', sys.argv[5])
PY

chmod 0644 "$STATIC/app-proteger.html" "$STATIC/proteger-preview-fix.js"
rm -f "$TMP_HTML" "$TMP_JS"

command -v nginx >/dev/null && nginx -t 2>/dev/null && nginx -s reload 2>/dev/null || true

log "3) verificação pública"
sleep 1
PUB=$(curl -fsS "https://arbishield.app/app-proteger.html?v=$BUST" || true)
echo "$PUB" | grep -q "$MARKER" || echo "AVISO: marker ainda não no público (cache/path?)"
if echo "$PUB" | grep -q "Stake equivalente (casa)"; then
  echo "AVISO: público ainda contém Stake equivalente — confira root do nginx"
  grep -R "root " /etc/nginx/sites-enabled 2>/dev/null | head -30 || true
  find /var/www /opt/arbishield -name 'app-proteger.html' 2>/dev/null | head -40 || true
else
  echo "PÚBLICO OK — sem Stake equivalente"
fi
if echo "$PUB" | grep -q 'Odd LAY → back equiv.'; then
  echo "AVISO: público ainda contém Odd LAY"
else
  echo "PÚBLICO OK — sem Odd LAY"
fi

echo
echo "OK — rode hard refresh Ctrl+Shift+R no celular/navegador."
echo "Marker: $MARKER"
