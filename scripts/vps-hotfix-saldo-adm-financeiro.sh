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
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/ajuste-saldo-405-84e5/scripts/vps-hotfix-saldo-adm-financeiro.sh?v=5")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/ajuste-saldo-405-84e5}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS:-/opt/arbishield/scripts}"
CACHE_V="users-saldo-fin-5"
CUTOVER="${ARBISHIELD_NGINX_CONF:-/etc/nginx/conf.d/arbishield-cutover.conf}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
need python3
mkdir -p "$WEB" "$SCRIPTS_DIR" "$WEB_ROOT"

is_bak() {
  [[ "$1" == *".bak"* || "$1" == *~ || "$1" == *.old || "$1" == *.orig ]]
}

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

# ---------------------------------------------------------------------------
# Nginx: só confs ATIVOS (nunca .bak). Preferir cutover + o que o nginx -T carrega.
# ---------------------------------------------------------------------------
log "nginx: localizar conf ativo de arbishield.app (sem .bak)"

ACTIVE_CONFS=()
add_conf() {
  local f="$1"
  [[ -n "$f" && -f "$f" ]] || return 0
  is_bak "$f" && return 0
  # só arquivos “vivos” em conf.d (terminam em .conf) ou sites-*
  case "$f" in
    *.conf|*/sites-enabled/*|*/sites-available/*) ;;
    *) return 0 ;;
  esac
  local x
  for x in "${ACTIVE_CONFS[@]:-}"; do
    [[ "$x" == "$f" ]] && return 0
  done
  ACTIVE_CONFS+=("$f")
}

add_conf "$CUTOVER"
add_conf /etc/nginx/conf.d/arbishield.app.conf
add_conf /etc/nginx/sites-enabled/arbishield.app
add_conf /etc/nginx/sites-available/arbishield.app

if command -v nginx >/dev/null 2>&1; then
  while IFS= read -r f; do
    add_conf "$f"
  done < <(
    nginx -T 2>&1 \
      | sed -n 's/^# configuration file \(.*\):$/\1/p' \
      | grep -E '/(conf\.d|sites-enabled|sites-available)/' \
      | grep -Ei 'arbishield|cutover' \
      || true
  )
fi

# se cutover não existe, republicar canônico
if [[ ! -f "$CUTOVER" ]]; then
  log "cutover ausente — republicando canônico em $CUTOVER"
  mkdir -p "$(dirname "$CUTOVER")"
  tmp="$(mktemp)"
  fetch "deploy/vps-supabase/nginx-arbishield.app.conf" "$tmp"
  grep -q 'adjust-balance' "$tmp" || die "conf canônico sem adjust-balance"
  cp -f "$tmp" "$CUTOVER"
  rm -f "$tmp"
  add_conf "$CUTOVER"
fi

[[ "${#ACTIVE_CONFS[@]}" -gt 0 ]] || die "nenhum conf nginx ativo encontrado"

log "nginx ativos a patchar:"
for f in "${ACTIVE_CONFS[@]}"; do echo "  - $f"; done

patch_one() {
  python3 - "$1" <<'PY'
import re, sys
path = sys.argv[1]
text = open(path, encoding="utf-8").read()
orig = text
changed = []

# regex shim
def add_to_regex(m):
    body = m.group(0)
    if "adjust-balance" in body:
        return body
    for needle in ("contestations/pending-count", "match-settle", "desafio-settle"):
        if needle in body:
            return body.replace(needle, needle + "|adjust-balance|admin-adjust-balance", 1)
    return re.sub(r"\)\$", "|adjust-balance|admin-adjust-balance)$", body, count=1)

new_text, n = re.subn(
    r"location\s+~\s+\^/api/arbishield/\([^)]+\)\$\s*\{",
    add_to_regex,
    text,
    count=0,  # todas as ocorrências (vários server blocks)
)
if n and new_text != text:
    text = new_text
    changed.append("regexx%d" % n)

port = "3101"
if "127.0.0.1:3201" in text and "teste" in path:
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

def insert_into_ssl_server(src):
    """Insere location = no server{ listen 443; server_name ...arbishield.app }."""
    if "location = /api/arbishield/adjust-balance" in src:
        return src, False

    # achar server blocks
    parts = []
    i = 0
    inserted = False
    while True:
        m = re.search(r"\bserver\s*\{", src[i:])
        if not m:
            parts.append(src[i:])
            break
        start = i + m.start()
        parts.append(src[i:start])
        # scan braces
        j = i + m.end() - 1  # at '{'
        depth = 0
        k = j
        while k < len(src):
            if src[k] == "{":
                depth += 1
            elif src[k] == "}":
                depth -= 1
                if depth == 0:
                    k += 1
                    break
            k += 1
        block_text = src[start:k]
        i = k

        is_ssl = bool(re.search(r"listen\s+[^;]*443", block_text))
        is_main = bool(re.search(r"server_name[^;]*\barbishield\.app\b", block_text))
        is_teste = bool(re.search(r"server_name[^;]*teste\.arbishield\.app", block_text))
        # legado/botshield não
        is_legado = bool(re.search(r"server_name[^;]*legado\.arbishield", block_text))
        is_bot = bool(re.search(r"server_name[^;]*botshield", block_text))

        if (is_ssl and (is_main or is_teste) and not is_legado and not is_bot
                and "location = /api/arbishield/adjust-balance" not in block_text):
            # inserir após root ou após ssl_dhparam / client_max_body_size
            for pat in (
                r"(root\s+/var/www/arbishield/v2\s*;)",
                r"(client_max_body_size\s+[^;]+;)",
                r"(ssl_dhparam\s+[^;]+;)",
            ):
                mm = re.search(pat, block_text)
                if mm:
                    pos = mm.end()
                    block_text = block_text[:pos] + "\n" + block + block_text[pos:]
                    inserted = True
                    break
            if not inserted:
                # após { do server
                mm = re.search(r"server\s*\{", block_text)
                if mm:
                    pos = mm.end()
                    block_text = block_text[:pos] + "\n" + block + block_text[pos:]
                    inserted = True
        parts.append(block_text)

    return "".join(parts), inserted

text2, did = insert_into_ssl_server(text)
if did:
    text = text2
    changed.append("exact@ssl-server")

# fallback: se ainda não tem exact em lugar nenhum, âncora clássica
if "location = /api/arbishield/adjust-balance" not in text:
    for anchor in (
        "location = /api/arbishield/match-settle",
        "location = /api/arbishield/dashboard-stats",
        "location ^~ /api/arbishield/contestations",
        "location ^~ /_serverFn/",
    ):
        idx = text.find(anchor)
        if idx < 0:
            continue
        text = text[:idx] + block + "\n    " + text[idx:]
        changed.append("exact@anchor")
        break

if text != orig:
    open(path, "w", encoding="utf-8").write(text)
    print("patched:" + ",".join(changed) if changed else "patched")
else:
    if "adjust-balance" in text:
        print("ok-already")
    else:
        print("FAIL: adjust-balance ausente")
        sys.exit(3)
PY
}

for conf in "${ACTIVE_CONFS[@]}"; do
  # pular legado/botshield/teste-localhost se server_name não for prod
  if grep -qE 'server_name[^;]*(legado|botshield)' "$conf" \
    && ! grep -qE 'server_name[^;]*[^.]arbishield\.app|server_name[^;]*[[:space:]]arbishield\.app' "$conf"; then
    log "nginx skip: $conf"
    continue
  fi
  log "nginx patch: $conf"
  cp -a "$conf" "${conf}.bak-adjust-balance-$(date +%s)" 2>/dev/null || true
  OUT="$(patch_one "$conf")" || die "falha ao patchar $conf → $OUT"
  log "  $OUT"
  grep -q 'location = /api/arbishield/adjust-balance' "$conf" \
    || die "ainda sem location = adjust-balance em $conf"
done

# Garantia: cutover DEVE ter exact location
if [[ -f "$CUTOVER" ]] && ! grep -q 'location = /api/arbishield/adjust-balance' "$CUTOVER"; then
  log "cutover sem exact — forçando patch"
  OUT="$(patch_one "$CUTOVER")" || die "falha cutover"
  log "  $OUT"
fi

# Verificar o que o nginx realmente carrega
log "nginx -T: locations adjust-balance carregadas"
DUMP="$(nginx -T 2>&1 || true)"
echo "$DUMP" | grep -n 'adjust-balance' | head -40 || true
if ! echo "$DUMP" | grep -q 'location = /api/arbishield/adjust-balance'; then
  log "emergency: republicar cutover canônico preservando SSL do live"
  tmp_new="$(mktemp)"
  tmp_live="$(mktemp)"
  fetch "deploy/vps-supabase/nginx-arbishield.app.conf" "$tmp_new"
  if [[ -f "$CUTOVER" ]]; then
    cp -a "$CUTOVER" "${CUTOVER}.bak-adjust-balance-emerg-$(date +%s)"
    cp -f "$CUTOVER" "$tmp_live"
  fi
  python3 - "$tmp_new" "$tmp_live" "$CUTOVER" <<'PY'
import re, sys
from pathlib import Path
new = Path(sys.argv[1]).read_text(encoding="utf-8")
live_path = Path(sys.argv[2])
dest = Path(sys.argv[3])
live = live_path.read_text(encoding="utf-8") if live_path.is_file() else ""
# preservar linhas ssl_* / include letsencrypt do live se existirem
ssl_lines = []
for line in live.splitlines():
    if re.search(r"ssl_certificate|ssl_dhparam|include /etc/letsencrypt", line):
        ssl_lines.append(line)
if ssl_lines and "ssl_certificate" in new:
    # trocar bloco ssl do new pelos do live (mantém paths reais)
    def repl_ssl(src: str) -> str:
        # remove ssl_certificate* e ssl_dhparam e include options do new no server 443
        out = []
        for line in src.splitlines():
            if re.search(r"^\s*ssl_certificate|^\s*ssl_dhparam|^\s*include /etc/letsencrypt", line):
                continue
            out.append(line)
            if re.search(r"server_name[^;]*arbishield\.app", line) and "ssl_certificate" not in "\n".join(out[-5:]):
                # after server_name in 443 block — inject preserved ssl once later
                pass
        text = "\n".join(out)
        # inject after first server_name arbishield in listen 443 server
        m = re.search(r"(listen\s+[^;]*443[^;]*;[\s\S]*?server_name[^;]*arbishield\.app[^;]*;)", text)
        if m:
            inject = m.group(1) + "\n" + "\n".join(ssl_lines)
            text = text[: m.start()] + inject + text[m.end() :]
        return text
    new = repl_ssl(new)
if "adjust-balance" not in new:
    raise SystemExit("canônico sem adjust-balance")
dest.write_text(new, encoding="utf-8")
print("rewrote", dest)
PY
  rm -f "$tmp_new" "$tmp_live"
  DUMP="$(nginx -T 2>&1 || true)"
  echo "$DUMP" | grep -n 'adjust-balance' | head -40 || true
  echo "$DUMP" | grep -q 'location = /api/arbishield/adjust-balance' \
    || die "nginx -T ainda sem location = adjust-balance após emergency"
fi

nginx -t && systemctl reload nginx || die "nginx -t / reload falhou"
log "nginx reload ok"

# Smoke shim
log "Smoke :3101 adjust-balance (sem token → Não autorizado)"
SMOKE=""
for i in 1 2 3 4 5 6 7 8; do
  SMOKE="$(curl -sS -m 3 -X POST http://127.0.0.1:3101/api/arbishield/adjust-balance \
    -H 'Content-Type: application/json' -d '{}' 2>/dev/null || true)"
  if echo "$SMOKE" | grep -Eqi 'Não autorizado|Unauthorized|token|negado|permiss'; then
    log "smoke shim ok (tentativa $i): $SMOKE"
    break
  fi
  echo "$SMOKE" | grep -q 'not_found' && die "shim responde not_found"
  sleep 1
done
echo "$SMOKE" | grep -Eqi 'Não autorizado|Unauthorized|token|negado|permiss' \
  || die "smoke shim falhou: ${SMOKE:-<vazio>}"

# Smoke nginx LOCAL primeiro (--resolve evita CDN/DNS externo)
log "Smoke nginx local (--resolve arbishield.app → 127.0.0.1)"
CODE="$(curl -sS -m 8 -o /tmp/adj-bal-nginx.json -w '%{http_code}' \
  --resolve arbishield.app:443:127.0.0.1 \
  -X POST 'https://arbishield.app/api/arbishield/adjust-balance' \
  -H 'Content-Type: application/json' \
  -d '{}' -k 2>/dev/null || true)"
BODY="$(head -c 220 /tmp/adj-bal-nginx.json 2>/dev/null || true)"
log "  local → HTTP $CODE $BODY"

if [[ "$CODE" == "405" ]]; then
  log "diagnóstico 405 local:"
  echo "$DUMP" | grep -nE 'server_name|listen |adjust-balance|try_files|location = /api' | head -80 || true
  curl -sS -m 8 -D - -o /tmp/adj-bal-hdr.txt \
    --resolve arbishield.app:443:127.0.0.1 \
    -X POST 'https://arbishield.app/api/arbishield/adjust-balance' \
    -H 'Content-Type: application/json' -d '{}' -k 2>&1 | head -40 || true
  die "nginx LOCAL ainda 405 — location não está no server block ativo de :443"
fi

# 401/403/400 = chegou no shim (sucesso de proxy)
if [[ "$CODE" =~ ^(401|403|400|200)$ ]]; then
  log "proxy ok (HTTP $CODE) — rota alcança o shim"
elif [[ -z "$CODE" || "$CODE" == "000" ]]; then
  log "aviso: curl local falhou (TLS/porta?) — tentando HTTP :80"
  CODE80="$(curl -sS -m 5 -o /tmp/adj-bal-80.json -w '%{http_code}' \
    --resolve arbishield.app:80:127.0.0.1 \
    -X POST 'http://arbishield.app/api/arbishield/adjust-balance' \
    -H 'Content-Type: application/json' -d '{}' 2>/dev/null || true)"
  log "  :80 → HTTP $CODE80 $(head -c 120 /tmp/adj-bal-80.json 2>/dev/null || true)"
fi

# Público (não bloqueia se local ok — pode ser CDN)
PUB="$(curl -sS -m 8 -o /tmp/adj-bal-pub.json -w '%{http_code}' \
  -X POST 'https://arbishield.app/api/arbishield/adjust-balance' \
  -H 'Content-Type: application/json' -d '{}' -k 2>/dev/null || true)"
log "smoke público → HTTP $PUB $(head -c 120 /tmp/adj-bal-pub.json 2>/dev/null || true)"
if [[ "$PUB" == "405" && "$CODE" =~ ^(401|403|400|200)$ ]]; then
  log "AVISO: público 405 mas local ok — cache/CDN ou DNS. Teste UI com Ctrl+F5."
elif [[ "$PUB" == "405" ]]; then
  die "público e local com problema de proxy (405)"
fi

log "OK — saldo adm financeiro (hotfix 405 v5)"
log "  UI: /admin-users.html (Ctrl+F5)"
log "  API: POST /api/arbishield/adjust-balance → shim :3101"
log "  liberados: isaacgomes3@gmail.com, financeiro@arbishield.com"
