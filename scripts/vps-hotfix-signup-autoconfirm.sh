#!/usr/bin/env bash
# Hotfix: cadastro falha com "Error sending confirmation email"
# Causa: SMTP da VPS quebrado/fake + ENABLE_EMAIL_AUTOCONFIRM=false
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/fix-signup-email-confirm-723d/scripts/vps-hotfix-signup-autoconfirm.sh?v=1")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/fix-signup-email-confirm-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/arbishield/deploy/vps-supabase}"
ENV_FILE="${ENV_FILE:-$COMPOSE_DIR/.env}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl

[[ -f "$ENV_FILE" ]] || die "Não achei $ENV_FILE"
[[ -d "$COMPOSE_DIR" ]] || die "Não achei $COMPOSE_DIR"

log "Ativar ENABLE_EMAIL_AUTOCONFIRM=true em $ENV_FILE"
if grep -qE '^ENABLE_EMAIL_AUTOCONFIRM=' "$ENV_FILE"; then
  sed -i 's/^ENABLE_EMAIL_AUTOCONFIRM=.*/ENABLE_EMAIL_AUTOCONFIRM=true/' "$ENV_FILE"
else
  printf '\nENABLE_EMAIL_AUTOCONFIRM=true\n' >> "$ENV_FILE"
fi
grep -qE '^ENABLE_EMAIL_AUTOCONFIRM=true' "$ENV_FILE" || die "falha ao setar ENABLE_EMAIL_AUTOCONFIRM"

# Aviso SMTP placeholder
if grep -qE '^SMTP_HOST=supabase-mail|^SMTP_PASS=fake_|^SMTP_HOST=$' "$ENV_FILE" 2>/dev/null; then
  echo "AVISO: SMTP ainda é placeholder. Autoconfirm evita o erro de e-mail no cadastro,"
  echo "       mas 'esqueci a senha' continua quebrado até configurar SMTP real."
fi

log "Recriar serviço auth (GoTrue) para aplicar GOTRUE_MAILER_AUTOCONFIRM"
cd "$COMPOSE_DIR"
if docker compose ps auth >/dev/null 2>&1; then
  docker compose up -d --force-recreate auth
elif docker compose ps supabase-auth >/dev/null 2>&1; then
  docker compose up -d --force-recreate auth
else
  # tenta pelo container name
  docker restart supabase-auth 2>/dev/null || die "Não consegui reiniciar o auth (supabase-auth)"
fi
sleep 2

log "Atualizar auth.html (mensagens PT)"
mkdir -p "$WEB"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/auth.html" -o "$WEB/auth.html"
chmod 0644 "$WEB/auth.html"
cp -f "$WEB/auth.html" "$WEB_ROOT/auth.html" 2>/dev/null || true
grep -q 'confirmation email\|confirmação de e-mail\|Autoconfirma' "$WEB/auth.html" || \
  die "auth.html sem mensagem de confirmação"

log "Checar settings públicos"
ANON="$(grep -E '^ANON_KEY=' "$ENV_FILE" | tail -n1 | cut -d= -f2- || true)"
if [[ -n "$ANON" ]]; then
  curl -fsS "https://arbishield.app/auth/v1/settings" \
    -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
    | python3 -c 'import sys,json; s=json.load(sys.stdin); print("mailer_autoconfirm =", s.get("mailer_autoconfirm"))' \
    || true
fi

echo
echo "OK — Cadastro sem e-mail de confirmação"
echo "  Teste: https://arbishield.app/auth.html?mode=signup"
echo "  Ctrl+F5 em /auth.html"
echo "  Se mailer_autoconfirm ainda for false, confira o compose (GOTRUE_MAILER_AUTOCONFIRM) e reinicie auth de novo."
