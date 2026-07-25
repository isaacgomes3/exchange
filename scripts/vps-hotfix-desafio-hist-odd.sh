#!/usr/bin/env bash
# Desafio Historico: mostra a odd da entrada do cliente (nao so o valor).
#
# Na VPS (root):
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-desafio-hist-odd.sh?ref=cursor/desafio-hist-odd-e85c&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

export ARBISHIELD_REF="${ARBISHIELD_REF:-cursor/desafio-hist-odd-e85c}"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"

echo "==> vps-hotfix-desafio-hist-odd.sh ref=$ARBISHIELD_REF"
# Baixa e executa o hotfix de historico (UI + shim + nginx) nesta mesma ref
tmp="$(mktemp)"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  -H "Accept: application/vnd.github.raw" \
  -H "Cache-Control: no-cache" \
  -H "User-Agent: arbishield-hotfix" \
  "$API/scripts/vps-hotfix-desafio-historico.sh?ref=${ARBISHIELD_REF}&t=$(date +%s%N)" \
  -o "$tmp"
[[ -s "$tmp" ]] || { echo "ERRO: download vazio do hotfix historico" >&2; exit 1; }
bash "$tmp"
rm -f "$tmp"

echo "OK — Historico do Desafio agora mostra @ odd da entrada."
echo "  Abra /app-desafio.html -> Historico -> Ctrl+Shift+R"
