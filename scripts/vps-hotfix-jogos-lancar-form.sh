#!/usr/bin/env bash
# Obsoleto — redireciona para o hotfix canônico (manualLaunchPanel full-page).
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/manual-evento-escudo-times-bb44/scripts/vps-hotfix-jogos-lancar-form.sh")
set -euo pipefail

exec bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/manual-evento-escudo-times-bb44/scripts/vps-hotfix-lancar-evento-manual.sh")
