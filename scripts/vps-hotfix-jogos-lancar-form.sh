#!/usr/bin/env bash
# LEGADO: fluxo BetBra removido. Use vps-hotfix-remover-betbra-api.sh
# Mantido só para não quebrar bookmarks antigos — redireciona a mensagem.
set -euo pipefail
echo "AVISO: Lançamento via BetBra foi removido."
echo "Use: scripts/vps-hotfix-remover-betbra-api.sh"
echo "CTA atual: + Lançar jogo → drawer manual"
exit 0
