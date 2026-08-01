#!/usr/bin/env bash
# Sandbox SIMPLES em https://arbishield.app/sandbox/
# Sem DNS. Sem porta nova. Sem firewall. Sem túnel SSH.
#
# Na VPS (root):
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/ambiente-teste-3cf9/scripts/vps-enable-sandbox.sh?v=1")
#
# Publicar de novo:
#   ARBISHIELD_REF=<branch> bash /opt/arbishield/scripts/vps-deploy-sandbox.sh
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/ambiente-teste-3cf9}"
REF="${ARBISHIELD_REF:-main}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }

need curl
need nginx
[[ "$(id -u)" -eq 0 ]] || die "rode como root"
mkdir -p "$SCRIPTS_DIR"

log "Baixar scripts sandbox (ref=$REF)"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/vps-deploy-sandbox.sh" -o "$SCRIPTS_DIR/vps-deploy-sandbox.sh"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/vps-enable-sandbox.sh" -o "$SCRIPTS_DIR/vps-enable-sandbox.sh"
chmod 0755 "$SCRIPTS_DIR/vps-deploy-sandbox.sh" "$SCRIPTS_DIR/vps-enable-sandbox.sh"

log "Publicar arquivos em /sandbox/"
ARBISHIELD_REF="$REF" ARBISHIELD_BRANCH="$BRANCH" bash "$SCRIPTS_DIR/vps-deploy-sandbox.sh"

# Injeta location /sandbox/ no nginx de produção (uma vez)
patch_nginx() {
  local conf=""
  for c in \
    /etc/nginx/sites-available/arbishield.app \
    /etc/nginx/conf.d/arbishield-cutover.conf \
    /etc/nginx/conf.d/arbishield.app.conf \
    /etc/nginx/sites-enabled/arbishield.app
  do
    if [[ -f "$c" ]] && grep -q 'arbishield' "$c" 2>/dev/null; then
      conf="$c"
      break
    fi
  done
  if [[ -z "$conf" ]]; then
    # fallback: procura root v2
    conf="$(grep -rl 'root /var/www/arbishield/v2' /etc/nginx 2>/dev/null | head -1 || true)"
  fi
  [[ -n "$conf" && -f "$conf" ]] || die "não achei nginx da produção para patchar"

  if grep -q 'location \^~ /sandbox/' "$conf"; then
    log "nginx já tem /sandbox/ ($conf)"
    return
  fi

  log "Inserir location /sandbox/ em $conf"
  python3 - "$conf" <<'PY'
import sys
path = sys.argv[1]
text = open(path, encoding="utf-8").read()
block = """
    # Sandbox de teste (UI isolada; sem DNS/porta)
    location ^~ /sandbox/ {
        alias /var/www/arbishield/sandbox/;
        add_header X-ArbiShield-Site "sandbox" always;
        add_header Cache-Control "no-store";
        try_files $uri $uri/ =404;
    }
"""
# Insere antes do location /assets/ ou do location /
needle = None
for n in ("    location /assets/ {", "    location / {"):
    if n in text:
        needle = n
        break
if not needle:
    raise SystemExit("não achei ponto de inserção no nginx")
if "location ^~ /sandbox/" in text:
    print("já existe")
else:
    text = text.replace(needle, block + "\n" + needle, 1)
    open(path, "w", encoding="utf-8").write(text)
    print("patched", path)
PY
  nginx -t || die "nginx -t falhou após patch"
  systemctl reload nginx
  log "nginx reload OK"
}

patch_nginx

echo
echo "OK — sandbox pronto (produção de páginas normais intacta)"
echo "  Abra: https://arbishield.app/sandbox/admin-jogos.html"
echo "  (Ctrl+F5)"
echo
echo "Atualizar sandbox:"
echo "  ARBISHIELD_REF=<branch> bash $SCRIPTS_DIR/vps-deploy-sandbox.sh"
