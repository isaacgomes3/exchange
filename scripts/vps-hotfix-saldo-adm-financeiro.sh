#!/usr/bin/env bash
# Hotfix: inserir/alterar saldo para adm financeiro (Usuários + shim)
#
# Liberado apenas para a allowlist Financeiro (isaac + financeiro@).
# Demais admins continuam sem o painel/API de ajuste.
#
# Corrige 405 Not Allowed: Nginx precisa proxyar POST /api/arbishield/adjust-balance
# para o shim :3101 (senão cai no try_files estático → 405).
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/ajuste-saldo-405-84e5/scripts/vps-hotfix-saldo-adm-financeiro.sh?v=4")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/ajuste-saldo-405-84e5}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
CACHE_V="users-saldo-fin-4"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
need python3
mkdir -p "$WEB" "$SCRIPTS_DIR" "$WEB_ROOT"

log "resolvendo tip de $BRANCH"
SHA="$(
  curl -fsSL "https://api.github.com/repos/isaacgomes3/exchange/commits/${BRANCH}" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["sha"])'
)"
log "tip=$SHA"
RAW_JS="https://cdn.jsdelivr.net/gh/isaacgomes3/exchange@${SHA}"
RAW_GH="https://raw.githubusercontent.com/isaacgomes3/exchange/${SHA}"

fetch() {
  local rel="$1" dest="$2"
  if curl -fsSL "${RAW_JS}/${rel}" -o "$dest"; then return 0; fi
  curl -fsSL "${RAW_GH}/${rel}?t=$(date +%s)" -o "$dest"
}

log "admin-users.html (painel inserir/alterar saldo)"
fetch "deploy/vps-supabase/static/v2/admin-users.html" "$WEB/admin-users.html"
chmod 0644 "$WEB/admin-users.html"
cp -f "$WEB/admin-users.html" "$WEB_ROOT/admin-users.html" 2>/dev/null || true
grep -q 'adjust-balance\|Ajuste de' "$WEB/admin-users.html" || die "admin-users sem painel de saldo"
grep -q 'canAccessFinance' "$WEB/admin-users.html" || die "admin-users sem gate financeiro"
grep -q 'API de ajuste indisponível' "$WEB/admin-users.html" || log "aviso: UI sem mensagem amigável 405 (ok se tip antigo)"

# cache-bust local
sed -i -E \
  -e "s|/v2\\.css(\\?[^\"]*)?|/v2.css?v=${CACHE_V}|g" \
  -e "s|/v2\\.js(\\?[^\"]*)?|/v2.js?v=${CACHE_V}|g" \
  -e "s|/v2-shell\\.js(\\?[^\"]*)?|/v2-shell.js?v=${CACHE_V}|g" \
  -e "s|/finance-admins\\.js(\\?[^\"]*)?|/finance-admins.js?v=${CACHE_V}|g" \
  "$WEB/admin-users.html" || true
cp -f "$WEB/admin-users.html" "$WEB_ROOT/admin-users.html" 2>/dev/null || true

# Shim
EXEC_LINE="$(systemctl show -p ExecStart --value arbishield-serverfn-shim.service 2>/dev/null || true)"
SHIM_PATH=""
if [[ "$EXEC_LINE" == *arbishield-serverfn-shim.mjs* ]]; then
  SHIM_PATH="$(echo "$EXEC_LINE" | grep -oE '/[^ ]+arbishield-serverfn-shim\.mjs' | head -1 || true)"
fi
if [[ -z "${SHIM_PATH:-}" ]]; then
  for c in "$SCRIPTS_DIR/arbishield-serverfn-shim.mjs" /opt/arbishield/arbishield-serverfn-shim.mjs /opt/arbishield/scripts/arbishield-serverfn-shim.mjs; do
    [[ -f "$c" ]] && SHIM_PATH="$c" && break
  done
fi
[[ -n "${SHIM_PATH:-}" ]] || SHIM_PATH="$SCRIPTS_DIR/arbishield-serverfn-shim.mjs"
mkdir -p "$(dirname "$SHIM_PATH")"
log "Atualizando shim em $SHIM_PATH"
fetch "scripts/arbishield-serverfn-shim.mjs" "$SHIM_PATH"
chmod 0644 "$SHIM_PATH"
grep -q 'adjustAdminBalance' "$SHIM_PATH" || die "shim sem adjustAdminBalance"
grep -q '/api/arbishield/adjust-balance' "$SHIM_PATH" || die "shim sem rota adjust-balance"
grep -q 'requireFinanceAdmin' "$SHIM_PATH" || die "shim sem requireFinanceAdmin"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true

