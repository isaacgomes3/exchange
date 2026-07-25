#!/usr/bin/env bash
# Proteção fee_upfront_v1 — SÓ no sandbox/teste (:3198 + /sandbox/)
# NÃO altera o worker de produção :3098.
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/protecao-fee-upfront-3cf9/scripts/vps-hotfix-protecao-fee-upfront.sh?v=2")
set -euo pipefail

REF="${ARBISHIELD_REF:-cursor/protecao-fee-upfront-3cf9}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${REF}"
TESTE_DIR="${ARBISHIELD_TESTE_DIR:-/opt/arbishield-teste}"
TESTE_SCRIPTS="$TESTE_DIR/scripts"
SANDBOX_WEB="${ARBISHIELD_SANDBOX_WEB:-/var/www/arbishield/sandbox}"
PROD_SCRIPTS="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
need nginx
[[ "$(id -u)" -eq 0 ]] || die "rode como root"

mkdir -p "$TESTE_SCRIPTS" "$SANDBOX_WEB" "$PROD_SCRIPTS"

log "1) Worker TESTE :3198 (produção :3098 intacta)"
curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 \
  "$RAW/scripts/arbishield-prelive-events.mjs" \
  -o "$TESTE_SCRIPTS/arbishield-prelive-events.mjs"
chmod 0755 "$TESTE_SCRIPTS/arbishield-prelive-events.mjs"
grep -q 'fee_upfront_v1' "$TESTE_SCRIPTS/arbishield-prelive-events.mjs" \
  || die "prelive teste sem fee_upfront_v1"
grep -qE 'protection-fee-upfront-v[0-9]+' "$TESTE_SCRIPTS/arbishield-prelive-events.mjs" \
  || die "prelive teste sem marker health"

# Unit teste (sempre atualiza unit + marker SANDBOX)
curl -fsSL "$RAW/deploy/vps-supabase/arbishield-prelive-events-teste.service" \
  -o /etc/systemd/system/arbishield-prelive-events-teste.service
systemctl daemon-reload
systemctl enable arbishield-prelive-events-teste.service
systemctl restart arbishield-prelive-events-teste.service
sleep 1
BODY="$(curl -fsS --max-time 5 http://127.0.0.1:3198/health || true)"
echo "$BODY" | grep -qE 'protection-fee-upfront-v[0-9]+' \
  || die "health :3198 sem protection-fee-upfront: $BODY"
log "health :3198 OK ($BODY)"

# Produção ainda no marker antigo?
PROD_H="$(curl -fsS --max-time 5 http://127.0.0.1:3098/health || true)"
if echo "$PROD_H" | grep -qE 'protection-fee-upfront-v[0-9]+'; then
  die "ABORTADO: produção :3098 já tem fee_upfront — não era para alterar prod"
fi
log "produção :3098 intacta ($(echo "$PROD_H" | head -c 120))"

log "2) UI sandbox + API prefix /__sandbox_api → :3198"
curl -fsSL "$RAW/scripts/vps-deploy-sandbox.sh" -o "$PROD_SCRIPTS/vps-deploy-sandbox.sh"
chmod 0755 "$PROD_SCRIPTS/vps-deploy-sandbox.sh"
ARBISHIELD_REF="$REF" bash "$PROD_SCRIPTS/vps-deploy-sandbox.sh"

# Força API do sandbox para o worker teste (+ garante app-proteger com API_BASE)
python3 - "$SANDBOX_WEB" <<'PY'
from pathlib import Path
import sys
root = Path(sys.argv[1])
for path in list(root.glob("*.html")) + list(root.glob("*.js")):
    t = path.read_text(encoding="utf-8", errors="replace")
    n = t.replace('"/api/arbishield/', '"/__sandbox_api/arbishield/')
    n = n.replace("'/api/arbishield/", "'/__sandbox_api/arbishield/")
    n = n.replace("`/api/arbishield/", "`/__sandbox_api/arbishield/")
    if n != t:
        path.write_text(n, encoding="utf-8")
        print("  api→sandbox", path.name)

prot = root / "app-proteger.html"
if not prot.exists():
    raise SystemExit("app-proteger.html ausente no sandbox")
pt = prot.read_text(encoding="utf-8", errors="replace")
if "fee_upfront" not in pt and "calcFeeUpfront" not in pt:
    raise SystemExit("sandbox app-proteger sem fee_upfront — ref errada?")
if "__sandbox_api" not in pt and 'API_BASE = IS_SANDBOX' not in pt:
    # fallback: injeta base se a página antiga ainda aponta /api/
    if '"/api/arbishield/' in pt or "'/api/arbishield/" in pt:
        raise SystemExit("sandbox app-proteger ainda chama /api/arbishield/")
print("  OK app-proteger sandbox (fee_upfront + API sandbox)")
PY

# Nginx: location /__sandbox_api/ → 3198
CONF=""
for c in \
  /etc/nginx/sites-available/arbishield.app \
  /etc/nginx/conf.d/arbishield-cutover.conf \
  /etc/nginx/conf.d/arbishield.app.conf \
  /etc/nginx/sites-enabled/arbishield.app
do
  [[ -f "$c" ]] && CONF="$c" && break
done
[[ -n "$CONF" ]] || CONF="$(grep -rl 'root /var/www/arbishield/v2' /etc/nginx 2>/dev/null | head -1 || true)"
[[ -n "$CONF" && -f "$CONF" ]] || die "nginx prod não encontrado"

if ! grep -q 'location \^~ /__sandbox_api/' "$CONF"; then
  log "Inserir /__sandbox_api/ em $CONF"
  python3 - "$CONF" <<'PY'
import sys
path = sys.argv[1]
text = open(path, encoding="utf-8").read()
block = """
    # Sandbox API → worker teste :3198 (produção :3098 intacta)
    location ^~ /__sandbox_api/ {
        rewrite ^/__sandbox_api/(.*)$ /$1 break;
        proxy_pass http://127.0.0.1:3198;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_pass_request_headers on;
        proxy_read_timeout 120s;
    }
"""
needle = None
for n in ("    location ^~ /sandbox/", "    location /assets/ {", "    location / {"):
    if n in text:
        needle = n
        break
if not needle:
    raise SystemExit("ponto de inserção nginx não encontrado")
if "location ^~ /__sandbox_api/" not in text:
    text = text.replace(needle, block + "\n" + needle, 1)
    open(path, "w", encoding="utf-8").write(text)
    print("patched")
else:
    print("already")
PY
  nginx -t || die "nginx -t falhou"
  systemctl reload nginx
else
  log "nginx já tem /__sandbox_api/"
fi

# Garantir /sandbox/ location
if ! grep -q 'location \^~ /sandbox/' "$CONF"; then
  log "sandbox location ausente — rode também vps-enable-sandbox.sh"
fi

echo
echo "OK — fee_upfront só no SANDBOX"
echo "  Teste: https://arbishield.app/sandbox/app-proteger.html"
echo "  Worker teste: :3198 · Produção: :3098 (antiga)"
echo "  Ex.: odd 1,10 · stake R\$ 1.000 → cobra R\$ 85 agora; stake NÃO trava"
