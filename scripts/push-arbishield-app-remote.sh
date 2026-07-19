#!/usr/bin/env bash
# Envia o branch atual para https://github.com/carlosjrpe/arbishield.app
# Requer autenticação com acesso de escrita nesse repositório.
set -euo pipefail

cd "$(dirname "$0")/.."

REMOTE_URL="${ARBISHIELD_APP_REMOTE:-https://github.com/carlosjrpe/arbishield.app.git}"
TARGET_BRANCH="${ARBISHIELD_APP_BRANCH:-main}"
SOURCE_REF="${1:-HEAD}"

if ! git remote get-url arbishield-app >/dev/null 2>&1; then
  git remote add arbishield-app "$REMOTE_URL"
else
  git remote set-url arbishield-app "$REMOTE_URL"
fi

echo "Remote:  $REMOTE_URL"
echo "Source:  $SOURCE_REF"
echo "Target:  $TARGET_BRANCH"
echo ""

git push -u arbishield-app "$SOURCE_REF:$TARGET_BRANCH"

echo ""
echo "✓ Enviado para https://github.com/carlosjrpe/arbishield.app"
