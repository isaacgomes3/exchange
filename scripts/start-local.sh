#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env.local ]; then
  cp .env.example .env.local
  echo "✓ .env.local criado"
fi

# Ativa proxy local no .env.local
if ! grep -q "MEXCHANGE_USE_LOCAL_PROXY=1" .env.local 2>/dev/null; then
  cat >> .env.local << 'EOF'

# Proxy local (IP da sua máquina)
MEXCHANGE_USE_LOCAL_PROXY=1
MEXCHANGE_LOCAL_PROXY_URL=http://127.0.0.1:8787
EOF
  echo "✓ Proxy local configurado no .env.local"
fi

echo ""
echo "  Iniciando ambiente local..."
echo "  1) Proxy BetBra (seu IP) → porta 8787"
echo "  2) Next.js painel        → porta 3000"
echo ""

node scripts/betbra-local-proxy.mjs &
PROXY_PID=$!

cleanup() {
  kill "$PROXY_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

sleep 1

if curl -sf http://127.0.0.1:8787/health > /dev/null 2>&1; then
  echo "✓ Proxy local ativo"
else
  echo "⚠ Proxy ainda iniciando..."
fi

echo "✓ Abrindo painel em http://localhost:3000"
echo ""

npm run dev -- --hostname 0.0.0.0 --port 3000
