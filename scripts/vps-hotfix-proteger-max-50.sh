#!/usr/bin/env bash
# Hotfix VPS: publica app-proteger.html com botão MAX (50% do Apostador restante).
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-reembolso-lucas-perdeu-723d/scripts/vps-hotfix-proteger-max-50.sh?$(date +%s)")
#
# Ou com REF explícito:
#   ARBISHIELD_REF=cursor/fix-reembolso-lucas-perdeu-723d bash <(curl -fsSL "...")
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
TS="$(date +%s)"

echo "==> vps-hotfix-proteger-max-50.sh ($(date -Is))"
echo "    REF=$REF"

[[ "$(id -u)" -eq 0 ]] || { echo "ERRO: rode como root" >&2; exit 1; }
command -v curl >/dev/null || { echo "ERRO: curl ausente" >&2; exit 1; }
command -v find >/dev/null || { echo "ERRO: find ausente" >&2; exit 1; }
command -v grep >/dev/null || { echo "ERRO: grep ausente" >&2; exit 1; }

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

echo "==> Baixar app-proteger.html (com MAX)"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/static/v2/app-proteger.html?t=${TS}" -o "$TMP"

grep -q 'btnAmountMax' "$TMP" || {
  echo "ERRO: HTML baixado sem botão MAX (btnAmountMax)"
  exit 1
}
grep -q 'applyMaxAmount' "$TMP" || {
  echo "ERRO: HTML baixado sem applyMaxAmount"
  exit 1
}
grep -q 'maxStakeLockCents' "$TMP" || {
  echo "ERRO: HTML baixado sem maxStakeLockCents"
  exit 1
}
grep -q 'amount-row' "$TMP" || {
  echo "ERRO: HTML baixado sem CSS amount-row"
  exit 1
}

echo "==> Procurar app-proteger.html sob /var/www e /opt"
mapfile -t FILES < <(
  find /var/www /opt \
    -type f -name 'app-proteger.html' 2>/dev/null | sort -u
)

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "ERRO: nenhum app-proteger.html encontrado"
  exit 1
fi

n=0
for f in "${FILES[@]}"; do
  cp -a "$f" "${f}.bak-max50-${TS}" 2>/dev/null || true
  cp -f "$TMP" "$f"
  chmod 0644 "$f"
  # cache-bust meta local (força browser a ver build novo)
  if grep -q 'arbishield-build' "$f"; then
    sed -i "s/content=\"proteger-[^\"]*\"/content=\"proteger-max-50-campo-v6-${TS}\"/" "$f" || true
  fi
  echo "  OK $f"
  n=$((n + 1))
done

echo "==> arquivos atualizados: $n"
echo "Pronto. Abra https://arbishield.app/v2/app-proteger.html (Ctrl+Shift+R)"
echo "  No drawer: campo Responsabilidade/Stake deve ter botão MAX · R\$ …"
echo "  MAX = 50% do saldo Apostador restante (limitado pela liquidez)."
