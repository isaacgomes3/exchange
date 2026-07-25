#!/usr/bin/env bash
# Mostra AGORA no drawer: Retorno casa externa + Dedução ArbiShield
# Patchia o HTML que está no ar (produção e sandbox).
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
need curl
need python3
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
mkdir -p "$V2" "$SANDBOX"

patch_preview() {
  local FILE="$1"
  local LABEL="$2"
  [[ -f "$FILE" ]] || die "arquivo ausente: $FILE"
  log "Patch preview ($LABEL) → $FILE"
  python3 - "$FILE" "$TS" <<'PY'
from pathlib import Path
import re, sys

path = Path(sys.argv[1])
ts = sys.argv[2]
t = path.read_text(encoding="utf-8", errors="replace")

NEW_FN = r'''
      function layToBackOddPreview(layOdd) {
        var a = Number(layOdd) > 1.01 ? Number(layOdd) : 1.01;
        return a / (a - 1);
      }
      function calcPreviewFeeUpfront(amountCents, odd, marketType) {
        var stake = Math.floor(Number(amountCents) || 0);
        var mt = String(marketType || "LAY").toUpperCase();
        var a = Number(odd) > 1.01 ? Number(odd) : 1.01;
        if (mt === "LAY") a = layToBackOddPreview(a);
        var grossReturn = Math.round(stake * a);
        var profit = Math.max(0, grossReturn - stake);
        var userProfit = Math.round(stake * 0.015);
        var feeNow = Math.max(0, profit - userProfit);
        return {
          grossReturnCents: grossReturn,
          userProfitCents: userProfit,
          feeChargedCents: feeNow,
          effectiveBackOdd: a,
        };
      }
      function updatePreview() {
        if (!state.selected) return;
        var amountReais = Number(document.getElementById("amount").value || 0);
        var odd = Number(state.selected.market && state.selected.market.odd) || Number(document.getElementById("odd").value || 0);
        var amountCents = Math.round(amountReais * 100);
        var mt = state.selected.marketType;
        var __pv =
          typeof calcForMarket === "function"
            ? calcForMarket(mt, amountCents, odd)
            : typeof calcLay === "function" && mt === "LAY"
              ? calcLay(amountCents, odd)
              : typeof calcBack === "function" && mt === "BACK"
                ? calcBack(amountCents, odd)
                : calcPreviewFeeUpfront(amountCents, odd, mt);
        var __ret = __pv.grossReturnCents != null ? __pv.grossReturnCents : 0;
        var __user = __pv.userProfitCents != null ? __pv.userProfitCents : Math.round(amountCents * 0.015);
        var __fee = __pv.feeChargedCents != null ? __pv.feeChargedCents : (__pv.arbiShieldDeductionCents || 0);
        var avail =
          typeof available === "function"
            ? available(document.getElementById("balanceType").value)
            : 0;
        var oddLine =
          mt === "LAY"
            ? "<div><span>Odd LAY → back equiv.</span><b>" +
              Number(__pv.effectiveBackOdd || layToBackOddPreview(odd)).toFixed(3).replace(".", ",") +
              "</b></div>"
            : "";
        document.getElementById("preview").innerHTML =
          "<div><span>Tipo</span><b>" + mt + "</b></div>" +
          oddLine +
          "<div><span>Valor (stake)</span><b>" + money(amountCents) + "</b></div>" +
          "<div><span>Retorno casa externa</span><b>" + money(__ret) + "</b></div>" +
          "<div><span>Seu lucro (1,5%)</span><b>" + money(__user) + "</b></div>" +
          "<div><span>Dedução ArbiShield</span><b>" + money(__fee) + "</b></div>" +
          "<div><span>Saldo disponível</span><b>" + money(avail) + "</b></div>";
      }
'''

# Remove helper duplicado se já patchamos antes
t = re.sub(
    r"\n\s*function calcPreviewFeeUpfront\s*\([\s\S]*?\n\s*function updatePreview\s*\(\)\s*\{[\s\S]*?\n\s*\}",
    "\n      function updatePreview() {\n      }",
    t,
    count=1,
)

m = re.search(r"function updatePreview\s*\(\)\s*\{", t)
if not m:
    raise SystemExit("updatePreview() não encontrado")

# acha o '}' que fecha updatePreview (contagem de chaves)
start = m.start()
i = m.end() - 1  # aponta para '{'
depth = 0
end = None
while i < len(t):
    ch = t[i]
    if ch == "{":
        depth += 1
    elif ch == "}":
        depth -= 1
        if depth == 0:
            end = i + 1
            break
    i += 1
if end is None:
    raise SystemExit("não fechei updatePreview()")

t = t[:start] + NEW_FN.strip() + t[end:]

# bust cache em querystrings comuns
t = re.sub(r"(\?v=)[^\"']+", rf"\1preview-{ts}", t, count=8)
if f'data-preview-fee-upfront="{ts}"' not in t:
    if "data-preview-fee-upfront" in t:
        t = re.sub(
            r'data-preview-fee-upfront="[^"]*"',
            f'data-preview-fee-upfront="{ts}"',
            t,
            count=1,
        )
    else:
        t = t.replace(
            "</body>",
            f'<div data-preview-fee-upfront="{ts}" hidden></div>\n</body>',
            1,
        )

path.write_text(t, encoding="utf-8")
out = path.read_text(encoding="utf-8")
assert "Retorno casa externa" in out, "falhou: Retorno casa externa"
assert "Dedução ArbiShield" in out, "falhou: Dedução ArbiShield"
# o texto antigo do preview não pode restar como único resumo
print("  OK campos presentes")
PY
  grep -n 'Retorno casa externa\|Dedução ArbiShield' "$FILE" | head -5
}

# Produção
patch_preview "$V2/app-proteger.html" "produção"

# Sandbox: baixa HTML do branch (completo) e patchia de novo por garantia
log "Sandbox: baixar HTML do branch $REF"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/static/v2/app-proteger.html?v=$TS" \
  -o "$SANDBOX/app-proteger.html"
grep -q 'Retorno casa externa' "$SANDBOX/app-proteger.html" \
  || die "download sandbox sem Retorno casa externa"

python3 - "$SANDBOX/app-proteger.html" <<'PY'
from pathlib import Path
import re, sys
p = Path(sys.argv[1])
t = p.read_text(encoding="utf-8", errors="replace")
t = t.replace('"/api/arbishield/', '"/__sandbox_api/arbishield/')
t = t.replace("'/api/arbishield/", "'/__sandbox_api/arbishield/")
t = t.replace("`/api/arbishield/", "`/__sandbox_api/arbishield/")
if "arbishield-sandbox-banner" not in t:
    banner = (
        '<div id="arbishield-sandbox-banner" style="position:sticky;top:0;z-index:99999;'
        'background:#7c2d12;color:#ffedd5;text-align:center;padding:8px 12px;'
        'font:700 12px/1.4 sans-serif">SANDBOX — Retorno casa externa + Dedução ArbiShield</div>\n'
    )
    t = re.sub(r"(<body[^>]*>)", r"\1\n" + banner, t, count=1, flags=re.I)
p.write_text(t, encoding="utf-8")
print("  rewrite sandbox api OK")
PY

patch_preview "$SANDBOX/app-proteger.html" "sandbox"

echo
echo "OK — abra em janela anônima ou Ctrl+Shift+R:"
echo "  https://arbishield.app/app-proteger.html?v=$TS"
echo "  https://arbishield.app/sandbox/app-proteger.html?v=$TS"
echo
echo "Stake 1000 @ 1,10 → Retorno casa externa R\$ 1.100,00 · Dedução ArbiShield R\$ 85,00"
