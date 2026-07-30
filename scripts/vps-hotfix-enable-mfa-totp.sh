#!/usr/bin/env bash
# Habilita MFA TOTP (Google Authenticator / Authy) no GoTrue + publica UI.
# NÃO encerra a sessão atual — ao CONFIRMAR o 2FA no Perfil, as OUTRAS
# sessões (ex.: Goiânia) caem e a sua sobe para aal2.
#
# Na VPS (root):
#   bash <(curl -fsSL -H "Accept: application/vnd.github.raw" \
#     "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-hotfix-enable-mfa-totp.sh?ref=cursor/protecao-v10-fonte-verdade-501d&t=$(date +%s)")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/protecao-v10-fonte-verdade-501d}"
BUST="$(date +%s)"
API="https://api.github.com/repos/isaacgomes3/exchange/contents"
JSDELIVR="https://cdn.jsdelivr.net/gh/isaacgomes3/exchange@${REF}"
WEB="${ARBISHIELD_WEB:-/var/www/arbishield/v2}"
WEB_ROOT="${ARBISHIELD_WEB_ROOT:-/var/www/arbishield}"
COMPOSE_DIR="${ARBISHIELD_COMPOSE:-/opt/arbishield/deploy/vps-supabase}"
ENV_FILE="${ARBISHIELD_ENV:-$COMPOSE_DIR/.env}"

die() { echo "ERRO: $*" >&2; exit 1; }
log() { echo "==> $*"; }
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
command -v curl >/dev/null || die "curl"
command -v docker >/dev/null || die "docker"
mkdir -p "$WEB"

download() {
  local rel="$1" out="$2" needle="${3:-}"
  local t tmp; t="$(date +%s%N)"; tmp="$(mktemp)"
  if curl -fsSL --retry 3 -H "Accept: application/vnd.github.raw" \
    "$API/$rel?ref=${REF}&t=$t" -o "$tmp" && [[ -s "$tmp" ]]; then
    if [[ -z "$needle" ]] || grep -q "$needle" "$tmp"; then
      install -m 0644 "$tmp" "$out"; rm -f "$tmp"; return 0
    fi
  fi
  if curl -fsSL --retry 3 "$JSDELIVR/$rel?t=$t" -o "$tmp" && [[ -s "$tmp" ]]; then
    if [[ -z "$needle" ]] || grep -q "$needle" "$tmp"; then
      install -m 0644 "$tmp" "$out"; rm -f "$tmp"; return 0
    fi
  fi
  rm -f "$tmp"
  die "nao baixou: $rel"
}

log "1/4 habilitar MFA TOTP no .env + docker-compose"
[[ -f "$ENV_FILE" ]] || die "env não encontrado: $ENV_FILE"
cp -a "$ENV_FILE" "${ENV_FILE}.bak-mfa-$BUST"

# garante vars no .env
python3 - "$ENV_FILE" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8", errors="replace")
wanted = {
    "MFA_TOTP_ENROLL_ENABLED": "true",
    "MFA_TOTP_VERIFY_ENABLED": "true",
    "MFA_MAX_ENROLLED_FACTORS": "5",
}
lines = text.splitlines()
keys_present = set()
out = []
for line in lines:
    raw = line.strip()
    if raw.startswith("#"):
        # descomenta MFA_* se for comentário das vars
        body = raw.lstrip("#").strip()
        if "=" in body:
            k = body.split("=", 1)[0].strip()
            if k in wanted:
                out.append(f"{k}={wanted[k]}")
                keys_present.add(k)
                continue
        out.append(line)
        continue
    if "=" in raw and not raw.startswith("export "):
        k = raw.split("=", 1)[0].strip()
        if k in wanted:
            out.append(f"{k}={wanted[k]}")
            keys_present.add(k)
            continue
    out.append(line)
for k, v in wanted.items():
    if k not in keys_present:
        out.append(f"{k}={v}")
path.write_text("\n".join(out) + "\n", encoding="utf-8")
print("env MFA ok")
PY

COMPOSE="$COMPOSE_DIR/docker-compose.yml"
if [[ -f "$COMPOSE" ]]; then
  cp -a "$COMPOSE" "${COMPOSE}.bak-mfa-$BUST"
  python3 - "$COMPOSE" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8", errors="replace")
