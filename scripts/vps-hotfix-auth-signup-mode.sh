#!/usr/bin/env bash
# Página dedicada de cadastro (/cadastro.html) + CTA da landing.
# auth.html?mode=signup redireciona para /cadastro.html (não fica no login).
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/<SHA>/scripts/vps-hotfix-auth-signup-mode.sh")
set -euo pipefail

REF="${ARBISHIELD_REF:-6c0d50aeb37c1cf7d13970ee486119244926e7b9}"
BUST="${ARBISHIELD_BUST:-$(date +%s)}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 não encontrado"; }
need curl
mkdir -p "$WEB" "$WEB_ROOT"

dl() {
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$RAW/$1?v=$BUST" -o "$2"
}

log "1/4 UI — cadastro.html (formulário só de criar conta)"
dl "deploy/vps-supabase/static/v2/cadastro.html" "$WEB/cadastro.html"
chmod 0644 "$WEB/cadastro.html"
cp -f "$WEB/cadastro.html" "$WEB_ROOT/cadastro.html"
grep -q 'Criar conta' "$WEB/cadastro.html" || die "cadastro.html sem Criar conta"
grep -q 'id="fullName"' "$WEB/cadastro.html" || die "cadastro.html sem campo nome"

log "2/4 UI — auth.html (mode=signup → /cadastro.html)"
dl "deploy/vps-supabase/static/v2/auth.html" "$WEB/auth.html"
chmod 0644 "$WEB/auth.html"
cp -f "$WEB/auth.html" "$WEB_ROOT/auth.html"
grep -q '/cadastro.html' "$WEB/auth.html" || die "auth.html sem redirect para cadastro"

log "3/4 UI — index.html (CTA → /cadastro.html)"
dl "deploy/vps-supabase/static/v2/index.html" "$WEB/index.html"
chmod 0644 "$WEB/index.html"
cp -f "$WEB/index.html" "$WEB_ROOT/index.html"
grep -q 'href="/cadastro.html"' "$WEB/index.html" || die "CTA sem /cadastro.html"

log "4/4 nginx — /cadastro e preservar query em /auth"
patched=0
for conf in \
  /etc/nginx/sites-enabled/arbishield.app \
  /etc/nginx/sites-available/arbishield.app \
  /etc/nginx/conf.d/arbishield.app.conf \
  /etc/nginx/conf.d/arbishield-cutover.conf; do
  [[ -f "$conf" ]] || continue
  # /auth deve preservar ?mode= / ?ref=
  if grep -qE 'location = /auth' "$conf"; then
    if grep -qE 'location = /auth \{ return 302 /auth\.html; ?\}' "$conf" \
      || grep -qE 'location = /auth \{ return 302 /auth\.html\$; ?\}' "$conf"; then
      sed -i 's|location = /auth { return 302 /auth\.html; }|location = /auth { return 302 /auth.html$is_args$args; }|g' "$conf" || true
      sed -i 's|location = /auth { return 302 /auth\.html\$; }|location = /auth { return 302 /auth.html$is_args$args; }|g' "$conf" || true
      patched=1
    fi
    if ! grep -qE 'location = /auth \{ return 302 /auth\.html\$is_args\$args; \}' "$conf"; then
      if grep -q 'location = /auth { return 302 /auth.html; }' "$conf"; then
        sed -i 's|location = /auth { return 302 /auth.html; }|location = /auth { return 302 /auth.html$is_args$args; }|' "$conf"
        patched=1
      fi
    fi
  fi
  if ! grep -q 'location = /cadastro' "$conf"; then
    if grep -q 'location = /auth' "$conf"; then
      sed -i '/location = \/auth {/a\    location = /cadastro { return 302 /cadastro.html$is_args$args; }\n    location = /register { return 302 /cadastro.html$is_args$args; }\n    location = /signup { return 302 /cadastro.html$is_args$args; }' "$conf"
      patched=1
    fi
  fi
done
if [[ "$patched" -eq 1 ]] && command -v nginx >/dev/null 2>&1; then
  nginx -t && systemctl reload nginx || die "nginx -t/reload falhou"
fi

log "OK — CTA abre /cadastro.html com formulário de criar conta."
echo "  Teste: https://arbishield.app/cadastro.html"
echo "  Hard refresh (Ctrl+F5) na home."
