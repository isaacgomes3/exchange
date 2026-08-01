#!/usr/bin/env bash
# Hotfix VPS: publica UIs Proteger + Proteções (MAX + dedução/lucro no protocolo).
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-reembolso-lucas-perdeu-723d/scripts/vps-hotfix-ui-proteger-protecoes-v6.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
TS="$(date +%s)"

echo "==> vps-hotfix-ui-proteger-protecoes-v6.sh ($(date -Is))"
echo "    REF=$REF"

[[ "$(id -u)" -eq 0 ]] || { echo "ERRO: rode como root" >&2; exit 1; }
command -v curl >/dev/null || { echo "ERRO: curl ausente" >&2; exit 1; }
command -v find >/dev/null || { echo "ERRO: find ausente" >&2; exit 1; }
command -v grep >/dev/null || { echo "ERRO: grep ausente" >&2; exit 1; }

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

fetch() {
  local remote="$1" localname="$2" marker="$3"
  local out="$tmpdir/$localname"
  echo "==> Baixar $localname"
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
    "$RAW/deploy/vps-supabase/static/v2/${remote}?t=${TS}" -o "$out"
  grep -q "$marker" "$out" || {
    echo "ERRO: $localname sem marcador esperado: $marker"
    exit 1
  }
  echo "  OK marker $marker"
}

publish() {
  local src="$1" name="$2"
  local n=0
  while IFS= read -r -d '' f; do
    cp -a "$f" "${f}.bak-ui-v6-${TS}" 2>/dev/null || true
    cp -f "$src" "$f"
    chmod 0644 "$f"
    echo "  OK $f"
    n=$((n + 1))
  done < <(find /var/www /opt -type f -name "$name" -print0 2>/dev/null)
  if [[ "$n" -eq 0 ]]; then
    echo "AVISO: nenhum $name encontrado sob /var/www|/opt"
  else
    echo "  => $n arquivo(s) $name"
  fi
}

# Proteger: botão MAX (50%)
fetch "app-proteger.html" "app-proteger.html" "btnAmountMax"
grep -q 'applyMaxAmount' "$tmpdir/app-proteger.html" || {
  echo "ERRO: app-proteger.html sem applyMaxAmount"
  exit 1
}

# Proteções: Valor protegido com dedução + lucro
fetch "app-protecoes.html" "app-protecoes.html" "prot-kv-wide"
grep -q 'Dedução ArbiShield' "$tmpdir/app-protecoes.html" || {
  echo "ERRO: app-protecoes.html sem Dedução ArbiShield"
  exit 1
}
grep -q 'Lucro do usuário' "$tmpdir/app-protecoes.html" || {
  echo "ERRO: app-protecoes.html sem Lucro do usuário"
  exit 1
}
grep -q 'userProfitCentsOf' "$tmpdir/app-protecoes.html" || {
  echo "ERRO: app-protecoes.html sem userProfitCentsOf"
  exit 1
}

echo "==> Publicar nos caminhos da VPS"
publish "$tmpdir/app-proteger.html" "app-proteger.html"
publish "$tmpdir/app-protecoes.html" "app-protecoes.html"

# nginx / static cache (melhor esforço)
if command -v nginx >/dev/null 2>&1; then
  nginx -t >/dev/null 2>&1 && systemctl reload nginx 2>/dev/null || true
fi

echo
echo "Pronto."
echo "  1) https://arbishield.app/v2/app-proteger.html  → campo com botão MAX (Ctrl+Shift+R)"
echo "  2) https://arbishield.app/v2/app-protecoes.html → Protocolo: Valor protegido + Dedução + Lucro"
echo
echo "Cheque o meta arbishield-build no View Source:"
echo "  proteger → proteger-max-50-btn-v6b (ou protecoes-cancel-stake-lock-v6)"