# descomenta linhas GOTRUE_MFA_TOTP_* e MAX
replacements = [
    ("# GOTRUE_MFA_TOTP_ENROLL_ENABLED: ${MFA_TOTP_ENROLL_ENABLED}",
     "GOTRUE_MFA_TOTP_ENROLL_ENABLED: ${MFA_TOTP_ENROLL_ENABLED}"),
    ("# GOTRUE_MFA_TOTP_VERIFY_ENABLED: ${MFA_TOTP_VERIFY_ENABLED}",
     "GOTRUE_MFA_TOTP_VERIFY_ENABLED: ${MFA_TOTP_VERIFY_ENABLED}"),
    ("# GOTRUE_MFA_MAX_ENROLLED_FACTORS: ${MFA_MAX_ENROLLED_FACTORS}",
     "GOTRUE_MFA_MAX_ENROLLED_FACTORS: ${MFA_MAX_ENROLLED_FACTORS}"),
]
for a, b in replacements:
    text = text.replace(a, b)
# se inject direto no bloco auth caso ainda não exista
if "GOTRUE_MFA_TOTP_ENROLL_ENABLED" not in text.replace("# GOTRUE_MFA_TOTP_ENROLL_ENABLED", ""):
    needle = "GOTRUE_JWT_EXP: ${JWT_EXPIRY}"
    inject = (
        "GOTRUE_JWT_EXP: ${JWT_EXPIRY}\n"
        "      GOTRUE_MFA_TOTP_ENROLL_ENABLED: ${MFA_TOTP_ENROLL_ENABLED:-true}\n"
        "      GOTRUE_MFA_TOTP_VERIFY_ENABLED: ${MFA_TOTP_VERIFY_ENABLED:-true}\n"
        "      GOTRUE_MFA_MAX_ENROLLED_FACTORS: ${MFA_MAX_ENROLLED_FACTORS:-5}"
    )
    if needle in text:
        text = text.replace(needle, inject, 1)
path.write_text(text, encoding="utf-8")
print("compose MFA ok")
PY
fi

log "2/4 reiniciar auth (GoTrue) — sessões atuais NÃO são apagadas por isso"
(
  cd "$COMPOSE_DIR"
  docker compose up -d auth 2>/dev/null || docker compose up -d gotrue 2>/dev/null || true
  # nomes comuns
  for c in $(docker ps --format '{{.Names}}' | grep -Ei 'auth|gotrue' || true); do
    docker restart "$c" 2>/dev/null || true
  done
)
sleep 2

log "3/4 publicar UI (perfil 2FA + login challenge)"
download "deploy/vps-supabase/static/v2/v2-perfil.js" "$WEB/v2-perfil.js" "mfa-totp-enroll-v1"
download "deploy/vps-supabase/static/v2/auth.html" "$WEB/auth.html" "mfa-totp-challenge-v1"
download "deploy/vps-supabase/static/v2/app-perfil.html" "$WEB/app-perfil.html" "v2-perfil.js"
install -m 0644 "$WEB/v2-perfil.js" "$WEB_ROOT/v2-perfil.js" 2>/dev/null || true
install -m 0644 "$WEB/auth.html" "$WEB_ROOT/auth.html" 2>/dev/null || true
install -m 0644 "$WEB/app-perfil.html" "$WEB_ROOT/app-perfil.html" 2>/dev/null || true
sed -i -E "s|/v2-perfil\\.js(\\?[^\"]*)?|/v2-perfil.js?v=mfa-$BUST|g; s|/v2\\.js(\\?[^\"]*)?|/v2.js?v=mfa-$BUST|g" \
  "$WEB/app-perfil.html" "$WEB_ROOT/app-perfil.html" "$WEB/auth.html" "$WEB_ROOT/auth.html" 2>/dev/null || true
chmod 0644 "$WEB/v2-perfil.js" "$WEB/auth.html" "$WEB/app-perfil.html" 2>/dev/null || true

log "4/4 checar MFA enroll endpoint"
code="$(curl -sS -o /tmp/mfa-enroll.json -w '%{http_code}' -m 10 -X POST \
  -H 'Content-Type: application/json' -H 'apikey: x' \
  -d '{"factor_type":"totp"}' \
  http://127.0.0.1:8000/auth/v1/factors 2>/dev/null || echo 000)"
echo "  POST /auth/v1/factors → HTTP $code (401 sem token = rota MFA viva; 422 enroll disabled = ainda off)"
head -c 200 /tmp/mfa-enroll.json 2>/dev/null; echo

echo
echo "OK — MFA TOTP habilitado."
echo "Na SUA sessão (seu PC):"
echo "  1) Abra https://arbishield.app/app-perfil.html"
echo "  2) Clique em Ativar 2FA → escaneie o QR no Google Authenticator/Authy"
echo "  3) Digite o código de 6 dígitos"
echo "Ao confirmar: OUTRAS sessões caem; a SUA continua logada com 2FA."
echo "Próximos logins pedirão senha + código."
