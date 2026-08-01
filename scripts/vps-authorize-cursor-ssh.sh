#!/usr/bin/env bash
# Autoriza chave SSH pública de um Cursor Cloud Agent na VPS (root).
#
# Uso (já logado na VPS como root):
#   PUBKEY='ssh-ed25519 AAAA... comment' bash scripts/vps-authorize-cursor-ssh.sh
#
# Ou via API GitHub (ref = branch/main):
#   PUBKEY='ssh-ed25519 AAAA... comment' bash <(curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
#     "https://api.github.com/repos/isaacgomes3/exchange/contents/scripts/vps-authorize-cursor-ssh.sh?ref=${ARBISHIELD_REF:-main}&t=$(date +%s%N)" \
#     -H "Accept: application/vnd.github.raw" -H "User-Agent: arbishield-ssh")
#
# Remover depois:
#   REMOVE=1 PUBKEY='ssh-ed25519 AAAA... comment' bash scripts/vps-authorize-cursor-ssh.sh
#
# Marker: cursor-agent-ssh-authorize-v1
set -euo pipefail

PUBKEY="${PUBKEY:-${1:-}}"
AUTH_FILE="${AUTH_FILE:-/root/.ssh/authorized_keys}"
MARKER_PREFIX="cursor-agent"

if [[ -z "$PUBKEY" ]]; then
  echo "ERRO: informe PUBKEY='ssh-ed25519 AAAA... comment'"
  echo "Ex.: PUBKEY=\"\$(cat agent.pub)\" bash $0"
  exit 1
fi

# Normaliza: uma linha, sem espaços extras no meio do tipo/chave
PUBKEY="$(echo "$PUBKEY" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
if ! echo "$PUBKEY" | grep -Eq '^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256) [A-Za-z0-9+/=]+'; then
  echo "ERRO: PUBKEY não parece uma chave SSH pública válida"
  exit 1
fi

KEY_BODY="$(echo "$PUBKEY" | awk '{print $2}')"
mkdir -p "$(dirname "$AUTH_FILE")"
chmod 700 "$(dirname "$AUTH_FILE")"
touch "$AUTH_FILE"
chmod 600 "$AUTH_FILE"

if [[ "${REMOVE:-0}" == "1" || "${REMOVE:-}" == "true" ]]; then
  if grep -Fq "$KEY_BODY" "$AUTH_FILE"; then
    tmp="$(mktemp)"
    grep -Fv "$KEY_BODY" "$AUTH_FILE" > "$tmp" || true
    mv "$tmp" "$AUTH_FILE"
    chmod 600 "$AUTH_FILE"
    echo "OK: chave removida de $AUTH_FILE"
  else
    echo "OK: chave já não estava em $AUTH_FILE"
  fi
  exit 0
fi

if grep -Fq "$KEY_BODY" "$AUTH_FILE"; then
  echo "OK: chave já autorizada em $AUTH_FILE"
else
  # Comentário de auditoria se a pubkey não trouxer
  if [[ "$PUBKEY" != *" "* ]]; then
    echo "ERRO: chave incompleta"
    exit 1
  fi
  comment="$(echo "$PUBKEY" | awk '{print $3}')"
  if [[ -z "$comment" ]]; then
    PUBKEY="$PUBKEY ${MARKER_PREFIX}-$(date -u +%Y%m%d)"
  fi
  printf '%s\n' "$PUBKEY" >> "$AUTH_FILE"
  chmod 600 "$AUTH_FILE"
  echo "OK: chave adicionada em $AUTH_FILE"
fi

echo "Linhas authorized_keys: $(wc -l < "$AUTH_FILE")"
echo "Fingerprint:"
ssh-keygen -lf <(echo "$PUBKEY") 2>/dev/null || true
echo "Teste do agente: ssh -i ~/.ssh/arbishield_vps root@195.200.6.206 'hostname && whoami'"
