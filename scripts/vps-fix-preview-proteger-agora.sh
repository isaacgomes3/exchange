#!/usr/bin/env bash
# Corrige Retorno/Dedução zerados — em TODOS os app-proteger.html sob /var/www/arbishield
# + injeta override JS inline (funciona mesmo se updatePreview legado voltar).
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/protecao-fee-upfront-3cf9/scripts/vps-fix-preview-proteger-agora.sh?$(date +%s)")
set -euo pipefail

TS="$(date +%s)"
log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need python3
need find
need grep

log "Procurar app-proteger.html em /var/www/arbishield*"
mapfile -t FILES < <(find /var/www/arbishield /var/www/arbishield-teste /opt/arbishield /opt/arbishield-teste \
  -type f -name 'app-proteger.html' 2>/dev/null | sort -u)
[[ ${#FILES[@]} -gt 0 ]] || die "nenhum app-proteger.html encontrado"

for f in "${FILES[@]}"; do
  echo "  · $f"
done

python3 - "$TS" "${FILES[@]}" <<'PY'
import sys, re
from pathlib import Path

ts = sys.argv[1]
files = sys.argv[2:]

GOOD_UPDATE = r'''
      function updatePreview() {
        if (!state.selected) return;
        var amountReais = Number(String(document.getElementById("amount").value || "0").replace(",", "."));
        var odd = Number(state.selected.market && state.selected.market.odd) ||
          Number(String(document.getElementById("odd").value || "0").replace(",", "."));
        var amountCents = Math.round(amountReais * 100);
        var mt = state.selected.marketType;
        var layOdd = Number(odd) > 1.01 ? Number(odd) : 1.01;
        var effOdd = mt === "LAY" ? (layOdd / (layOdd - 1)) : layOdd;
        var retorno = Math.round(amountCents * effOdd);
        var lucroBruto = Math.max(0, retorno - amountCents);
        var seuLucro = Math.round(amountCents * 0.015);
        var deducao = Math.max(0, lucroBruto - seuLucro);
        var avail = typeof available === "function" ? available(document.getElementById("balanceType").value) : 0;
        var oddLine = mt === "LAY"
          ? ""
          : "";
        document.getElementById("preview").innerHTML =
          "<div><span>Tipo</span><b>" + mt + "</b></div>" + oddLine +
          "<div><span>Valor (stake)</span><b>" + money(amountCents) + "</b></div>" +
          "<div><span>Retorno casa externa</span><b>" + money(retorno) + "</b></div>" +
          "<div><span>Seu lucro (1,5%)</span><b>" + money(seuLucro) + "</b></div>" +
          "<div><span>Dedução ArbiShield</span><b>" + money(deducao) + "</b></div>" +
          "<div><span>Saldo disponível</span><b>" + money(avail) + "</b></div>";
      }
'''

OVERRIDE = r'''
<script id="arbishield-preview-fix-inline">
(function(){
  function money(c){try{if(window.ArbiV2&&ArbiV2.money)return ArbiV2.money(c);}catch(e){}return(Number(c||0)/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});}
  function num(v){return Number(String(v==null?"":v).replace(",","."))||0;}
  function fix(){
    var amountEl=document.getElementById("amount");
    var oddEl=document.getElementById("odd");
    var preview=document.getElementById("preview");
    var drawer=document.getElementById("drawer");
    if(!amountEl||!oddEl||!preview)return;
    if(drawer&&!drawer.classList.contains("open"))return;
    var amountCents=Math.round(num(amountEl.value)*100);
    var odd=num(oddEl.value); if(!(odd>1.01))return;
    var title=document.getElementById("drawerTitle");
    var mt=(title&&/BACK/i.test(title.textContent||""))?"BACK":"LAY";
    var layOdd=odd>1.01?odd:1.01;
    var effOdd=mt==="LAY"?(layOdd/(layOdd-1)):layOdd;
    var retorno=Math.round(amountCents*effOdd);
    var lucroBruto=Math.max(0,retorno-amountCents);
    var seuLucro=Math.round(amountCents*0.015);
    var deducao=Math.max(0,lucroBruto-seuLucro);
    var availMatch=(preview.innerHTML||"").match(/<div><span>Saldo dispon[^<]*<\/span><b>([^<]*)<\/b><\/div>/i);
    var availHtml=availMatch?("<div><span>Saldo disponível</span><b>"+availMatch[1]+"</b></div>"):"";
    preview.innerHTML="<div><span>Tipo</span><b>"+mt+"</b></div>"+
      "<div><span>Valor (stake)</span><b>"+money(amountCents)+"</b></div>"+
      "<div><span>Retorno casa externa</span><b>"+money(retorno)+"</b></div>"+
      "<div><span>Seu lucro (1,5%)</span><b>"+money(seuLucro)+"</b></div>"+
      "<div><span>Dedução ArbiShield</span><b>"+money(deducao)+"</b></div>"+availHtml;
    preview.setAttribute("data-fix-preview", "''' + ts + r'''");
  }
  function schedule(){setTimeout(fix,0);setTimeout(fix,40);setTimeout(fix,120);}
  document.addEventListener("input",function(e){var id=e.target&&e.target.id;if(id==="amount"||id==="odd"||id==="balanceType")schedule();},true);
  document.addEventListener("change",function(e){var id=e.target&&e.target.id;if(id==="amount"||id==="odd"||id==="balanceType")schedule();},true);
  document.addEventListener("click",schedule,true);
  var obs=new MutationObserver(function(){schedule();});
  function boot(){var p=document.getElementById("preview");if(p)obs.observe(p,{childList:true,subtree:true,characterData:true});schedule();}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);else boot();
})();
</script>
'''

def replace_update_preview(t: str) -> str:
    m = re.search(r"function updatePreview\s*\(\)\s*\{", t)
    if not m:
        raise SystemExit("updatePreview não encontrado")
    start = m.start()
    i = m.end() - 1
    depth = 0
    end = None
    while i < len(t):
        if t[i] == "{":
            depth += 1
        elif t[i] == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
        i += 1
    if end is None:
        raise SystemExit("não fechei updatePreview")
    return t[:start] + GOOD_UPDATE.strip() + t[end:]

for fp in files:
    path = Path(fp)
    t = path.read_text(encoding="utf-8", errors="replace")
    t = replace_update_preview(t)
    # remove helpers frágeis (não tocar no updatePreview bom)
    t = re.sub(
        r"\n\s*function layToBackOddPreview\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}",
        "\n",
        t,
        count=3,
    )
    t = re.sub(
        r"\n\s*function calcPreviewFeeUpfront\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}",
        "\n",
        t,
        count=3,
    )
    # injeta/atualiza override inline
    t = re.sub(
        r"<script id=\"arbishield-preview-fix-inline\">[\s\S]*?</script>\s*",
        "",
        t,
        count=2,
    )
    if "</body>" in t:
        t = t.replace("</body>", OVERRIDE + "\n</body>", 1)
    else:
        t += "\n" + OVERRIDE

    # cache bust
    t = re.sub(r"(\?v=)[^\"']+", rf"\1fix-{ts}", t, count=8)

    if "lucroBruto" not in t:
        raise SystemExit(f"{fp}: sem lucroBruto após patch")
    if "__ret = __pv.grossReturnCents" in t:
        raise SystemExit(f"{fp}: ainda com bug __pv")
    if "arbishield-preview-fix-inline" not in t:
        raise SystemExit(f"{fp}: override inline ausente")

    path.write_text(t, encoding="utf-8")
    print(f"OK {fp}")

print("DONE", len(files), "arquivos")
PY

# reload nginx se existir
command -v nginx >/dev/null && nginx -t 2>/dev/null && nginx -s reload 2>/dev/null || true

echo
echo "======== VERIFICAÇÃO LOCAL ========"
FAIL=0
for f in "${FILES[@]}"; do
  C=$(grep -c 'lucroBruto' "$f" || true)
  B=$(grep -c '__ret = __pv.grossReturnCents' "$f" || true)
  O=$(grep -c 'arbishield-preview-fix-inline' "$f" || true)
  echo "  $f → lucroBruto=$C bug=__pv:$B override=$O"
  [[ "$C" -ge 1 && "$B" -eq 0 && "$O" -ge 1 ]] || FAIL=1
done
[[ "$FAIL" -eq 0 ]] || die "validação local falhou"

echo
echo "======== VERIFICAÇÃO PÚBLICA ========"
sleep 1
PUB=$(curl -fsS "https://arbishield.app/app-proteger.html?v=$TS" | grep -c 'lucroBruto' || true)
PUBB=$(curl -fsS "https://arbishield.app/app-proteger.html?v=$TS" | grep -c '__ret = __pv.grossReturnCents' || true)
PUBO=$(curl -fsS "https://arbishield.app/app-proteger.html?v=$TS" | grep -c 'arbishield-preview-fix-inline' || true)
echo "  público lucroBruto=$PUB bug=$PUBB override=$PUBO"
if [[ "$PUB" -lt 1 || "$PUBB" -gt 0 || "$PUBO" -lt 1 ]]; then
  echo "AVISO: público ainda não reflete o arquivo local."
  echo "       Confira se o nginx root é o path que patchamos:"
  grep -R "root /var/www/arbishield" /etc/nginx 2>/dev/null | head -20 || true
  echo "       Rode: ls -la /var/www/arbishield/v2/app-proteger.html /var/www/arbishield/app-proteger.html 2>/dev/null"
else
  echo "PÚBLICO OK"
fi

echo
echo "Abra em JANELA ANÔNIMA:"
echo "  https://arbishield.app/app-proteger.html?v=$TS"
echo "LAY 11 · R\$1000 → retorno R\$1.100 · dedução R\$85"
