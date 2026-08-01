#!/usr/bin/env bash
# Hotfix VPS: publica app-proteger.html com preview/hint do MAX efetivo
# (50% Apostador ∩ liquidez) — corrige preview que mostrava só 50%.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-reembolso-lucas-perdeu-723d/scripts/vps-hotfix-proteger-max-efetivo.sh?$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-main}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
TS="$(date +%s)"
MARKER="proteger-max-efetivo-v6c"

echo "==> vps-hotfix-proteger-max-efetivo.sh ($(date -Is))"
echo "    REF=$REF"

[[ "$(id -u)" -eq 0 ]] || { echo "ERRO: rode como root" >&2; exit 1; }
command -v curl >/dev/null || { echo "ERRO: curl ausente" >&2; exit 1; }
command -v find >/dev/null || { echo "ERRO: find ausente" >&2; exit 1; }
command -v grep >/dev/null || { echo "ERRO: grep ausente" >&2; exit 1; }

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
out="$tmpdir/app-proteger.html"

echo "==> Baixar app-proteger.html"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/deploy/vps-supabase/static/v2/app-proteger.html?t=${TS}" -o "$out"

grep -q "$MARKER" "$out" || {
  echo "ERRO: HTML sem meta $MARKER"
  exit 1
}
grep -q 'Máx. efetivo neste evento' "$out" || {
  echo "ERRO: HTML sem linha Máx. efetivo neste evento"
  exit 1
}
grep -q 'currentEventMaxCents' "$out" || {
  echo "ERRO: HTML sem currentEventMaxCents"
  exit 1
}
grep -q 'applyMaxAmount' "$out" || {
  echo "ERRO: HTML sem applyMaxAmount"
  exit 1
}

echo "==> Publicar em todos os app-proteger.html sob /var/www e /opt"
n=0
while IFS= read -r -d '' f; do
  cp -a "$f" "${f}.bak-max-efetivo-${TS}" 2>/dev/null || true
  cp -f "$out" "$f"
  chmod 0644 "$f"
  echo "  OK $f"
  n=$((n + 1))
done < <(find /var/www /opt -type f -name 'app-proteger.html' -print0 2>/dev/null)

if [[ "$n" -eq 0 ]]; then
  echo "ERRO: nenhum app-proteger.html encontrado"
  exit 1
fi
echo "  => $n arquivo(s)"

if command -v nginx >/dev/null 2>&1; then
  nginx -t >/dev/null 2>&1 && systemctl reload nginx 2>/dev/null || true
fi

echo
echo "Pronto."
echo "  https://arbishield.app/app-proteger.html  (Ctrl+Shift+R)"
echo "  https://arbishield.app/v2/app-proteger.html"
echo
echo "View Source → meta arbishield-build deve ser: $MARKER"
echo "No drawer: preview mostra 'Máx. 50%...' + 'Máx. efetivo...' (liquidez quando menor)."