# Nginx — descobrir conf real (na VPS costuma ser conf.d/arbishield-cutover.conf)
log "Patching nginx: location exact adjust-balance → shim"
discover_nginx_confs() {
  local -a candidates=()
  local f
  for f in \
    /etc/nginx/conf.d/arbishield-cutover.conf \
    /etc/nginx/conf.d/arbishield.app.conf \
    /etc/nginx/conf.d/arbishield.conf \
    /etc/nginx/sites-enabled/arbishield.app \
    /etc/nginx/sites-enabled/arbishield.app.conf \
    /etc/nginx/sites-enabled/arbishield \
    /etc/nginx/sites-available/arbishield.app \
    /etc/nginx/sites-available/arbishield.app.conf \
    /etc/nginx/sites-available/arbishield \
    /etc/nginx/sites-enabled/teste.arbishield.app \
    /etc/nginx/sites-enabled/teste.arbishield.app.conf \
    /etc/nginx/sites-available/teste.arbishield.app \
    /etc/nginx/sites-available/teste.arbishield.app.conf \
    /etc/nginx/conf.d/teste.arbishield.app.conf
  do
    [[ -f "$f" ]] && candidates+=("$f")
  done
  # procura por conteúdo típico do site (nome do arquivo varia)
  while IFS= read -r f; do
    [[ -n "$f" && -f "$f" ]] || continue
    candidates+=("$f")
  done < <(
    grep -RIlE 'server_name[[:space:]]+.*arbishield\.app|root[[:space:]]+/var/www/arbishield|127\.0\.0\.1:3101|desafio-settle' \
      /etc/nginx 2>/dev/null | head -40 || true
  )
  # nginx -T → "# configuration file /path:"
  if command -v nginx >/dev/null 2>&1; then
    while IFS= read -r f; do
      [[ -n "$f" && -f "$f" ]] || continue
      candidates+=("$f")
    done < <(
      nginx -T 2>&1 | sed -n 's/^# configuration file \(.*\):$/\1/p' \
        | grep -E 'arbishield|cutover|conf\.d|sites-' || true
    )
  fi
  # dedupe
  printf '%s\n' "${candidates[@]:-}" | awk 'NF && !seen[$0]++'
}

patch_nginx_conf() {
  local conf="$1"
  python3 - "$conf" <<'PY'
import re, sys
path = sys.argv[1]
text = open(path, encoding="utf-8").read()
orig = text
changed = []

def add_to_regex(m):
    body = m.group(0)
    if "adjust-balance" in body:
        return body
    for needle in (
        "contestations/pending-count",
        "match-settle",
        "desafio-settle",
    ):
        if needle in body:
            return body.replace(needle, needle + "|adjust-balance|admin-adjust-balance", 1)
    # fallback: antes do )$
    return re.sub(r"\)\$", "|adjust-balance|admin-adjust-balance)$", body, count=1)

new_text, n = re.subn(
    r"location\s+~\s+\^/api/arbishield/\([^)]+\)\$\s*\{",
    add_to_regex,
    text,
    count=1,
)
if n and new_text != text:
    text = new_text
    changed.append("regex")

if "location = /api/arbishield/adjust-balance" not in text:
    port = "3201" if ("teste" in path or ":3201" in text) else "3101"
    # se o conf já aponta 3101/3201 no proxy do shim, preferir essa porta
    if "127.0.0.1:3201" in text and "127.0.0.1:3101" not in text:
        port = "3201"
    elif "127.0.0.1:3101" in text:
        port = "3101"
    block = """
    # Ajuste de saldo (adm financeiro) → shim :%(port)s (exact match evita try_files / 405)
    location = /api/arbishield/adjust-balance {
        proxy_pass http://127.0.0.1:%(port)s;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_pass_request_headers on;
        proxy_read_timeout 120s;
    }
    location = /api/arbishield/admin-adjust-balance {
        proxy_pass http://127.0.0.1:%(port)s;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_pass_request_headers on;
        proxy_read_timeout 120s;
    }
""" % {"port": port}
    inserted = False
    for anchor in (
        "location = /api/arbishield/match-settle",
        "location = /api/arbishield/dashboard-stats",
        "location ^~ /api/arbishield/contestations",
        "location ^~ /_serverFn/",
        "location /api/arbishield/",
    ):
        idx = text.find(anchor)
        if idx < 0:
            continue
        text = text[:idx] + block + "\n    " + text[idx:]
        changed.append("exact@" + anchor.split("/")[-1].rstrip("{").strip())
        inserted = True
        break
    if not inserted:
        m = re.search(r"\n\s*location / \{", text)
        if m:
            text = text[: m.start()] + "\n" + block + text[m.start() :]
            changed.append("exact@location/")
        else:
            print("FAIL: sem âncora para inserir location exact")
            sys.exit(2)

if text != orig:
    open(path, "w", encoding="utf-8").write(text)
    print("patched:" + ",".join(changed) if changed else "patched")
else:
    if "location = /api/arbishield/adjust-balance" in text or "adjust-balance" in text:
        print("ok-already")
    else:
        print("FAIL: adjust-balance ausente após patch")
        sys.exit(3)
PY
}

