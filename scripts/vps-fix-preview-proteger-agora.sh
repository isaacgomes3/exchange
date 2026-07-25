#!/usr/bin/env bash
# CORRIGE retorno/dedução zerados no Proteger.
# 1) Baixa HTML novo do GitHub
# 2) Se ainda houver o bug (__pv.grossReturnCents), substitui updatePreview no arquivo local
# 3) Publica em /v2 e /sandbox e valida
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/protecao-fee-upfront-3cf9/scripts/vps-fix-preview-proteger-agora.sh?v=$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/protecao-fee-upfront-3cf9}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
V2="${ARBISHIELD_WEB:-/var/www/arbishield/v2}"
SANDBOX="${ARBISHIELD_SANDBOX_WEB:-/var/www/arbishield/sandbox}"
TS="$(date +%s)"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl; need python3; need grep
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
mkdir -p "$V2" "$SANDBOX"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

log "Baixar HTML do GitHub ($REF)"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/static/v2/app-proteger.html?v=$TS" -o "$TMP"
grep -q 'lucroBruto' "$TMP" || die "GitHub ainda sem lucroBruto — branch desatualizada?"

# Garante updatePreview autocontido (mesmo se o download vier errado)
python3 - "$TMP" <<'PY'
from pathlib import Path
import re, sys
path = Path(sys.argv[1])
t = path.read_text(encoding="utf-8", errors="replace")

GOOD = r'''
      function updatePreview() {
        if (!state.selected) return;
        var amountReais = Number(document.getElementById("amount").value || 0);
        var odd = Number(state.selected.market && state.selected.market.odd) || Number(String(document.getElementById("odd").value || "0").replace(",", "."));
        var amountCents = Math.round(amountReais * 100);
        var mt = state.selected.marketType;
        var layOdd = Number(odd) > 1.01 ? Number(odd) : 1.01;
        var effOdd = mt === "LAY" ? (layOdd / (layOdd - 1)) : layOdd;
        var retorno = Math.round(amountCents * effOdd);
        var lucroBruto = Math.max(0, retorno - amountCents);
        var seuLucro = Math.round(amountCents * 0.015);
        var deducao = Math.max(0, lucroBruto - seuLucro);
        var avail = typeof available === "function" ? available(document.getElementById("balanceType").value) : 0;
        var oddLine =
          mt === "LAY"
            ? "<div><span>Odd LAY → back equiv.</span><b>" +
              Number(effOdd).toFixed(3).replace(".", ",") +
              "</b></div>"
            : "";
        document.getElementById("preview").innerHTML =
          "<div><span>Tipo</span><b>" + mt + "</b></div>" +
          oddLine +
          "<div><span>Valor (stake)</span><b>" + money(amountCents) + "</b></div>" +
          "<div><span>Retorno casa externa</span><b>" + money(retorno) + "</b></div>" +
          "<div><span>Seu lucro (1,5%)</span><b>" + money(seuLucro) + "</b></div>" +
          "<div><span>Dedução ArbiShield</span><b>" + money(deducao) + "</b></div>" +
          "<div><span>Saldo disponível</span><b>" + money(avail) + "</b></div>";
      }
'''

m = re.search(r"function updatePreview\s*\(\)\s*\{", t)
if not m:
    raise SystemExit("updatePreview ausente no download")
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
t = t[:start] + GOOD.strip() + t[end:]
# remove helpers frágeis antigos que confundem
t = re.sub(
    r"\n\s*function layToBackOddPreview\s*\([\s\S]*?\n\s*function calcPreviewFeeUpfront\s*\([\s\S]*?\n\s*function updatePreview",
    "\n      function updatePreview",
    t,
    count=1,
)
# se o regex acima comeu updatePreview, já está ok; re-garante GOOD uma vez
if "__ret = __pv.grossReturnCents" in t or "calcPreviewFeeUpfront" in t and "lucroBruto" not in t:
    m = re.search(r"function updatePreview\s*\(\)\s*\{", t)
    if m:
        start = m.start(); i = m.end()-1; depth=0; end=None
        while i < len(t):
            if t[i]=="{": depth+=1
            elif t[i]=="}":
                depth-=1
                if depth==0: end=i+1; break
            i+=1
        t = t[:start] + GOOD.strip() + t[end:]

