#!/usr/bin/env bash
# Desafio Historico: mostra a odd da entrada do cliente (nao so o valor).
#
# Na VPS (root):
#   bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-desafio-hist-odd.sh?ref=cursor/desafio-hist-odd-e85c&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
set -euo pipefail

export ARBISHIELD_REF="${ARBISHIELD_REF:-cursor/desafio-hist-odd-e85c}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
# Reutiliza o hotfix de historico (ja baixa UI + shim + nginx)
if [[ -n "${ROOT}" && -f "$ROOT/vps-hotfix-desafio-historico.sh" ]]; then
  bash "$ROOT/vps-hotfix-desafio-historico.sh"
else
  bash <(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-desafio-historico.sh?ref=${ARBISHIELD_REF}&t=$(date +%s%N)" \
    -H "Accept: application/vnd.github.raw" -H "Cache-Control: no-cache" -H "User-Agent: arbishield-hotfix")
fi

echo "OK — Historico do Desafio agora mostra @ odd da entrada."
echo "  Abra /app-desafio.html → Historico → Ctrl+Shift+R"
)