mapfile -t NGINX_CONFS < <(discover_nginx_confs)
if [[ "${#NGINX_CONFS[@]}" -eq 0 ]]; then
  log "diagnóstico /etc/nginx:"
  ls -la /etc/nginx /etc/nginx/conf.d /etc/nginx/sites-enabled /etc/nginx/sites-available 2>/dev/null || true
  # republicar canônico no path padrão da VPS
  CUTOVER="/etc/nginx/conf.d/arbishield-cutover.conf"
  mkdir -p /etc/nginx/conf.d
  tmp="$(mktemp)"
  fetch "deploy/vps-supabase/nginx-arbishield.app.conf" "$tmp"
  grep -q 'adjust-balance' "$tmp" || die "conf canônico sem adjust-balance"
  if [[ -f "$CUTOVER" ]]; then
    cp -a "$CUTOVER" "${CUTOVER}.bak-adjust-balance-$(date +%s)"
  fi
  cp -f "$tmp" "$CUTOVER"
  rm -f "$tmp"
  log "republicado conf canônico → $CUTOVER"
  NGINX_CONFS=("$CUTOVER")
fi

NGINX_PATCHED=0
for conf in "${NGINX_CONFS[@]}"; do
  [[ -f "$conf" ]] || continue
  # só patchar confs que parecem ser o site arbishield (evita botshield etc.)
  if ! grep -qE 'arbishield\.app|/var/www/arbishield|desafio-settle|127\.0\.0\.1:3101|127\.0\.0\.1:3201' "$conf"; then
    log "nginx skip (não parece arbishield): $conf"
    continue
  fi
  log "nginx: $conf"
  cp -a "$conf" "${conf}.bak-adjust-balance-$(date +%s)" 2>/dev/null || true
  OUT="$(patch_nginx_conf "$conf")" || die "falha ao patchar $conf"
  log "  $OUT"
  NGINX_PATCHED=1
  grep -qE 'adjust-balance' "$conf" \
    || die "nginx $conf ainda sem adjust-balance"
done

if [[ "$NGINX_PATCHED" -eq 0 ]]; then
  log "diagnóstico /etc/nginx:"
  ls -la /etc/nginx/conf.d /etc/nginx/sites-enabled /etc/nginx/sites-available 2>/dev/null || true
  grep -RIl '3101\|arbishield.app' /etc/nginx 2>/dev/null | head -20 || true
  die "nenhum conf nginx do arbishield encontrado/patchado"
fi

if command -v nginx >/dev/null; then
  nginx -t && systemctl reload nginx || die "nginx -t / reload falhou"
  log "nginx reload ok"
fi

# Smoke shim com retry (restart pode demorar)
log "Smoke :3101 adjust-balance (sem token → Não autorizado)"
SMOKE=""
for i in 1 2 3 4 5 6 7 8; do
  SMOKE="$(curl -sS -m 3 -X POST http://127.0.0.1:3101/api/arbishield/adjust-balance \
    -H 'Content-Type: application/json' -d '{}' 2>/dev/null || true)"
  if echo "$SMOKE" | grep -Eqi 'Não autorizado|Unauthorized|token|negado|permiss'; then
    log "smoke ok (tentativa $i): $SMOKE"
    break
  fi
  if echo "$SMOKE" | grep -q 'not_found'; then
    die "shim ainda responde not_found — rota adjust-balance ausente no processo"
  fi
  sleep 1
done
if ! echo "$SMOKE" | grep -Eqi 'Não autorizado|Unauthorized|token|negado|permiss'; then
  systemctl is-active arbishield-serverfn-shim.service >/dev/null 2>&1 \
    || die "shim inativo (systemctl). status: $(systemctl is-active arbishield-serverfn-shim.service 2>/dev/null || echo unknown)"
  die "smoke falhou após retries. resposta: ${SMOKE:-<vazio/conexão recusada>}"
fi

# Smoke via nginx local (se possível) — confirma que não é mais 405
if command -v nginx >/dev/null; then
  for host in arbishield.app 127.0.0.1; do
    CODE="$(curl -sS -m 5 -o /tmp/adj-bal-nginx.json -w '%{http_code}' \
      -X POST "https://${host}/api/arbishield/adjust-balance" \
      -H 'Content-Type: application/json' -H "Host: arbishield.app" \
      -d '{}' -k 2>/dev/null || true)"
    BODY="$(head -c 180 /tmp/adj-bal-nginx.json 2>/dev/null || true)"
    if [[ "$CODE" == "405" ]]; then
      die "nginx ainda retorna 405 em POST /api/arbishield/adjust-balance (host=$host). Confira location exact no conf ativo."
    fi
    if [[ -n "$CODE" && "$CODE" != "000" ]]; then
      log "smoke nginx $host → HTTP $CODE ${BODY}"
      break
    fi
  done
fi

log "OK — saldo adm financeiro (hotfix 405)"
log "  UI: /admin-users.html (Ctrl+F5)"
log "  API: POST /api/arbishield/adjust-balance → shim :3101"
log "  liberados: isaacgomes3@gmail.com, financeiro@arbishield.com"
