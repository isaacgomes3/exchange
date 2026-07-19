#!/usr/bin/env bash
# Prepara o frontend ArbiShield para apontar à API self-hosted na VPS
# e publica em /var/www/arbishield (nginx).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${ARBISHIELD_SRC:-$ROOT/arbishield-local}"
DEST="${ARBISHIELD_WWW:-/var/www/arbishield}"
API_URL="${API_PUBLIC_URL:-http://195.200.6.206}"
CLOUD_URL="https://wknyfxikmmvjzpbevlid.supabase.co"
CLOUD_ANON_JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndrbnlmeGlrbW12anpwYmV2bGlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMzYzODEsImV4cCI6MjA5OTcxMjM4MX0.TwIRf12jQM2yYd6N49_aSs5Gs6CuI9P3uBcVo7pJs3g"

if [[ ! -d "$SRC/assets" ]]; then
  echo "Espelho não encontrado em $SRC — rode: npm run arbishield:mirror"
  exit 1
fi

if [[ -z "${VPS_ANON_KEY:-}" ]]; then
  if [[ -f "$ROOT/.vps-supabase-credentials.local" ]]; then
    VPS_ANON_KEY="$(grep '^ANON_KEY=' "$ROOT/.vps-supabase-credentials.local" | cut -d= -f2-)"
  fi
fi
if [[ -z "${VPS_ANON_KEY:-}" ]]; then
  echo "Defina VPS_ANON_KEY (ANON_KEY do .env da VPS)"
  exit 1
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -a "$SRC/." "$STAGE/"

echo "==> Patch URL $CLOUD_URL → $API_URL"
echo "==> Patch anon JWT → VPS ANON_KEY"
python3 - "$STAGE" "$CLOUD_URL" "$API_URL" "$CLOUD_ANON_JWT" "$VPS_ANON_KEY" <<'PY'
import sys
from pathlib import Path
root, old_url, new_url, old_jwt, new_jwt = sys.argv[1:6]
n_url = n_jwt = 0
for p in Path(root).rglob("*"):
    if not p.is_file():
        continue
    if p.suffix.lower() not in {".js", ".html", ".json", ".css", ".map"}:
        continue
    raw = p.read_bytes()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        continue
    if old_url not in text and old_jwt not in text:
        continue
    n_url += text.count(old_url)
    n_jwt += text.count(old_jwt)
    text = text.replace(old_url, new_url).replace(old_jwt, new_jwt)
    p.write_text(text)
print(f"replaced url x{n_url}, jwt x{n_jwt}")
if n_url == 0 or n_jwt == 0:
    raise SystemExit("patch incompleto — verifique o espelho do frontend")
PY

echo "==> Publicar em $DEST"
mkdir -p "$DEST"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete "$STAGE"/ "$DEST"/
else
  rm -rf "$DEST"
  mkdir -p "$DEST"
  cp -a "$STAGE"/. "$DEST"/
fi

echo "==> Páginas/estáticos VPS (não apagar no próximo --delete)"
STATIC_DIR="$ROOT/deploy/vps-supabase/static"
if [[ -d "$STATIC_DIR" ]]; then
  cp -f "$STATIC_DIR/admin-desafios-vps.html" "$DEST/admin-desafios-vps.html"
  cp -f "$STATIC_DIR/desafio-sugestoes.html" "$DEST/desafio-sugestoes.html"
  mkdir -p "$DEST/assets"
  cp -f "$STATIC_DIR/desafio-sugestoes-inject.js" "$DEST/assets/desafio-sugestoes-inject.js"
fi

echo "==> Boot CSR (evita tela preta em /app por hydration SSR da home)"
python3 "$ROOT/scripts/arbishield-fix-csr-boot.py" "$DEST"

echo "OK: frontend cutover em $DEST (API=$API_URL)"
