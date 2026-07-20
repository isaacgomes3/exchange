#!/usr/bin/env bash
set -euo pipefail
BRANCH="${ARBISHIELD_HOTFIX_BRANCH:-cursor/jogos-24h-remove-30min-723d}"
exec bash -c "curl -fsSL https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}/scripts/vps-fix-agora.sh | bash"
