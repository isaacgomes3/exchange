#!/usr/bin/env bash
# Verificação completa: conta jawadog (ban/roles) + IP nginx do desafio-delete.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/investigar-adm-jawadog-3e4b/scripts/vps-verificar-tudo-jawadog.sh")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/investigar-adm-jawadog-3e4b}"
SHA="$(curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/commits/${BRANCH}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["sha"])')"
BASE="https://raw.githubusercontent.com/isaacgomes3/exchange/${SHA}/scripts"

echo "════════════════════════════════════════════════════════════════════════"
echo "VERIFICAÇÃO COMPLETA · jawadog + IP delete"
echo "branch=${BRANCH} sha=${SHA:0:12}"
echo "════════════════════════════════════════════════════════════════════════"

echo
echo "######## A) Conta Auth / roles / ban (somente leitura) ########"
bash <(curl -fsSL "${BASE}/vps-investigar-adm-jawadog.sh")

echo
echo "######## B) IP nginx / journal desafio-delete ########"
bash <(curl -fsSL "${BASE}/vps-verificar-ip-desafio-delete.sh")

echo
echo "OK — cole a saída completa (A + B)."
