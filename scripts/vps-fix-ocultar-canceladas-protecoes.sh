#!/usr/bin/env bash
# Minhas Proteções: canceladas NÃO aparecem na lista.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/protecao-fee-upfront-3cf9/scripts/vps-fix-ocultar-canceladas-protecoes.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/protecao-fee-upfront-3cf9}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
TS="$(date +%s)"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
need python3

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

log "Baixar app-protecoes.html"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/static/v2/app-protecoes.html?v=$TS" -o "$TMP"
grep -q 'isVisibleProtection' "$TMP" || die "download sem isVisibleProtection"
grep -q 'neq("status", "cancelled")' "$TMP" || die "download sem filtro neq cancelled"

# Override extra: se load antigo voltar, esconde no DOM
OVERRIDE='
<script id="arbishield-hide-cancelled-protections">
(function(){
  function hide(){
    try{
      document.querySelectorAll(".term-row, article.term-row, .prot-list article").forEach(function(row){
        var badge = row.querySelector(".prot-badge, .term-col-status");
        var txt = ((badge && badge.textContent) || row.textContent || "").toLowerCase();
        if (txt.indexOf("cancelad") >= 0) {
          row.style.display = "none";
          row.setAttribute("data-hidden-cancelled", "1");
        }
      });
      var aside = document.getElementById("detail");
      if (aside && /cancelad/i.test(aside.textContent || "")) {
        var sel = document.querySelector(".term-row.prot-active[data-hidden-cancelled=\"1\"]");
        if (sel) {
          aside.innerHTML = "<h2>Protocolo de auditoria</h2><p class=\"sub\">Selecione uma proteção para ver detalhes e ações.</p>";
        }
      }
    }catch(e){}
  }
  var obs = new MutationObserver(function(){ hide(); });
  function boot(){
    var list = document.getElementById("list") || document.querySelector(".prot-list");
    if (list) obs.observe(list, { childList:true, subtree:true, characterData:true });
    hide();
    setInterval(hide, 800);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
</script>
'

python3 - "$TMP" "$OVERRIDE" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
override = sys.argv[2]
t = p.read_text(encoding="utf-8", errors="replace")
import re
t = re.sub(
    r'<script id="arbishield-hide-cancelled-protections">[\s\S]*?</script>\s*',
    "",
    t,
)
if "</body>" in t:
    t = t.replace("</body>", override + "\n</body>", 1)
else:
    t += "\n" + override
t = re.sub(r"(\?v=)[^\"']+", r"\1hide-cancel-" + str(__import__("time").time()).split(".")[0], t, count=6)
p.write_text(t, encoding="utf-8")
print("  override injetado")
PY

mapfile -t DEST < <(find /var/www/arbishield /var/www/arbishield-teste \
  -type f -name 'app-protecoes.html' 2>/dev/null | sort -u)
[[ ${#DEST[@]} -gt 0 ]] || DEST=(/var/www/arbishield/v2/app-protecoes.html)

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
  grep -q 'isVisibleProtection' "$f" || die "$f sem filtro"
  grep -q 'arbishield-hide-cancelled-protections' "$f" || die "$f sem override"
  echo "  OK $f"
done

command -v nginx >/dev/null && nginx -s reload 2>/dev/null || true
sleep 1

PUB=$(curl -fsS "https://arbishield.app/app-protecoes.html?v=$TS" | grep -c 'isVisibleProtection' || true)
PUBO=$(curl -fsS "https://arbishield.app/app-protecoes.html?v=$TS" | grep -c 'arbishield-hide-cancelled-protections' || true)
echo "público isVisibleProtection=$PUB override=$PUBO"
[[ "$PUB" -ge 1 && "$PUBO" -ge 1 ]] || die "HTML público ainda antigo — confira root do nginx"

echo
echo "OK — canceladas ocultas"
echo "  https://arbishield.app/app-protecoes.html?v=$TS"
echo "  Abra em JANELA ANÔNIMA"
