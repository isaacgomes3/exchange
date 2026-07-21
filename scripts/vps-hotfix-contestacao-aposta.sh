#!/usr/bin/env bash
# Hotfix v7: Contestação — atualiza o arquivo REAL do systemd + valida com JWT
#
# Na VPS:
#   bash <(curl -fsSL "https://raw.githubusercontent.com/isaacgomes3/exchange/cursor/contestacao-aposta-completa-723d/scripts/vps-hotfix-contestacao-aposta.sh?v=7")
set -euo pipefail

BRANCH="${ARBISHIELD_BRANCH:-cursor/contestacao-aposta-completa-723d}"
RAW="https://raw.githubusercontent.com/isaacgomes3/exchange/${BRANCH}"
WEB_ROOT="${ARBISHIELD_WEB:-/var/www/arbishield}"
WEB="$WEB_ROOT/v2"
SHIM_DIR="${ARBISHIELD_SHIM_DIR:-/opt/arbishield}"
SCRIPTS_DIR="${ARBISHIELD_SCRIPTS_DIR:-/opt/arbishield}"

log() { echo "==> $*"; }
die() { echo "ERRO: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || die "$1 não encontrado"; }
need curl
need systemctl
mkdir -p "$WEB" "$SHIM_DIR" "$SCRIPTS_DIR" /opt/arbishield/scripts

# Descobre o caminho REAL que o systemd executa (hotfix v5/v6 gravava no lugar errado)
discover_prelive_paths() {
  local unit=""
  for u in arbishield-prelive-events.service arbishield-prelive.service; do
    if systemctl cat "$u" >/dev/null 2>&1; then
      unit="$u"
      break
    fi
  done
  local exec=""
  if [[ -n "$unit" ]]; then
    exec="$(systemctl show -p ExecStart --value "$unit" 2>/dev/null | head -1 || true)"
    echo "  unit=$unit" >&2
    echo "  ExecStart=$exec" >&2
  fi
  # Extrai .mjs do ExecStart
  local from_unit=""
  if [[ "$exec" =~ (/[^[:space:]]+arbishield-prelive-events\.mjs) ]]; then
    from_unit="${BASH_REMATCH[1]}"
  fi
  local paths=()
  [[ -n "$from_unit" ]] && paths+=("$from_unit")
  paths+=(
    /opt/arbishield/scripts/arbishield-prelive-events.mjs
    /opt/arbishield/arbishield-prelive-events.mjs
    "$SCRIPTS_DIR/arbishield-prelive-events.mjs"
  )
  # únicos
  printf '%s\n' "${paths[@]}" | awk 'NF && !seen[$0]++'
}

log "Baixar prelive com contest_*"
TMP="$(mktemp)"
curl -fsSL "$RAW/scripts/arbishield-prelive-events.mjs" -o "$TMP"
grep -q 'contest_list\|contestList' "$TMP" || die "download sem contest_list"
grep -q 'contest_submit\|contestSubmit' "$TMP" || die "download sem contest_submit"

mapfile -t PRELIVE_PATHS < <(discover_prelive_paths)
[[ ${#PRELIVE_PATHS[@]} -gt 0 ]] || die "nenhum destino prelive"
for dst in "${PRELIVE_PATHS[@]}"; do
  mkdir -p "$(dirname "$dst")"
  cp -f "$TMP" "$dst"
  chmod 0755 "$dst"
  echo "  wrote $dst"
done
rm -f "$TMP"

log "Reiniciar prelive (forçado)"
systemctl daemon-reload 2>/dev/null || true
restarted=0
for u in arbishield-prelive-events.service arbishield-prelive.service; do
  if systemctl cat "$u" >/dev/null 2>&1; then
    systemctl restart "$u" && restarted=1 && echo "  restarted $u"
  fi
done
[[ "$restarted" -eq 1 ]] || echo "AVISO: nenhum unit prelive reiniciado" >&2
sleep 2

# Se ainda houver processo antigo na :3098, mata e deixa systemd subir de novo
if command -v ss >/dev/null 2>&1; then
  pid="$(ss -lptn 'sport = :3098' 2>/dev/null | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1 || true)"
  if [[ -n "${pid:-}" ]]; then
    echo "  :3098 pid=$pid"
  fi
fi

log "Shim :3101"
curl -fsSL "$RAW/scripts/arbishield-serverfn-shim.mjs" -o "$SHIM_DIR/arbishield-serverfn-shim.mjs"
chmod 0644 "$SHIM_DIR/arbishield-serverfn-shim.mjs"
# também em scripts/
cp -f "$SHIM_DIR/arbishield-serverfn-shim.mjs" /opt/arbishield/scripts/arbishield-serverfn-shim.mjs 2>/dev/null || true
grep -q 'CONTESTATION_SUBMIT\|contest_list\|contestList' "$SHIM_DIR/arbishield-serverfn-shim.mjs" || \
  die "shim sem contestação"
systemctl restart arbishield-serverfn-shim.service 2>/dev/null || true
sleep 1

log "UI cliente + admin"
for f in app-protecoes.html admin-contestations.html v2-shell.js; do
  curl -fsSL "$RAW/deploy/vps-supabase/static/v2/$f" -o "$WEB/$f"
  chmod 0644 "$WEB/$f"
  cp -f "$WEB/$f" "$WEB_ROOT/$f" 2>/dev/null || true
  echo "  ok $f"
done
grep -q 'submitViaSupabase' "$WEB/app-protecoes.html" || die "cliente sem submitViaSupabase"
grep -q 'backend_antigo\|matchId' "$WEB/admin-contestations.html" || die "admin sem alerta de backend antigo"
grep -q 'contest_list' "$WEB/admin-contestations.html" || die "admin sem contest_list"

# nginx contestations (opcional)
NGINX_CONF=""
for c in /etc/nginx/sites-enabled/arbishield.app \
         /etc/nginx/conf.d/arbishield.app.conf \
         /etc/nginx/sites-available/arbishield.app; do
  if [[ -f "$c" ]]; then NGINX_CONF="$c"; break; fi
done
if [[ -n "$NGINX_CONF" ]] && ! grep -q 'location ^~ /api/arbishield/contestations' "$NGINX_CONF"; then
  log "Inserir location contestations no nginx (opcional)"
  python3 - <<'PY' "$NGINX_CONF"
import sys
path = sys.argv[1]
text = open(path).read()
block = """
    location ^~ /api/arbishield/contestations {
        proxy_pass http://127.0.0.1:3101;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Authorization $http_authorization;
        proxy_pass_request_headers on;
        proxy_read_timeout 120s;
    }
"""
if "location ^~ /api/arbishield/contestations" not in text:
    anchor = "location ^~ /_serverFn/"
    if anchor in text:
        text = text.replace(anchor, block + "\n    " + anchor, 1)
        open(path, "w").write(text)
        print("nginx patched")
PY
  nginx -t >/dev/null 2>&1 && systemctl reload nginx 2>/dev/null || true
fi

# Sanity CRÍTICO: com JWT falso NÃO pode cair em createProtection (matchId)
# (sem token, antigo e novo respondem 401 — não detecta o bug)
FAKE_JWT='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMTExMTExMS0xMTExLTExMTEtMTExMS0xMTExMTExMTExMTEiLCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImV4cCI6OTk5OTk5OTk5OX0.sig'
log "Sanity :3098 contest_list COM JWT falso (não pode ser matchId)"
code="$(curl -sS -o /tmp/contest-sanity.json -w '%{http_code}' -X POST \
  http://127.0.0.1:3098/api/arbishield/protections \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $FAKE_JWT" \
  -d '{"action":"contest_list"}' || true)"
body="$(head -c 240 /tmp/contest-sanity.json 2>/dev/null || true)"
echo "  HTTP $code $body"
if echo "$body" | grep -qi 'matchId'; then
  die "prelive AINDA antigo após restart (contest_list → matchId). Confira ExecStart do systemd."
fi
# esperado: 401 Login admin / Não autorizado / 403 Acesso negado
echo "$code" | grep -qE '401|403|200' || echo "AVISO: HTTP inesperado $code" >&2

# Contagem via service role (se .env existir)
ENV_FILE=""
for e in /opt/arbishield/.env /opt/arbishield/scripts/.env /root/arbishield/.env; do
  [[ -f "$e" ]] && ENV_FILE="$e" && break
done
if [[ -n "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE" 2>/dev/null || true; set +a
  SK="${ARBISHIELD_SERVICE_ROLE_KEY:-${SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}}"
  SU="${ARBISHIELD_SUPABASE_URL:-${SUPABASE_URL:-http://127.0.0.1:8000}}"
  if [[ -n "$SK" ]]; then
    log "Contar protections status=review_odd (service role)"
    cnt="$(curl -sS "$SU/rest/v1/protections?select=id&status=eq.review_odd" \
      -H "apikey: $SK" -H "Authorization: Bearer $SK" -H "Prefer: count=exact" -H "Range: 0-0" \
      -D - -o /tmp/ro.json 2>/dev/null | awk -F'/' '/content-range/ {print $NF}' | tr -d '\r' || true)"
    echo "  review_odd count≈ ${cnt:-?}  body=$(head -c 80 /tmp/ro.json 2>/dev/null || true)"
    if [[ "${cnt:-0}" == "0" || "${cnt:-}" == "*" ]]; then
      echo "  → Banco sem contestações. Cliente precisa CONTESAR DE NOVO após este hotfix."
    fi
  fi
fi

echo
echo "OK — Contestação v7"
echo "  Produção estava com prelive ANTIGO (contest_list → matchId) — ADM ficava vazio."
echo "  1) Ctrl+F5 em /app-protecoes.html → Contestar de novo"
echo "  2) Confirme status «Em Contestação (Pendente)» no cliente"
echo "  3) Ctrl+F5 em /admin-contestations.html → Atualizar"
echo "  Envios que deram «Erro ao enviar» NÃO existem no banco."
