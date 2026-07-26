#!/usr/bin/env bash
# Hotfix: credenciais legado↔novo (Auth compartilhado)
#
# 1) Diagnostica se o usuário existe / e-mail confirmado / hash de senha
# 2) Confirma e-mails pendentes (causa clássica de "Invalid login credentials")
# 3) Atualiza auth.html com mensagens em PT + aviso de sessão compartilhada
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/auth-credenciais-legado-723d/scripts/vps-hotfix-auth-credenciais.sh?v=1")
#
# Só diagnosticar (sem confirmar):
#   CONFIRM_ALL=0 bash <(curl -fsSL ".../vps-hotfix-auth-credenciais.sh?v=1")
#
# Um e-mail específico:
#   EMAIL=alguem@gmail.com CONFIRM=1 bash <(curl ...)
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/auth-credenciais-legado-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/arbishield/deploy/vps-supabase}"
ENV_FILE="${ENV_FILE:-$COMPOSE_DIR/.env}"

# Por padrão confirma todos os e-mails pendentes (migração + SMTP quebrado).
CONFIRM_ALL="${CONFIRM_ALL:-1}"
CONFIRM="${CONFIRM:-0}"
EMAIL="${EMAIL:-izypolzebets@gmail.com}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
need node

mkdir -p "$WEB" "$SHIM_DIR"

log "Baixar diagnóstico Auth"
curl -fsSL "$RAW/scripts/vps-diagnose-auth-credentials.mjs" \
  -o "$SHIM_DIR/vps-diagnose-auth-credentials.mjs"
chmod 0644 "$SHIM_DIR/vps-diagnose-auth-credentials.mjs"

# Carrega SERVICE_ROLE / URLs se existirem
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi
if [[ -f /opt/arbishield/.arbishield-odds-sync.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source /opt/arbishield/.arbishield-odds-sync.env
  set +a
fi

export ENV_FILE COMPOSE_DIR
export EMAIL CONFIRM CONFIRM_ALL
export ARBISHIELD_SUPABASE_URL="${ARBISHIELD_SUPABASE_URL:-${SUPABASE_URL:-http://127.0.0.1:8000}}"
export SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-${ARBISHIELD_SERVICE_ROLE_KEY:-}}}"
export SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-$SERVICE_ROLE_KEY}"
export ARBISHIELD_SERVICE_ROLE_KEY="${ARBISHIELD_SERVICE_ROLE_KEY:-$SERVICE_ROLE_KEY}"
export ANON_KEY="${ANON_KEY:-${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}}"
export SITE_URL="${SITE_URL:-https://arbishield.app}"

[[ -n "${SERVICE_ROLE_KEY:-}" ]] || die "SERVICE_ROLE_KEY ausente em $ENV_FILE"

log "Rodar diagnóstico (EMAIL=$EMAIL CONFIRM=$CONFIRM CONFIRM_ALL=$CONFIRM_ALL)"
node "$SHIM_DIR/vps-diagnose-auth-credentials.mjs"

log "Atualizar auth.html (mensagens PT + sessão compartilhada)"
curl -fsSL "$RAW/deploy/vps-supabase/static/v2/auth.html" -o "$WEB/auth.html"
chmod 0644 "$WEB/auth.html"
cp -f "$WEB/auth.html" "$WEB_ROOT/auth.html" 2>/dev/null || true
grep -q 'Invalid login credentials\|Credenciais inválidas\|sessão compartilhada\|mesma conta' "$WEB/auth.html" || \
  die "auth.html sem mensagens de credenciais/sessão compartilhada"

log "Atualizar auth-vps.html (mensagens de login/recover)"
curl -fsSL "$RAW/deploy/vps-supabase/static/auth-vps.html" -o "$WEB_ROOT/auth-vps.html"
chmod 0644 "$WEB_ROOT/auth-vps.html"
cp -f "$WEB_ROOT/auth-vps.html" "$WEB/auth-vps.html" 2>/dev/null || true
grep -q 'Credenciais inválidas\|SMTP da VPS\|mesma conta' "$WEB_ROOT/auth-vps.html" || \
  die "auth-vps.html sem mensagens atualizadas"

# Dica SMTP: se recover ainda falha, o .env provavelmente tem SMTP fake
if [[ -f "$ENV_FILE" ]]; then
  if grep -qE '^SMTP_HOST=supabase-mail|^SMTP_HOST=$|^SMTP_PASS=fake_' "$ENV_FILE" 2>/dev/null; then
    echo
    echo "AVISO: SMTP parece placeholder em $ENV_FILE"
    echo "  Sem SMTP real, 'esqueci a senha' e confirmação por e-mail falham."
    echo "  Configure SMTP_HOST/PORT/USER/PASS e reinicie o serviço auth (GoTrue)."
  fi
fi

echo
echo "OK — Auth legado = novo (mesmo backend)"
echo "  Login: https://arbishield.app/auth.html"
echo "  Conta de teste diagnosticada: $EMAIL"
echo "  Se ainda falhar após confirmação: senha errada ou hash ausente (redefinir via admin)."
echo "  Ctrl+F5 em /auth.html"