path.write_text(t, encoding="utf-8")
out = path.read_text(encoding="utf-8")
assert "lucroBruto" in out, "falhou injetar lucroBruto"
assert "__ret = __pv.grossReturnCents" not in out, "ainda tem bug __pv"
print("  updatePreview OK (lucroBruto)")
PY

publish() {
  local dest="$1"
  local mode="$2"
  cp -f "$TMP" "$dest"
  sed -i "s/proteger-lay-back-equiv-[0-9]*/proteger-fix-$TS/g" "$dest" || true
  sed -i "s/proteger-fee-upfront-[0-9]*/proteger-fix-$TS/g" "$dest" || true
  sed -i "s/?v=preview-[^\"']*/?v=proteger-fix-$TS/g" "$dest" || true

  if [[ "$mode" == "sandbox" ]]; then
    python3 - "$dest" <<'PY'
from pathlib import Path
import re, sys
p = Path(sys.argv[1])
t = p.read_text(encoding="utf-8", errors="replace")
for a,b in [
    ('"/api/arbishield/', '"/__sandbox_api/arbishield/'),
    ("'/api/arbishield/", "'/__sandbox_api/arbishield/"),
    ("`/api/arbishield/", "`/__sandbox_api/arbishield/"),
]:
    t = t.replace(a,b)
if "arbishield-sandbox-banner" not in t:
    banner = '<div id="arbishield-sandbox-banner" style="position:sticky;top:0;z-index:99999;background:#7c2d12;color:#ffedd5;text-align:center;padding:8px 12px;font:700 12px/1.4 sans-serif">SANDBOX</div>\n'
    t = re.sub(r"(<body[^>]*>)", r"\1\n"+banner, t, count=1, flags=re.I)
p.write_text(t, encoding="utf-8")
PY
  fi

  grep -q 'lucroBruto' "$dest" || die "$dest SEM lucroBruto"
  if grep -q '__ret = __pv.grossReturnCents' "$dest"; then
    die "$dest AINDA COM BUG __pv — abortado"
  fi
  # marca versão
  if ! grep -q 'data-preview-fix=' "$dest"; then
    sed -i "s|</body>|<div data-preview-fix=\"$TS\" hidden></div>\n</body>|" "$dest" || true
  fi
  echo "  OK $dest (md5 $(md5sum "$dest" | awk '{print $1}'))"
}

log "Publicar produção"
publish "$V2/app-proteger.html" prod
log "Publicar sandbox"
publish "$SANDBOX/app-proteger.html" sandbox

# tenta limpar cache nginx se houver
if command -v nginx >/dev/null; then
  nginx -s reload 2>/dev/null || true
fi

echo
echo "======== TESTE LOCAL ========"
python3 - <<'PY'
# simula LAY 11 / 1000
odd=11.0
amount=100000
eff=odd/(odd-1)
ret=round(amount*eff)
lucro=max(0,ret-amount)
user=round(amount*0.015)
fee=max(0,lucro-user)
print(f"LAY {odd:.0f} → back {eff:.3f} | retorno R$ {ret/100:.2f} | dedução R$ {fee/100:.2f}")
assert ret==110000 and fee==8500
print("cálculo OK")
PY

echo
echo "OK publicado. Abra em JANELA ANÔNIMA:"
echo "  https://arbishield.app/app-proteger.html?v=$TS"
echo
echo "LAY 11 · R\$ 1.000 deve mostrar:"
echo "  Retorno casa externa = R\$ 1.100,00"
echo "  Dedução ArbiShield   = R\$ 85,00"
echo
echo "Confirme no HTML (tem que achar lucroBruto):"
echo "  curl -s 'https://arbishield.app/app-proteger.html?v=$TS' | grep -c lucroBruto"
